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
    const profile = await yahooFinance.quoteSummary(ticker, { modules: ['assetProfile'] });
    return NextResponse.json({
      ticker,
      sector: profile.assetProfile?.sector ?? null,
    });
  } catch (error) {
    console.error(`Failed to fetch Yahoo Finance sector for ${ticker}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to fetch sector from Yahoo Finance.' },
      { status: 502 }
    );
  }
}
