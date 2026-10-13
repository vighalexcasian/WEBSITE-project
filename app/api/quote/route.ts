import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') ?? '').trim().toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
  }

  try {
    const quote = await yahooFinance.quote(ticker);
    const price = quote.regularMarketPrice;

    if (typeof price !== 'number' || !Number.isFinite(price)) {
      return NextResponse.json({ error: `No price found for ${ticker}.` }, { status: 404 });
    }

    return NextResponse.json({
      ticker: quote.symbol,
      price,
      currency: quote.currency ?? 'USD',
      updatedAt: quote.regularMarketTime?.toISOString() ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Failed to fetch Yahoo Finance quote for ${ticker}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to fetch quote from Yahoo Finance.' },
      { status: 502 }
    );
  }
}
