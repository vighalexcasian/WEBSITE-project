import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

async function getFinnhubHistory(apiKey, period1, period2) {
  const url = new URL('https://finnhub.io/api/v1/stock/candle');
  url.searchParams.set('symbol', 'SPY');
  url.searchParams.set('resolution', 'D');
  url.searchParams.set('from', String(Math.floor(period1.getTime() / 1000)));
  url.searchParams.set('to', String(Math.floor(period2.getTime() / 1000)));
  url.searchParams.set('token', apiKey);

  const response = await fetch(url, { next: { revalidate: 3600 } });
  if (!response.ok) throw new Error(`Finnhub returned status ${response.status}.`);

  const candles = await response.json();
  if (
    candles?.s !== 'ok' ||
    !Array.isArray(candles.t) ||
    !Array.isArray(candles.c) ||
    candles.t.length !== candles.c.length
  ) {
    throw new Error('Finnhub returned invalid benchmark history.');
  }

  const history = candles.t.flatMap((timestamp, index) => {
    const close = candles.c[index];
    if (!Number.isFinite(timestamp) || !Number.isFinite(close)) return [];
    return [{ date: new Date(timestamp * 1000).toISOString(), close }];
  });
  if (history.length === 0) throw new Error('Finnhub returned no benchmark observations.');
  return history;
}

async function getYahooHistory(period1, period2) {
  const result = await yahooFinance.chart('SPY', {
    period1,
    period2,
    interval: '1d',
  });

  const history = result.quotes.flatMap((quote) => {
    if (!(quote.date instanceof Date) || !Number.isFinite(quote.date.getTime()) || !Number.isFinite(quote.close)) {
      return [];
    }
    return [{ date: quote.date.toISOString(), close: quote.close }];
  });
  if (history.length === 0) throw new Error('Yahoo Finance returned no benchmark observations.');
  return history;
}

export async function GET(request) {
  const period2 = new Date();
  const { searchParams } = new URL(request.url);
  const requestedStart = searchParams.get('from');
  const period1 = requestedStart
    ? new Date(`${requestedStart}T00:00:00.000Z`)
    : new Date(period2.getTime() - 365 * 24 * 60 * 60 * 1000);
  const isValidRequestedStart = !requestedStart || (
    /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) &&
    !Number.isNaN(period1.getTime()) &&
    period1.toISOString().slice(0, 10) === requestedStart
  );
  if (
    Number.isNaN(period1.getTime()) ||
    !isValidRequestedStart ||
    period1 > period2
  ) {
    return NextResponse.json({ error: 'Benchmark start date must be a valid date no later than today.' }, { status: 400 });
  }
  const apiKey = process.env.FINNHUB_API_KEY;

  if (apiKey) {
    try {
      const history = await getFinnhubHistory(apiKey, period1, period2);
      return NextResponse.json(history);
    } catch (error) {
      console.error('Finnhub benchmark request failed; trying Yahoo Finance:', error);
    }
  } else {
    console.error('FINNHUB_API_KEY is not configured; trying Yahoo Finance for benchmark history.');
  }

  try {
    const history = await getYahooHistory(period1, period2);
    return NextResponse.json(history);
  } catch (error) {
    console.error('Yahoo Finance benchmark request failed:', error);
    return NextResponse.json(
      { error: 'Unable to retrieve S&P 500 benchmark history from Finnhub or Yahoo Finance.' },
      { status: 502 }
    );
  }
}
