import logging
import os
import re
from pathlib import Path
from typing import Literal, Optional

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai.errors import ClientError
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).with_name(".env"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

raw_origins = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
)
allowed_origins = [
    origin.strip() for origin in raw_origins.split(",") if origin.strip()
]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Holding(BaseModel):
    ticker: str
    company: str = ""
    quantity: Optional[float] = None
    side: Literal["LONG", "SHORT"] = "LONG"
    averageCost: Optional[float] = None
    marketPrice: Optional[float] = None
    marketValue: Optional[float] = None
    unrealizedPL: Optional[float] = None
    currency: str = "USD"


class AnalysisRequest(BaseModel):
    holdings: list[Holding] = Field(default_factory=list)


def _close_prices(symbols: list[str]) -> pd.DataFrame:
    try:
        session = requests.Session()
        session.headers["User-Agent"] = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )

        history = yf.download(
            tickers=symbols,
            period="1y",
            auto_adjust=True,
            progress=False,
            threads=True,
            session=session,
        )
    except Exception as error:
        logger.exception("Historical market data request failed.")
        raise HTTPException(
            status_code=502, detail="Unable to retrieve historical market prices."
        ) from error

    if history.empty:
        raise HTTPException(
            status_code=502, detail="No historical market prices were returned."
        )

    if isinstance(history.columns, pd.MultiIndex):
        if "Close" in history.columns.get_level_values(0):
            close = history["Close"]
        elif "Close" in history.columns.get_level_values(1):
            close = history.xs("Close", axis=1, level=1)
        else:
            raise HTTPException(
                status_code=502, detail="Market data did not include closing prices."
            )
    elif "Close" in history.columns:
        close = history["Close"]
    else:
        raise HTTPException(
            status_code=502, detail="Market data did not include closing prices."
        )

    if isinstance(close, pd.Series):
        close = close.to_frame(name=symbols[0])

    close.columns = [str(column) for column in close.columns]
    return close.apply(pd.to_numeric, errors="coerce").dropna(axis=1, how="all")


def _generate_summary(
    metrics: dict, holdings: list[Holding], analyzed_tickers: list[str]
) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Gemini is not configured. Set GEMINI_API_KEY in ai-engine/.env and restart the API.",
        )

    if holdings:
        position_summary = [
            {
                "ticker": holding.ticker.upper(),
                "company": holding.company,
                "side": holding.side,
                "quantity": holding.quantity,
                "market_value": holding.marketValue,
                "currency": holding.currency,
                "unrealized_pl": holding.unrealizedPL,
            }
            for holding in holdings
        ]
        context = (
            f"Current positions: {position_summary}\n"
            f"Analyzed Tickers: {analyzed_tickers}\n"
            f"Calculated daily portfolio risk metrics: {metrics}"
        )
        instructions = (
            "You are an institutional portfolio analyst. Your primary objective is to search for "
            "the most relevant news and developments over the PAST MONTH for each analyzed position (ticker/company).\n\n"
            "Generate a structured Markdown report adhering to the following structure:\n"
            "1. ## Executive Portfolio Summary\n"
            "   A quick overview synthesizing current position exposures with the quantitative risk metrics provided.\n\n"
            "2. ## Monthly Asset News & Event Overview\n"
            "   For each position (ticker/company), perform a search for news from the past month. Provide a brief overview of key catalyst events, earnings reports, corporate developments, or macro events affecting the asset, and summarize what happened over the past month.\n\n"
            "3. ## Quantitative Risk Profile & Considerations\n"
            "   Discuss Sharpe Ratio, Value at Risk, and Beta metrics in plain language, explaining their operational implications based on the recent news events."
        )
    else:
        context = "The account currently has no active positions. No market risk metrics can be calculated."
        instructions = (
            "Write a short Markdown executive summary stating that there are no active positions "
            "to analyze, so risk metrics and asset news summaries are unavailable. Explain that "
            "risk analysis and news tracking can be generated after an active holding is added."
        )

    try:
        # Initialize Gemini Client with Google Search Grounding enabled using the correct stable model
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-3.8-flash",
            contents=f"{context}\n\n{instructions}",
            config={
                "tools": [{"google_search": {}}]  # Enables live news search grounding
            },
        )
    except ClientError as e:
        logger.exception("Gemini API ClientError encountered.")
        if e.code == 429:
            raise HTTPException(
                status_code=429,
                detail="Gemini API quota exceeded (429 Resource Exhausted). Please check your plan limits or wait a minute before trying again.",
            )
        else:
            raise HTTPException(
                status_code=e.code or 502,
                detail=f"Gemini API Error: {e.message}",
            )
    except Exception as error:
        logger.exception("Gemini risk report generation failed.")
        raise HTTPException(
            status_code=502, detail="Gemini could not generate the risk report."
        ) from error

    summary = response.text
    if not isinstance(summary, str) or not summary.strip():
        raise HTTPException(
            status_code=502, detail="Gemini returned an empty risk report."
        )
    return summary.strip()


@app.get("/")
def root():
    return {"status": "ok", "service": "investment-tracker-api"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze")
def analyze_portfolio(payload: AnalysisRequest):
    if len(payload.holdings) > 100:
        raise HTTPException(
            status_code=400, detail="Analyze at most 100 holdings at a time."
        )

    for holding in payload.holdings:
        ticker = holding.ticker.strip()
        if not ticker or not re.fullmatch(r"[A-Za-z0-9.^=_-]{1,20}", ticker):
            raise HTTPException(
                status_code=400, detail="A holding contains an invalid ticker."
            )
        holding.ticker = ticker.upper()

    metrics = {
        "sharpeRatio": None,
        "valueAtRisk": None,
        "beta": None,
        "annualizedVolatility": None,
    }
    analyzed_tickers: list[str] = []

    if payload.holdings:
        tickers = list(dict.fromkeys(holding.ticker for holding in payload.holdings))
        closes = _close_prices([*tickers, "^GSPC"])
        available_tickers = [
            ticker for ticker in tickers if ticker in closes.columns
        ]
        if not available_tickers:
            raise HTTPException(
                status_code=400,
                detail="No price history was found for the portfolio tickers.",
            )
        if "^GSPC" not in closes.columns:
            raise HTTPException(
                status_code=502, detail="S&P 500 benchmark history is unavailable."
            )

        returns = closes[available_tickers].pct_change(fill_method=None)
        usable_tickers = [
            ticker
            for ticker in available_tickers
            if returns[ticker].count() >= 30
        ]
        if not usable_tickers:
            raise HTTPException(
                status_code=400,
                detail="At least 30 daily price observations are required for risk analysis.",
            )

        holdings_by_ticker = {
            holding.ticker: holding for holding in payload.holdings
        }
        notionals = {}
        for ticker in usable_tickers:
            holding = holdings_by_ticker[ticker]
            if holding.marketValue is not None and np.isfinite(
                holding.marketValue
            ):
                notional = abs(holding.marketValue)
            elif (
                holding.quantity is not None and holding.marketPrice is not None
            ):
                notional = abs(holding.quantity * holding.marketPrice)
            else:
                notional = 1.0
            notionals[ticker] = notional * (
                -1 if holding.side == "SHORT" else 1
            )

        gross_notional = sum(abs(value) for value in notionals.values())
        if gross_notional <= 0:
            raise HTTPException(
                status_code=400,
                detail="Portfolio position values must be greater than zero.",
            )
        weights = pd.Series(
            {ticker: value / gross_notional for ticker, value in notionals.items()},
            dtype=float,
        )

        aligned = (
            returns[usable_tickers]
            .join(
                closes["^GSPC"].pct_change(fill_method=None).rename("benchmark"),
                how="inner",
            )
            .dropna()
        )
        if len(aligned) < 30:
            raise HTTPException(
                status_code=400,
                detail="At least 30 aligned portfolio and S&P 500 observations are required.",
            )

        portfolio_returns = (
            aligned[usable_tickers].mul(weights, axis="columns").sum(axis=1)
        )
        annualized_return = float(portfolio_returns.mean() * 252)
        annualized_volatility = float(portfolio_returns.std(ddof=1) * np.sqrt(252))
        benchmark_returns = aligned["benchmark"]
        benchmark_variance = float(benchmark_returns.var(ddof=1))
        beta = (
            float(portfolio_returns.cov(benchmark_returns) / benchmark_variance)
            if benchmark_variance > 0
            else None
        )
        sharpe_ratio = (
            (annualized_return - 0.03) / annualized_volatility
            if annualized_volatility > 0
            else None
        )
        value_at_risk = float(np.percentile(portfolio_returns, 5) * 100)

        metrics = {
            "sharpeRatio": round(sharpe_ratio, 2) if sharpe_ratio is not None else None,
            "valueAtRisk": round(value_at_risk, 2),
            "beta": round(beta, 2) if beta is not None else None,
            "annualizedVolatility": round(annualized_volatility * 100, 2),
        }
        analyzed_tickers = usable_tickers

    summary = _generate_summary(metrics, payload.holdings, analyzed_tickers)
    return {
        "success": True,
        "model": "Gemini 3.8 Flash (with Search)",
        "metrics": metrics,
        "executive_summary": summary,
        "report": summary,
    }