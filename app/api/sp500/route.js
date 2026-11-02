import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.error('FINNHUB_API_KEY is not configured.');
    return NextResponse.json({ error: 'Benchmark data service is not configured.' }, { status: 503 });
  }

  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 365 * 24 * 60 * 60;
  const url = new URL('https://finnhub.io/api/v1/stock/candle');
  url.searchParams.set('symbol', 'SPY');
  url.searchParams.set('resolution', 'D');
  url.searchParams.set('from', String(oneYearAgo));
  url.searchParams.set('to', String(now));
  url.searchParams.set('token', apiKey);

  try {
    const response = await fetch(url, { next: { revalidate: 3600 } });
    if (!response.ok) {
      console.error(`Finnhub benchmark request failed with status ${response.status}.`);
      return NextResponse.json(
        { error: response.status === 429
          ? 'Finnhub is temporarily rate-limiting benchmark requests.'
          : 'Failed to fetch benchmark data from Finnhub.' },
        { status: response.status === 429 ? 429 : 502 }
      );
    }

    const candles = await response.json();
    if (
      candles?.s !== 'ok' ||
      !Array.isArray(candles.t) ||
      !Array.isArray(candles.c) ||
      candles.t.length !== candles.c.length
    ) {
      return NextResponse.json({ error: 'Finnhub did not return valid benchmark history.' }, { status: 502 });
    }

    const history = candles.t.flatMap((timestamp, index) => {
      const close = candles.c[index];
      if (!Number.isFinite(timestamp) || !Number.isFinite(close)) return [];
      return [{ date: new Date(timestamp * 1000).toISOString(), close }];
    });

    return NextResponse.json(history);
  } catch (error) {
    console.error('Failed to fetch benchmark data from Finnhub:', error);
    return NextResponse.json({ error: 'Failed to fetch benchmark data from Finnhub.' }, { status: 502 });
  }
}
