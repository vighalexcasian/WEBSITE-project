export type TransactionType = 'BUY' | 'SELL';
export type Transaction = {
  id: string;
  date: string;
  ticker: string;
  company: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  cfdCost?: number | null;
};

export type Quote = {
  price: number;
  currency: string;
  source: 'sample' | 'live' | 'finnhub' | 'yahoo-finance' | 'frankfurter';
  updatedAt?: string;
};
export type Holding = {
  ticker: string; company: string; quantity: number; averageCost: number;
  costBasis: number; marketPrice: number; marketValue: number; unrealizedPL: number;
  unrealizedPLPercent: number; currency: string; costCurrency: string;
  side: 'LONG' | 'SHORT'; quoteSource: Quote['source'];
};

// Average-cost method. For real tax reporting, verify the cost-basis method required in your jurisdiction.
export function calculatePortfolio(transactions: Transaction[], quotes: Record<string, Quote>) {
  const buckets = new Map<string, { company: string; quantity: number; costBasis: number; shortEntryValue: number; realizedPL: number; currency: string }>();
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  for (const tx of sorted) {
    const key = tx.ticker.toUpperCase();
    const current = buckets.get(key) ?? { company: tx.company, quantity: 0, costBasis: 0, shortEntryValue: 0, realizedPL: 0, currency: tx.currency };
    current.company = tx.company || current.company;
    current.currency = tx.currency || current.currency;
    let remainingQuantity = tx.quantity;
    const feePerShare = tx.fees / tx.quantity;

    if (tx.type === 'BUY' && current.quantity < 0) {
      const coveredQuantity = Math.min(remainingQuantity, Math.abs(current.quantity));
      const averageShortProceeds = Math.abs(current.costBasis) / Math.abs(current.quantity);
      const averageShortEntryPrice = current.shortEntryValue / Math.abs(current.quantity);
      const realized = (averageShortProceeds - tx.price - feePerShare) * coveredQuantity;
      current.realizedPL += realized;
      current.quantity += coveredQuantity;
      current.costBasis += averageShortProceeds * coveredQuantity;
      current.shortEntryValue -= averageShortEntryPrice * coveredQuantity;
      remainingQuantity -= coveredQuantity;
    } else if (tx.type === 'SELL' && current.quantity > 0) {
      const soldQuantity = Math.min(remainingQuantity, current.quantity);
      const averageCost = current.costBasis / current.quantity;
      const realized = (tx.price - averageCost - feePerShare) * soldQuantity;
      current.realizedPL += realized;
      current.quantity -= soldQuantity;
      current.costBasis -= averageCost * soldQuantity;
      remainingQuantity -= soldQuantity;
    }

    if (current.quantity === 0) {
      current.costBasis = 0;
      current.shortEntryValue = 0;
    }
    if (remainingQuantity > 0) {
      if (tx.type === 'BUY') {
        current.quantity += remainingQuantity;
        current.costBasis += remainingQuantity * (tx.price + feePerShare);
      } else {
        const shortCostPerShare = tx.cfdCost != null
          ? tx.cfdCost / tx.quantity
          : tx.price - feePerShare;
        current.quantity -= remainingQuantity;
        current.costBasis -= remainingQuantity * shortCostPerShare;
        current.shortEntryValue += remainingQuantity * tx.price;
      }
    }
    buckets.set(key, current);
  }

  const realizedPLByTicker = Object.fromEntries(
    [...buckets.entries()].map(([ticker, holding]) => [ticker, holding.realizedPL])
  );
  const totalRealizedPL = [...buckets.values()].reduce((sum, holding) => sum + holding.realizedPL, 0);
  const holdings: Holding[] = [...buckets.entries()].filter(([, h]) => h.quantity !== 0).map(([ticker, h]) => {
    const quote = quotes[ticker];
    const quantity = Math.abs(h.quantity);
    const costBasis = Math.abs(h.costBasis);
    const side = h.quantity > 0 ? 'LONG' : 'SHORT';
    const marketPrice = quote?.price ?? (side === 'SHORT' ? h.shortEntryValue / quantity : costBasis / quantity);
    const marketValue = side === 'SHORT' ? h.shortEntryValue : quantity * marketPrice;
    const unrealizedPL = side === 'LONG' ? marketValue - costBasis : marketValue - quantity * marketPrice;
    return {
      ticker, company: h.company, quantity,
      averageCost: costBasis / quantity,
      costBasis, marketPrice, marketValue, unrealizedPL,
      unrealizedPLPercent: costBasis > 0 ? unrealizedPL / costBasis * 100 : 0,
      costCurrency: h.currency,
      currency: quote?.currency ?? h.currency, side, quoteSource: quote?.source ?? 'sample',
    };
  });

  const totalMarketValue = holdings.reduce((sum, h) => sum + h.marketValue, 0);
  const totalCostBasis = holdings.reduce((sum, h) => sum + h.costBasis, 0);
  const totalUnrealizedPL = holdings.reduce((sum, h) => sum + h.unrealizedPL, 0);
  return { holdings, totalMarketValue, totalCostBasis, totalUnrealizedPL, totalRealizedPL, realizedPLByTicker, totalPL: totalUnrealizedPL + totalRealizedPL };
}
