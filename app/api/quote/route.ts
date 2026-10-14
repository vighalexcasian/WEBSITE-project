import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const getCachedYahooQuotes = unstable_cache(
  async (tickers: string[]) => yahooFinance.quote(tickers),
  ['yahoo-finance-quotes'],
  { revalidate: 600 }
);

type CachedQuote = {
  ticker: string;
  price: number;
  currency: string;
  updatedAt: string;
  cachedAt: number;
};

type QuoteFetchResult = CachedQuote & { error?: string };

const quoteCache = new Map<string, CachedQuote>();
const inFlightQuotes = new Map<string, Promise<QuoteFetchResult | null>>();
const quoteErrors = new Map<string, { message: string; cachedAt: number }>();

function getErrorMessage(error: unknown) {
  const errorDetails: string[] = [];
  const pendingErrors: unknown[] = [error];
  const visitedErrors = new Set<object>();

  while (pendingErrors.length > 0) {
    const currentError = pendingErrors.pop();
    if (typeof currentError !== 'object' || currentError === null || visitedErrors.has(currentError)) {
      continue;
    }
    visitedErrors.add(currentError);

    if (currentError instanceof Error) {
      errorDetails.push(currentError.message);
      if (currentError.cause !== undefined) {
        pendingErrors.push(currentError.cause);
      }
      continue;
    }

    const details = currentError as Record<string, unknown>;
    for (const key of ['message', 'status', 'statusCode', 'code']) {
      if (typeof details[key] === 'string' || typeof details[key] === 'number') {
        errorDetails.push(String(details[key]));
      }
    }
    if (details.cause !== undefined) {
      pendingErrors.push(details.cause);
    }
  }

  const combinedErrorDetails = errorDetails.join(' ').toLowerCase();
  if (/\b429\b|too many requests|failed to get crumb|\bcrumb\b/.test(combinedErrorDetails)) {
    return 'Yahoo Finance is temporarily rate-limiting requests. Showing the last cached quote when available.';
  }
  return 'Unable to fetch quotes from Yahoo Finance. Please try again later.';
}

async function getQuotes(tickers: string[]) {
  const now = Date.now();
  const tickersToFetch = tickers.filter((ticker) => {
    const cachedQuote = quoteCache.get(ticker);
    const cachedError = quoteErrors.get(ticker);
    const hasFreshQuote = cachedQuote && now - cachedQuote.cachedAt < QUOTE_CACHE_TTL_MS;
    const hasRecentError = cachedError && now - cachedError.cachedAt < QUOTE_CACHE_TTL_MS;
    return !hasFreshQuote && !hasRecentError && !inFlightQuotes.has(ticker);
  });

  if (tickersToFetch.length > 0) {
    let batchError: string | null = null;
    const batchRequest = getCachedYahooQuotes(tickersToFetch)
      .then((quotes) => new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote])))
      .catch((error: unknown) => {
        batchError = getErrorMessage(error);
        console.error(`Failed to fetch Yahoo Finance quotes for ${tickersToFetch.join(', ')}:`, error);
        for (const ticker of tickersToFetch) {
          quoteErrors.set(ticker, { message: batchError, cachedAt: Date.now() });
        }
        return null;
      });

    for (const ticker of tickersToFetch) {
      const quoteRequest = batchRequest
        .then((quotesByTicker) => {
          const yahooQuote = quotesByTicker?.get(ticker);
          const price = yahooQuote?.regularMarketPrice;

          if (yahooQuote && typeof price === 'number' && Number.isFinite(price)) {
            const cachedQuote: CachedQuote = {
              ticker,
              price,
              currency: yahooQuote.currency ?? 'USD',
              updatedAt: yahooQuote.regularMarketTime?.toISOString() ?? new Date().toISOString(),
              cachedAt: Date.now(),
            };
            quoteCache.set(ticker, cachedQuote);
            quoteErrors.delete(ticker);
            return cachedQuote;
          }

          const cachedQuote = quoteCache.get(ticker);
          const errorMessage = batchError ?? `Yahoo Finance did not return a current price for ${ticker}.`;
          quoteErrors.set(ticker, { message: errorMessage, cachedAt: Date.now() });
          if (!cachedQuote) {
            return null;
          }
          return { ...cachedQuote, error: errorMessage };
        })
        .finally(() => {
          inFlightQuotes.delete(ticker);
        });
      inFlightQuotes.set(ticker, quoteRequest);
    }
  }

  return Promise.all(tickers.map(async (ticker) => {
    const cachedQuote = quoteCache.get(ticker);
    if (cachedQuote && Date.now() - cachedQuote.cachedAt < QUOTE_CACHE_TTL_MS) {
      return { ...cachedQuote, stale: false };
    }

    const quoteRequest = inFlightQuotes.get(ticker);
    const fetchedQuote = quoteRequest ? await quoteRequest : cachedQuote ?? null;
    if (!fetchedQuote) {
      return {
        ticker,
        error: quoteErrors.get(ticker)?.message ?? 'Yahoo Finance did not return a quote. Please try again later.',
      };
    }

    const stale = Date.now() - fetchedQuote.cachedAt >= QUOTE_CACHE_TTL_MS;
    return {
      ...fetchedQuote,
      stale,
      error: ('error' in fetchedQuote ? fetchedQuote.error : undefined) ??
        (stale ? quoteErrors.get(ticker)?.message : undefined),
    };
  }));
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

  let quotes: Awaited<ReturnType<typeof getQuotes>>;
  try {
    quotes = await getQuotes(tickers);
  } catch (error) {
    console.error(`Unable to build Yahoo Finance quote response for ${tickers.join(', ')}:`, error);
    quotes = tickers.map((ticker) => ({
      ticker,
      error: getErrorMessage(error),
    }));
  }

  if (requestedTickers === null) {
    const quote = quotes[0];
    return NextResponse.json({
      ticker: quote.ticker,
      price: 'price' in quote ? quote.price : undefined,
      currency: 'currency' in quote ? quote.currency : undefined,
      updatedAt: 'updatedAt' in quote ? quote.updatedAt : undefined,
      stale: 'stale' in quote ? quote.stale : undefined,
      error: 'error' in quote ? quote.error : undefined,
    });
  }

  return NextResponse.json({
    quotes: quotes.map((quote) => ({
      ticker: quote.ticker,
      price: 'price' in quote ? quote.price : undefined,
      currency: 'currency' in quote ? quote.currency : undefined,
      updatedAt: 'updatedAt' in quote ? quote.updatedAt : undefined,
      stale: 'stale' in quote ? quote.stale : undefined,
      error: 'error' in quote ? quote.error : undefined,
    })),
  });
}
