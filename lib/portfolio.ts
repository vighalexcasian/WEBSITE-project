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
};

export type Quote = { price: number; currency: string; source: 'sample' | 'live'; updatedAt?: string };
export type Holding = {
  ticker: string; company: string; quantity: number; averageCost: number;
  costBasis: number; marketPrice: number; marketValue: number; unrealizedPL: number;
  unrealizedPLPercent: number; currency: string; costCurrency: string; quoteSource: Quote['source'];
};

// Average-cost method. For real tax reporting, verify the cost-basis method required in your jurisdiction.
export function calculatePortfolio(transactions: Transaction[], quotes: Record<string, Quote>) {
  const buckets = new Map<string, { company: string; quantity: number; costBasis: number; realizedPL: number; currency: string }>();
  let totalRealizedPL = 0;
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  for (const tx of sorted) {
    const key = tx.ticker.toUpperCase();
    const current = buckets.get(key) ?? { company: tx.company, quantity: 0, costBasis: 0, realizedPL: 0, currency: tx.currency };
    current.company = tx.company || current.company;
    current.currency = tx.currency || current.currency;
    if (tx.type === 'BUY') {
      current.quantity += tx.quantity;
      current.costBasis += tx.quantity * tx.price + tx.fees;
    } else {
      if (tx.quantity > current.quantity) throw new Error(`Cannot sell ${tx.quantity} shares of ${key}; only ${current.quantity} available at this point in the ledger.`);
      const averageCost = current.quantity > 0 ? current.costBasis / current.quantity : 0;
      const realized = tx.quantity * tx.price - tx.fees - averageCost * tx.quantity;
      current.realizedPL += realized;
      totalRealizedPL += realized;
      current.costBasis -= averageCost * tx.quantity;
      current.quantity -= tx.quantity;
      if (current.quantity === 0) current.costBasis = 0;
    }
    buckets.set(key, current);
  }

  const holdings: Holding[] = [...buckets.entries()].filter(([, h]) => h.quantity > 0).map(([ticker, h]) => {
    const quote = quotes[ticker];
    const marketPrice = quote?.price ?? (h.quantity > 0 ? h.costBasis / h.quantity : 0);
    const marketValue = h.quantity * marketPrice;
    const unrealizedPL = marketValue - h.costBasis;
    return {
      ticker, company: h.company, quantity: h.quantity,
      averageCost: h.quantity > 0 ? h.costBasis / h.quantity : 0,
      costBasis: h.costBasis, marketPrice, marketValue, unrealizedPL,
      unrealizedPLPercent: h.costBasis > 0 ? unrealizedPL / h.costBasis * 100 : 0,
      costCurrency: h.currency,
      currency: quote?.currency ?? h.currency, quoteSource: quote?.source ?? 'sample',
    };
  });

  const totalMarketValue = holdings.reduce((sum, h) => sum + h.marketValue, 0);
  const totalCostBasis = holdings.reduce((sum, h) => sum + h.costBasis, 0);
  const totalUnrealizedPL = holdings.reduce((sum, h) => sum + h.unrealizedPL, 0);
  return { holdings, totalMarketValue, totalCostBasis, totalUnrealizedPL, totalRealizedPL, totalPL: totalUnrealizedPL + totalRealizedPL };
}
