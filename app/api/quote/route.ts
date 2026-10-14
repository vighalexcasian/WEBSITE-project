import { NextRequest, NextResponse } from 'next/server';

const QUOTE_CACHE_SECONDS = 300;

type FinnhubQuote = {
  c?: unknown;
  t?: unknown;
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
  stale?: boolean;
  error?: string;
};

async function getQuote(ticker: string): Promise<QuoteResult> {
  const normalizedTicker = ticker.toUpperCase();

  // 1. Seamlessly handle EUR/USD via Frankfurter API (Free, no key needed)
  if (normalizedTicker === 'EURUSD=X' || normalizedTicker === 'EUR/USD') {
    try {
      const fxRes = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD', {
        next: { revalidate: QUOTE_CACHE_SECONDS },
      });
      if (!fxRes.ok) {
        console.error(`Frankfurter quote request failed for EUR/USD with status ${fxRes.status}.`);
        return { ticker, error: 'Unable to fetch the EUR/USD rate from Frankfurter. Please try again later.' };
      }

      const fxData = await fxRes.json() as FrankfurterQuote;
      const price = fxData.rates?.USD;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        return { ticker, error: 'Frankfurter did not return a valid EUR/USD rate.' };
      }

      const rateDate = typeof fxData.date === 'string' ? Date.parse(`${fxData.date}T00:00:00Z`) : NaN;
      return {
        ticker,
        price,
        currency: 'USD',
        updatedAt: Number.isFinite(rateDate) ? new Date(rateDate).toISOString() : new Date().toISOString(),
        stale: false,
      };
    } catch (error) {
      console.error('Frankfurter fetch failed for EUR/USD:', error);
      return { ticker, error: 'Unable to fetch the EUR/USD rate from Frankfurter. Please try again later.' };
    }
  }

  // 2. Standard Finnhub fallback for stocks
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.error('FINNHUB_API_KEY is not configured.');
    return { ticker, error: 'Quote service is not configured. Please try again later.' };
  }

  const symbol = normalizedTicker === 'EURUSD=X' ? 'OANDA:EUR_USD' : normalizedTicker;
  const url = new URL('https://finnhub.io/api/v1/quote');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('token', apiKey);

  try {
    const response = await fetch(url, {
      next: { revalidate: QUOTE_CACHE_SECONDS },
    });

    if (!response.ok) {
      console.error(`Finnhub quote request failed for ${ticker} with status ${response.status}.`);
      return {
        ticker,
        error: response.status === 429
          ? 'Finnhub is temporarily rate-limiting quote requests. Please try again later.'
          : 'Unable to fetch this quote from Finnhub. Please try again later.',
      };
    }

    const quote = await response.json() as FinnhubQuote;
    if (typeof quote.c !== 'number' || !Number.isFinite(quote.c) || quote.c <= 0) {
      return { ticker, error: `Finnhub did not return a current price for ${ticker}.` };
    }

    return {
      ticker,
      price: quote.c,
      currency: 'USD',
      updatedAt: typeof quote.t === 'number' && quote.t > 0
        ? new Date(quote.t * 1000).toISOString()
        : new Date().toISOString(),
      stale: false,
    };
  } catch (error) {
    console.error(`Finnhub quote request failed for ${ticker}:`, error);
    return {
      ticker,
      error: 'Unable to fetch this quote from Finnhub. Please try again later.',
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