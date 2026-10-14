import { NextRequest, NextResponse } from 'next/server';

const QUOTE_CACHE_SECONDS = 300;

type FinnhubQuote = {
  c?: unknown;
  t?: unknown;
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
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.error('FINNHUB_API_KEY is not configured.');
    return { ticker, error: 'Quote service is not configured. Please try again later.' };
  }

  const symbol = ticker === 'EURUSD=X' ? 'OANDA:EUR_USD' : ticker;
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
