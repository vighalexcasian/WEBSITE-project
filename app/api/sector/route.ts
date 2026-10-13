import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') ?? '').trim().toUpperCase();
  const company = (searchParams.get('company') ?? '').trim();

  if (!ticker) {
    return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
  }

  const errors: unknown[] = [];
  let profileFailed = false;

  try {
    const profile = await yahooFinance.quoteSummary(ticker, { modules: ['assetProfile', 'summaryProfile'] });
    const sector = profile.assetProfile?.sector ?? profile.summaryProfile?.sector;
    if (sector) {
      return NextResponse.json({ ticker, sector });
    }
  } catch (error) {
    errors.push(error);
    profileFailed = true;
  }

  const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const queries = [...new Set([ticker, company].filter(Boolean))];

  for (const query of queries) {
    try {
      const results = await yahooFinance.search(query, { quotesCount: 10, newsCount: 0 });
      const yahooQuotes = results.quotes.filter((quote) => quote.isYahooFinance);
      const exactTicker = yahooQuotes.find((quote) => quote.symbol.toUpperCase() === ticker && (quote.sectorDisp || quote.sector));
      const exactCompany = company
        ? yahooQuotes.find((quote) =>
          [quote.longname, quote.shortname].some((name) =>
            typeof name === 'string' && normalizeName(name) === normalizeName(company)
          ) && (quote.sectorDisp || quote.sector)
        )
        : undefined;
      const match = exactTicker ?? exactCompany;
      const sector = match?.sectorDisp ?? match?.sector;

      if (sector) {
        return NextResponse.json({ ticker, sector });
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === queries.length + (profileFailed ? 1 : 0)) {
    console.error(`Failed to fetch Yahoo Finance sector for ${ticker}:`, errors);
    return NextResponse.json(
      { error: 'Unable to retrieve company sector from Yahoo Finance.' },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { ticker, sector: null, error: `Yahoo Finance did not return a sector for ${ticker}.` },
    { status: 404 }
  );
}
