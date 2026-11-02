import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const QUOTE_CACHE_SECONDS = 300;
const yahooFinance = new YahooFinance();
const FRANKFURTER_CURRENCIES = new Set(['EUR', 'CHF', 'GBP', 'RON']);

type FinnhubQuote = {
  c?: unknown;
  t?: unknown;
};

type YahooQuote = {
  regularMarketPrice?: unknown;
  currency?: unknown;
  regularMarketTime?: unknown;
};

type FrankfurterQuote = {
  date?: unknown;
  rates?: Record<string, unknown>;
};

type QuoteResult = {
  ticker: string;
  price?: number;
  currency?: string;
  updatedAt?: string;
  source?: 'finnhub' | 'yahoo-finance' | 'frankfurter';
  stale?: boolean;
  error?: string;
};

const isValidPrice = (price: unknown): price is number =>
  typeof price === 'number' && Number.isFinite(price) && price > 0;

async function getQuote(ticker: string): Promise<QuoteResult> {
  const normalizedTicker = ticker.toUpperCase();
  const currencyMatch = normalizedTicker.match(/^([A-Z]{3})USD=X$/);
  const baseCurrency = normalizedTicker === 'EUR/USD'
    ? 'EUR'
    : currencyMatch?.[1];

  if (baseCurrency && FRANKFURTER_CURRENCIES.has(baseCurrency)) {
    try {
      const fxRes = await fetch(`https://api.frankfurter.dev/v1/latest?base=${baseCurrency}&symbols=USD`, {
        next: { revalidate: QUOTE_CACHE_SECONDS },
      });
      if (!fxRes.ok) {
        console.error(`Frankfurter quote request failed for ${baseCurrency}/USD with status ${fxRes.status}.`);
        return { ticker, error: `Unable to fetch the ${baseCurrency}/USD rate from Frankfurter. Please try again later.` };
      }

      const fxData = await fxRes.json() as FrankfurterQuote;
      const price = fxData.rates?.USD;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        return { ticker, error: `Frankfurter did not return a valid ${baseCurrency}/USD rate.` };
      }

      const rateDate = typeof fxData.date === 'string' ? Date.parse(`${fxData.date}T00:00:00Z`) : NaN;
      return {
        ticker,
        price,
        currency: 'USD',
        updatedAt: Number.isFinite(rateDate) ? new Date(rateDate).toISOString() : new Date().toISOString(),
        source: 'frankfurter',
        stale: false,
      };
    } catch (error) {
      console.error(`Frankfurter fetch failed for ${baseCurrency}/USD:`, error);
      return { ticker, error: `Unable to fetch the ${baseCurrency}/USD rate from Frankfurter. Please try again later.` };
    }
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  let finnhubError: string | undefined;

  if (apiKey) {
    const url = new URL('https://finnhub.io/api/v1/quote');
    url.searchParams.set('symbol', normalizedTicker);
    url.searchParams.set('token', apiKey);

    try {
      const response = await fetch(url, {
        next: { revalidate: QUOTE_CACHE_SECONDS },
      });

      if (!response.ok) {
        finnhubError = response.status === 429
          ? 'Finnhub is temporarily rate-limiting quote requests.'
          : `Finnhub quote request failed (${response.status}).`;
        console.error(`${finnhubError} Falling back to Yahoo Finance for ${ticker}.`);
      } else {
        const quote = await response.json() as FinnhubQuote;
        if (isValidPrice(quote.c)) {
          return {
            ticker,
            price: quote.c,
            currency: 'USD',
            updatedAt: typeof quote.t === 'number' && quote.t > 0
              ? new Date(quote.t * 1000).toISOString()
              : new Date().toISOString(),
            source: 'finnhub',
            stale: false,
          };
        }

        finnhubError = `Finnhub did not return a valid current price for ${ticker}.`;
      }
    } catch (error) {
      console.error(`Finnhub quote request failed for ${ticker}; falling back to Yahoo Finance:`, error);
      finnhubError = 'Finnhub quote request failed.';
    }
  } else {
    console.error('FINNHUB_API_KEY is not configured; trying Yahoo Finance fallback.');
    finnhubError = 'Finnhub quote service is not configured.';
  }

  try {
    const quote = await yahooFinance.quote(normalizedTicker) as YahooQuote;
    if (!isValidPrice(quote.regularMarketPrice)) {
      return {
        ticker,
        error: `${finnhubError ?? 'Finnhub did not return a valid price.'} Yahoo Finance did not return a valid price for ${ticker}.`,
      };
    }

    const marketTime = quote.regularMarketTime;
    const updatedAt = marketTime instanceof Date
      ? marketTime.toISOString()
      : typeof marketTime === 'number' && marketTime > 0
        ? new Date(marketTime * 1000).toISOString()
        : new Date().toISOString();
    return {
      ticker,
      price: quote.regularMarketPrice,
      currency: typeof quote.currency === 'string' && quote.currency ? quote.currency : 'USD',
      updatedAt,
      source: 'yahoo-finance',
      stale: false,
    };
  } catch (error) {
    console.error(`Yahoo Finance fallback request failed for ${ticker}:`, error);
    return {
      ticker,
      error: `${finnhubError ?? 'Finnhub did not return a valid price.'} Yahoo Finance fallback failed for ${ticker}.`,
    };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedTickers = searchParams.get('tickers');
  const singleTicker = searchParams.get('ticker');
  const tickers = [...new Set(
    (requestedTickers ?? singleTicker ?? '')
      .split(',')
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean)
  )];

  if (tickers.length === 0) {
    return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
  }
  if (tickers.length > 50) {
    return NextResponse.json({ error: 'A maximum of 50 tickers can be requested at once.' }, { status: 400 });
  }

  const quotes = await Promise.all(tickers.map((ticker) => getQuote(ticker)));

  if (requestedTickers === null) {
    return NextResponse.json(quotes[0]);
  }

  return NextResponse.json({ quotes });
}