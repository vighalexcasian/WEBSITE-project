import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedTickers = searchParams.get('tickers');

  if (requestedTickers !== null) {
    const tickers = [...new Set(requestedTickers.split(',').map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))];
    if (tickers.length === 0) {
      return NextResponse.json({ error: 'At least one ticker is required.' }, { status: 400 });
    }
    if (tickers.length > 50) {
      return NextResponse.json({ error: 'A maximum of 50 tickers can be requested at once.' }, { status: 400 });
    }

    try {
      const quotes = await yahooFinance.quote(tickers);
      const quotesByTicker = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));

      return NextResponse.json({
        quotes: tickers.map((requestedTicker) => {
          const quote = quotesByTicker.get(requestedTicker);
          const price = quote?.regularMarketPrice;
          if (!quote || typeof price !== 'number' || !Number.isFinite(price)) {
            return { ticker: requestedTicker, error: `No current price found for ${requestedTicker}.` };
          }

          return {
            ticker: requestedTicker,
            price,
            currency: quote.currency ?? 'USD',
            updatedAt: quote.regularMarketTime?.toISOString() ?? new Date().toISOString(),
          };
        }),
      });
    } catch (error) {
      console.error(`Failed to fetch Yahoo Finance quotes for ${tickers.join(', ')}:`, error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to fetch quotes from Yahoo Finance.' },
        { status: 502 }
      );
    }
  }

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
