import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export async function GET() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const oneYearAgo = now - 365 * 24 * 60 * 60;

    const data = await yahooFinance.historical('^GSPC', {
      period1: oneYearAgo,
      period2: now,
      interval: '1d',
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch S&P 500 data:', error);
    return NextResponse.json({ error: 'Failed to fetch S&P 500 data' }, { status: 500 });
  }
}
