'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { calculatePortfolio, type Transaction, type Quote } from '@/lib/portfolio';

const initialTransactions: Transaction[] = [
  { id:'t1', date:'2026-01-10', ticker:'MSFT', company:'Microsoft', type:'BUY', quantity:4, price:410, fees:1, currency:'USD' },
  { id:'t2', date:'2026-02-03', ticker:'NOW', company:'ServiceNow', type:'BUY', quantity:2, price:920, fees:1, currency:'USD' },
  { id:'t3', date:'2026-03-12', ticker:'AMD', company:'Advanced Micro Devices', type:'BUY', quantity:5, price:155, fees:1, currency:'USD' },
  { id:'t4', date:'2026-04-20', ticker:'MSFT', company:'Microsoft', type:'BUY', quantity:1, price:390, fees:1, currency:'USD' },
  { id:'t5', date:'2026-06-08', ticker:'NVDA', company:'NVIDIA', type:'BUY', quantity:3, price:145, fees:1, currency:'USD' },
];
const colors = ['#8da9ff','#69d7a2','#d6a6ff','#ffc878','#ff8f9a','#80d9e9'];
const EUR_USD_TICKER = 'EURUSD=X';
const money = (n:number,currency='USD') => new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(n);
const signedMoney = (n:number,currency='USD') => `${n>0?'+':''}${money(n,currency)}`;
const dateKey = (date: string | Date) => (date instanceof Date ? date.toISOString() : date).slice(0, 10);

type PortfolioSnapshot = {
  date: string;
  marketValue: number;
  marketCost: number;
  unrealizedPL: number;
  realizedPL: number;
  totalPL: number;
  uninvestedCash: number;
};

type QuoteApiResult = {
  ticker?: string;
  price?: number;
  currency?: string;
  updatedAt?: string;
  stale?: boolean;
  error?: string;
};

const isTransactionArray = (value: unknown): value is Transaction[] =>
  Array.isArray(value) && value.every((transaction) =>
    transaction &&
    typeof transaction.id === 'string' &&
    typeof transaction.date === 'string' &&
    typeof transaction.ticker === 'string' &&
    typeof transaction.company === 'string' &&
    (transaction.type === 'BUY' || transaction.type === 'SELL') &&
    typeof transaction.quantity === 'number' &&
    typeof transaction.price === 'number' &&
    typeof transaction.fees === 'number' &&
    typeof transaction.currency === 'string'
  );

const isQuoteRecord = (value: unknown): value is Record<string, Quote> =>
  typeof value === 'object' && value !== null && Object.entries(value).every(([, quote]) =>
    typeof quote === 'object' &&
    quote !== null &&
    typeof quote.price === 'number' &&
    Number.isFinite(quote.price) &&
    typeof quote.currency === 'string' &&
    (quote.source === 'live' || quote.source === 'sample')
  );

export default function Home() {
  const [transactions,setTransactions] = useState<Transaction[]>(initialTransactions);
  const [transactionHistory,setTransactionHistory] = useState<Transaction[]>(initialTransactions);
  const [quotes,setQuotes] = useState<Record<string,Quote>>({});
  const [portfolioDataLoaded,setPortfolioDataLoaded] = useState(false);
  const [sectors,setSectors] = useState<Record<string,string | null>>({});
  const [sectorErrors,setSectorErrors] = useState<string[]>([]);
  const [isLoadingSectors,setIsLoadingSectors] = useState(false);
  const [eurUsdRate,setEurUsdRate] = useState<number | null>(null);
  const [isRefreshingQuotes,setIsRefreshingQuotes] = useState(false);
  const [tickerQuoteLookup,setTickerQuoteLookup] = useState<{
    ticker: string;
    status: 'loading' | 'loaded' | 'error';
    quote?: Quote;
    error?: string;
  } | null>(null);
  const [showAdd,setShowAdd] = useState(false);
  const [showTransactions,setShowTransactions] = useState(false);
  const [showDeposits,setShowDeposits] = useState(false);
  const [filter,setFilter] = useState('All assets');
  const [performanceRange,setPerformanceRange] = useState<'3M'|'6M'|'1Y'>('3M');
  const [showBenchmark,setShowBenchmark] = useState(true);
  const [benchmarkHistory,setBenchmarkHistory] = useState<Array<{date:string; value:number}>>([]);
  const [portfolioHistory,setPortfolioHistory] = useState<PortfolioSnapshot[]>(() => {
    if (typeof window === 'undefined') return [];

    try {
      const saved = window.localStorage.getItem('portfolio-history');
      return saved ? (JSON.parse(saved) as PortfolioSnapshot[]) : [];
    } catch {
      return [];
    }
  });
  const [notice,setNotice] = useState('Loading live market data…');
  const [editingTicker,setEditingTicker] = useState<string | null>(null);
  const [manualCash,setManualCash] = useState(25000);
  const [manualRealizedPL,setManualRealizedPL] = useState<Record<string, number>>({});
  const [deposits,setDeposits] = useState<Array<{id:string;date:string;value:number}>>([]);
  const [depositForm,setDepositForm] = useState({date:new Date().toISOString().slice(0,10),value:''});
  const [form,setForm] = useState({date:new Date().toISOString().slice(0,10),ticker:'',company:'',type:'BUY',quantity:'',price:'',fees:'0',currency:'USD'});
  const portfolio = useMemo(()=>calculatePortfolio(transactions,quotes),[transactions,quotes]);

  useEffect(() => {
    try {
      const savedTransactions = window.localStorage.getItem('portfolio-transactions');
      const savedHistory = window.localStorage.getItem('portfolio-transaction-history');
      const savedQuotes = window.localStorage.getItem('portfolio-quotes');
      const parsedTransactions: unknown = savedTransactions ? JSON.parse(savedTransactions) : initialTransactions;
      const parsedHistory: unknown = savedHistory ? JSON.parse(savedHistory) : parsedTransactions;
      const parsedQuotes: unknown = savedQuotes ? JSON.parse(savedQuotes) : {};

      if (!isTransactionArray(parsedTransactions) || !isTransactionArray(parsedHistory) || !isQuoteRecord(parsedQuotes)) {
        throw new Error('Saved portfolio data has an invalid format.');
      }

      setTransactions(parsedTransactions);
      setTransactionHistory(parsedHistory);
      setQuotes(parsedQuotes);
    } catch (error) {
      setNotice(error instanceof Error ? `Unable to restore saved portfolio: ${error.message}` : 'Unable to restore saved portfolio.');
    } finally {
      setPortfolioDataLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!portfolioDataLoaded) return;
    try {
      window.localStorage.setItem('portfolio-transactions', JSON.stringify(transactions));
      window.localStorage.setItem('portfolio-transaction-history', JSON.stringify(transactionHistory));
      window.localStorage.setItem('portfolio-quotes', JSON.stringify(quotes));
    } catch (error) {
      setNotice(error instanceof Error ? `Unable to save portfolio data: ${error.message}` : 'Unable to save portfolio data.');
    }
  }, [portfolioDataLoaded, transactions, transactionHistory, quotes]);

  const convertToUSD = useCallback((amount:number,currency:string):number|null => {
    if (currency !== 'EUR') return amount;
    return eurUsdRate !== null ? amount * eurUsdRate : null;
  }, [eurUsdRate]);
  const totalPortfolioMarketCost = useMemo(() => {
    let total = 0;
    for (const holding of portfolio.holdings) {
      const amount = convertToUSD(holding.quantity * holding.averageCost, holding.costCurrency);
      if (amount === null) return null;
      total += amount;
    }
    return total;
  }, [portfolio.holdings, convertToUSD]);
  const totalPortfolioMarketValue = useMemo(() => {
    let total = 0;
    for (const holding of portfolio.holdings) {
      const amount = convertToUSD(holding.marketValue, holding.currency);
      if (amount === null) return null;
      total += amount;
    }
    return total;
  }, [portfolio.holdings, convertToUSD]);
  const totalPortfolioUnrealizedPL = useMemo(() => {
    let total = 0;
    for (const holding of portfolio.holdings) {
      const marketValue = convertToUSD(holding.marketValue, holding.currency);
      const costBasis = convertToUSD(holding.costBasis, holding.costCurrency);
      if (marketValue === null || costBasis === null) return null;
      total += holding.side === 'SHORT' ? costBasis - marketValue : marketValue - costBasis;
    }
    return total;
  }, [portfolio.holdings, convertToUSD]);
  const totalManualRealizedPL = useMemo(() => {
    let total = 0;
    const tickers = new Set([...Object.keys(manualRealizedPL), ...Object.keys(portfolio.realizedPLByTicker)]);
    for (const ticker of tickers) {
      const value = (portfolio.realizedPLByTicker[ticker] ?? 0) + (manualRealizedPL[ticker] ?? 0);
      const holding = portfolio.holdings.find((entry) => entry.ticker === ticker);
      const transaction = transactions.find((entry) => entry.ticker === ticker);
      const amount = convertToUSD(value, holding?.costCurrency ?? transaction?.currency ?? 'USD');
      if (amount === null) return null;
      total += amount;
    }
    return total;
  }, [manualRealizedPL, portfolio.holdings, portfolio.realizedPLByTicker, transactions, convertToUSD]);
  const quoteTickers = useMemo(
    () => [...new Set([...transactions.map((transaction) => transaction.ticker), EUR_USD_TICKER])],
    [transactions]
  );
  const uninvestedCashPercent = useMemo(
    () => totalPortfolioMarketCost ? (manualCash / totalPortfolioMarketCost) * 100 : 0,
    [manualCash, totalPortfolioMarketCost]
  );
  const allocation = useMemo(
    () => portfolio.holdings
      .map((h) => {
        const costInUSD = convertToUSD(h.quantity * h.averageCost, h.costCurrency);
        return { ...h, weight: totalPortfolioMarketCost && costInUSD !== null ? (costInUSD / totalPortfolioMarketCost) * 100 : 0 };
      })
      .sort((a, b) => b.weight - a.weight),
    [portfolio.holdings, totalPortfolioMarketCost, convertToUSD]
  );
  const sectorCompanies = useMemo(
    () => JSON.stringify(portfolio.holdings
      .map(({ ticker, company }) => ({ ticker, company }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker))),
    [portfolio.holdings]
  );
  const sectorAllocation = useMemo(() => {
    const totals = new Map<string, number>();
    for (const holding of portfolio.holdings) {
      const marketValue = convertToUSD(holding.marketValue, holding.currency);
      if (marketValue === null) return [];
      const sector = sectors[holding.ticker] || 'Sector unavailable';
      totals.set(sector, (totals.get(sector) ?? 0) + marketValue);
    }
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((sector) => sector.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [portfolio.holdings, sectors, convertToUSD]);
  const totalDeposits = useMemo(
    () => deposits.reduce((sum, deposit) => sum + deposit.value, 0),
    [deposits]
  );
  const totalReturnPercent = useMemo(() => {
    if (totalDeposits <= 0 || totalPortfolioUnrealizedPL === null || totalManualRealizedPL === null) return null;
    const portfolioValueAfterProfits = totalDeposits + totalPortfolioUnrealizedPL + totalManualRealizedPL;
    return ((portfolioValueAfterProfits - totalDeposits) / totalDeposits) * 100;
  }, [totalDeposits, totalPortfolioUnrealizedPL, totalManualRealizedPL]);
  const cashBalanceCheckFormula = totalPortfolioMarketCost !== null && totalManualRealizedPL !== null
    ? totalDeposits - totalPortfolioMarketCost + totalManualRealizedPL
    : null;
  const cashBalanceCheckDifference = cashBalanceCheckFormula === null ? null : cashBalanceCheckFormula - manualCash;
  const portfolioCheckFormula = useMemo(() => {
    let total = 0;
    for (const holding of portfolio.holdings) {
      const costBasis = convertToUSD(holding.costBasis, holding.costCurrency);
      const marketValue = convertToUSD(holding.marketValue, holding.currency);
      if (costBasis === null || marketValue === null) return null;
      const unrealizedPL = holding.side === 'SHORT'
        ? costBasis - marketValue
        : marketValue - costBasis;
      total += costBasis + (holding.side === 'SHORT' ? -unrealizedPL : unrealizedPL);
    }
    return total;
  }, [portfolio.holdings, convertToUSD]);
  const portfolioCheckDifference = portfolioCheckFormula === null || totalPortfolioMarketValue === null
    ? null
    : portfolioCheckFormula - totalPortfolioMarketValue;
  const visiblePerformanceSeries = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - (performanceRange === '3M' ? 3 : performanceRange === '6M' ? 6 : 12));
    const cutoffKey = dateKey(cutoff);
    const todayKey = dateKey(new Date());
    const firstAtOrBefore = <T extends { date: string }>(points: T[]) =>
      points.filter((point) => point.date <= cutoffKey).at(-1) ?? points.find((point) => point.date >= cutoffKey);

    const benchmarkPoints = benchmarkHistory
      .filter((point) => point.date <= todayKey && Number.isFinite(point.value))
      .sort((a, b) => a.date.localeCompare(b.date));
    const benchmarkBase = firstAtOrBefore(benchmarkPoints);
    const benchmarkWindow = benchmarkBase
      ? benchmarkPoints.filter((point) => point.date >= benchmarkBase.date)
      : [];
    const benchmarkReturns = benchmarkWindow.map((point) => ({
      date: point.date,
      value: benchmarkBase && benchmarkBase.value > 0 ? ((point.value / benchmarkBase.value) - 1) * 100 : null,
    }));

    const portfolioPoints = portfolioHistory
      .filter((point) => point.date <= todayKey && Number.isFinite(point.marketValue) && point.marketValue > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const portfolioBase = firstAtOrBefore(portfolioPoints);
    const portfolioWindow = portfolioBase
      ? portfolioPoints.filter((point) => point.date >= portfolioBase.date)
      : [];
    const portfolioReturns = portfolioWindow.map((point) => ({
      date: point.date,
      value: portfolioBase && portfolioBase.marketValue > 0 ? ((point.marketValue / portfolioBase.marketValue) - 1) * 100 : null,
    }));

    const dates = [...new Set([
      ...benchmarkReturns.map((point) => point.date),
      ...portfolioReturns.map((point) => point.date),
    ])].sort((a, b) => a.localeCompare(b));
    let benchmarkIndex = -1;
    let portfolioIndex = -1;

    return dates.map((date) => {
      while (benchmarkIndex + 1 < benchmarkReturns.length && benchmarkReturns[benchmarkIndex + 1].date <= date) benchmarkIndex += 1;
      while (portfolioIndex + 1 < portfolioReturns.length && portfolioReturns[portfolioIndex + 1].date <= date) portfolioIndex += 1;

      return {
        date,
        benchmark: benchmarkIndex >= 0 ? benchmarkReturns[benchmarkIndex].value : null,
        portfolio: portfolioIndex >= 0 ? portfolioReturns[portfolioIndex].value : null,
      };
    });
  }, [benchmarkHistory, performanceRange, portfolioHistory]);
  const performanceMonthTicks = useMemo(() => {
    const months = new Set<string>();
    return visiblePerformanceSeries.flatMap((point) => {
      const month = point.date.slice(0, 7);
      if (months.has(month)) return [];
      months.add(month);
      return [point.date];
    });
  }, [visiblePerformanceSeries]);

  const lookupTickerQuote = async (ticker: string) => {
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!normalizedTicker) return;

    setTickerQuoteLookup({ ticker: normalizedTicker, status: 'loading' });
    try {
      const response = await fetch(`/api/quote?ticker=${encodeURIComponent(normalizedTicker)}`, { cache: 'no-store' });
      const data = await response.json() as QuoteApiResult;
      if (!response.ok) {
        throw new Error(data.error ?? `Quote request failed (${response.status}).`);
      }
      if (data.ticker !== normalizedTicker) {
        throw new Error('The quote response did not match the requested ticker.');
      }
      if (typeof data.price !== 'number' || !Number.isFinite(data.price)) {
        throw new Error(data.error ?? 'The quote service did not return a valid price for this ticker.');
      }

      const quote: Quote = {
        price: data.price,
        currency: data.currency ?? 'USD',
        source: 'live',
        updatedAt: data.updatedAt,
      };
      setQuotes((previous) => ({ ...previous, [normalizedTicker]: quote }));
      setTickerQuoteLookup({
        ticker: normalizedTicker,
        status: 'loaded',
        quote,
        error: data.stale ? 'Showing a cached quote; it may be delayed.' : undefined,
      });
    } catch (error) {
      setTickerQuoteLookup({
        ticker: normalizedTicker,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unable to retrieve this quote.',
      });
    }
  };

  const refreshQuotes = async (tickers:string[]) => {
    const uniqueTickers = [...new Set(tickers.map(t=>t.trim().toUpperCase()).filter(Boolean))];
    if (!uniqueTickers.length) return;

    setIsRefreshingQuotes(true);
    try {
      const response = await fetch(`/api/quote?tickers=${encodeURIComponent(uniqueTickers.join(','))}`, { cache: 'no-store' });
      const data = await response.json() as {
        quotes?: QuoteApiResult[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? `Quote request failed (${response.status}).`);
      }
      const fetched = uniqueTickers.map((ticker) => {
        const quoteResult = data.quotes?.find((result) => result.ticker === ticker);
        if (!quoteResult) {
          return { ticker, error: 'The quote response did not contain this ticker.' };
        }
        if (typeof quoteResult.price !== 'number' || !Number.isFinite(quoteResult.price)) {
          return { ticker, error: quoteResult.error ?? 'The quote response did not contain a valid price.' };
        }
        return {
          ticker,
          stale: quoteResult.stale ?? false,
          staleMessage: quoteResult.error,
          quote: {
            price: quoteResult.price,
            currency: quoteResult.currency ?? 'USD',
            source: 'live' as const,
            updatedAt: quoteResult.updatedAt,
          },
        };
      });

      const fxQuote = fetched.find((result) => result.ticker === EUR_USD_TICKER)?.quote;
      const nextQuotes = Object.fromEntries(fetched.flatMap((result) => result.quote && result.ticker !== EUR_USD_TICKER ? [[result.ticker, result.quote] as const] : []));
      const failedQuotes = fetched.filter((result) => result.error);
      const staleQuotes = fetched.filter((result) => result.stale);
      if (fxQuote) {
        setEurUsdRate(fxQuote.price);
      }
      if (Object.keys(nextQuotes).length) {
        setQuotes((prev) => ({ ...prev, ...nextQuotes }));
      }
      setNotice(
        failedQuotes.length
          ? `Updated ${Object.keys(nextQuotes).length} quote${Object.keys(nextQuotes).length === 1 ? '' : 's'}; unable to refresh ${failedQuotes.map(({ ticker }) => ticker).join(', ')}. ${[...new Set(failedQuotes.map(({ error }) => error))].join(' ')}`
          : staleQuotes.length
            ? `Showing cached quotes for ${staleQuotes.map(({ ticker }) => ticker).join(', ')}. ${[...new Set(staleQuotes.map(({ staleMessage }) => staleMessage).filter(Boolean))].join(' ')}`
          : `Quote data refreshed for ${uniqueTickers.length} symbol${uniqueTickers.length === 1 ? '' : 's'}.`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to refresh quotes.';
      setNotice(`Unable to refresh quotes: ${errorMessage}`);
    } finally {
      setIsRefreshingQuotes(false);
    }
  };

  useEffect(() => {
    if (!portfolioDataLoaded) return;

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void refreshQuotes(quoteTickers);
      }
    };
    const refreshOnVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    refresh();
    const intervalId = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refreshOnVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshOnVisibilityChange);
    };
  }, [portfolioDataLoaded, quoteTickers]);

  useEffect(() => {
    const holdings: Array<{ ticker: string; company: string }> = JSON.parse(sectorCompanies || '[]');
    let active = true;

    if (holdings.length === 0) {
      setSectors({});
      setSectorErrors([]);
      setIsLoadingSectors(false);
      return () => {
        active = false;
      };
    }

    setIsLoadingSectors(true);
    setSectorErrors([]);
    Promise.all(holdings.map(async ({ ticker, company }) => {
      try {
        const params = new URLSearchParams({ ticker, company });
        const response = await fetch(`/api/sector?${params.toString()}`, { cache: 'no-store' });
        const data = await response.json() as { sector?: string | null; error?: string };
        if (!response.ok) {
          return { ticker, sector: null, error: data.error ?? `Request failed (${response.status}).` };
        }
        return {
          ticker,
          sector: typeof data.sector === 'string' && data.sector ? data.sector : null,
          error: null,
        };
      } catch (error) {
        return {
          ticker,
          sector: null,
          error: error instanceof Error ? error.message : 'Unable to fetch sector data.',
        };
      }
    })).then((results) => {
      if (!active) return;
      setSectors(Object.fromEntries(results.map((result) => [result.ticker, result.sector] as const)));
      setSectorErrors(results.filter((result) => result.error).map((result) => result.ticker));
      setIsLoadingSectors(false);
    });

    return () => {
      active = false;
    };
  }, [sectorCompanies]);

  useEffect(() => {
    if (
      totalPortfolioMarketValue === null ||
      totalPortfolioMarketCost === null ||
      totalPortfolioUnrealizedPL === null ||
      totalManualRealizedPL === null
    ) return;

    const dateKey = new Date().toISOString().slice(0, 10);
    const snapshot: PortfolioSnapshot = {
      date: dateKey,
      marketValue: totalPortfolioMarketValue,
      marketCost: totalPortfolioMarketCost,
      unrealizedPL: totalPortfolioUnrealizedPL,
      realizedPL: totalManualRealizedPL,
      totalPL: totalPortfolioUnrealizedPL + totalManualRealizedPL,
      uninvestedCash: manualCash,
    };

    setPortfolioHistory((prev) => {
      const previous = prev.at(-1);
      const next = previous && previous.date === dateKey ? [...prev.slice(0, -1), snapshot] : [...prev, snapshot];

      if (typeof window !== 'undefined') {
        window.localStorage.setItem('portfolio-history', JSON.stringify(next));
      }

      return next;
    });
  }, [manualCash, totalPortfolioMarketValue, totalPortfolioMarketCost, totalPortfolioUnrealizedPL, totalManualRealizedPL]);

  useEffect(() => {
    let active = true;

    fetch('/api/sp500')
      .then((response) => {
        if (!response.ok) throw new Error(`S&P 500 request failed (${response.status}).`);
        return response.json() as Promise<Array<{ date: string | Date; close: number }>>;
      })
      .then((data) => {
        if (!active || !Array.isArray(data)) return;

        const loaded = data
          .filter((entry) => entry && typeof entry.close === 'number' && Number.isFinite(entry.close) && entry.date)
          .map((entry) => ({
            date: dateKey(entry.date),
            value: Number(entry.close),
          }))
          .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-252);

        if (loaded.length > 0) {
          setBenchmarkHistory(loaded);
        }
      })
      .catch(() => {
        if (active) {
          setBenchmarkHistory([]);
        }
      });

    return () => {
      active = false;
    };
  }, []);
  const resetForm = () => {
    setForm({date:new Date().toISOString().slice(0,10),ticker:'',company:'',type:'BUY',quantity:'',price:'',fees:'0',currency:'USD'});
    setTickerQuoteLookup(null);
  };
  const openAddTransaction = () => {
    setEditingTicker(null);
    resetForm();
    setShowAdd(true);
  };
  const openEditPosition = (ticker:string) => {
    const latest = [...transactions].filter(t=>t.ticker===ticker).sort((a,b)=>b.date.localeCompare(a.date))[0];
    if (!latest) return;
    setEditingTicker(ticker);
    setForm({date:latest.date,ticker:latest.ticker,company:latest.company,type:latest.type,quantity:String(latest.quantity),price:String(latest.price),fees:String(latest.fees),currency:latest.currency});
    setShowAdd(true);
  };
  const closeTransactionModal = () => {
    setShowAdd(false);
    setEditingTicker(null);
    resetForm();
  };
  const addTransaction = (e:React.FormEvent) => {
    e.preventDefault();
    const ticker=form.ticker.trim().toUpperCase(); const quantity=Number(form.quantity); const price=Number(form.price); const fees=Number(form.fees||0);
    if(!ticker||!quantity||quantity<=0||!price||price<=0){setNotice('Enter a valid ticker, quantity and price.');return;}
    const existing=transactions.filter(t=>t.ticker===ticker).at(-1);
    const tx:Transaction={id:crypto.randomUUID(),date:form.date,ticker,company:form.company.trim()||existing?.company||ticker,type:form.type as 'BUY'|'SELL',quantity,price,fees,currency:form.currency};

    if (editingTicker) {
      const latestTx = [...transactions].filter(t=>t.ticker===editingTicker).sort((a,b)=>b.date.localeCompare(a.date))[0];
      if (!latestTx) {
        setNotice('The position you tried to edit no longer exists.');
        return;
      }
      const next = transactions.map(t => t.id===latestTx.id ? { ...t, date:form.date, ticker, company:form.company.trim()||existing?.company||ticker, type:form.type as 'BUY'|'SELL', quantity, price, fees, currency:form.currency } : t);
      try {
        calculatePortfolio(next,quotes);
        setTransactions(next);
        setTransactionHistory((prev)=>
          prev.map((t) => t.id === latestTx.id ? { ...t, date: form.date, ticker, company: form.company.trim() || existing?.company || ticker, type: form.type as 'BUY' | 'SELL', quantity, price, fees, currency: form.currency } : t)
        );
        setShowAdd(false);
        setEditingTicker(null);
        resetForm();
        setNotice(`${ticker} position updated.`);
      } catch(err) { setNotice(err instanceof Error?err.message:'Could not update position.'); }
      return;
    }

    try { calculatePortfolio([...transactions,tx],quotes); } catch(err) { setNotice(err instanceof Error?err.message:'Could not add transaction.'); return; }
    setTransactions(prev=>[...prev,tx]);
    setTransactionHistory(prev=>[...prev,tx]);
    setQuotes(prev=>({...prev,[ticker]:prev[ticker]??{price,currency:form.currency,source:'sample'}}));
    setShowAdd(false); setNotice(`Transaction added. Fetching the latest Yahoo Finance price for ${ticker}…`); resetForm();
    void refreshQuotes([ticker]);
  };
  const removeTransaction = (id:string) => {
    const nextHistory = transactionHistory.filter(t=>t.id!==id);
    setTransactionHistory(nextHistory);
    setNotice('Transaction removed from history.');
  };
  const addDeposit = (e:React.FormEvent) => {
    e.preventDefault();
    const value = Number(depositForm.value);
    if (!depositForm.date || !Number.isFinite(value) || value <= 0) {
      setNotice('Enter a valid date and deposit value.');
      return;
    }
    setDeposits(prev => [{ id: crypto.randomUUID(), date: depositForm.date, value }, ...prev]);
    setDepositForm({ date: new Date().toISOString().slice(0,10), value: '' });
    setNotice('Deposit added.');
  };
  const removeDeposit = (id:string) => {
    setDeposits(prev => prev.filter(d => d.id !== id));
    setNotice('Deposit removed.');
  };

const removePosition = (ticker: string) => {
  const confirmed = window.confirm(
    `Remove ${ticker} and all its transactions from this portfolio?`
  );

  if (!confirmed) return;

  const next = transactions.filter(
    (transaction) => transaction.ticker !== ticker
  );

  try {
    calculatePortfolio(next, quotes);
    setTransactions(next);
    setTransactionHistory((prev) => prev.filter((transaction) => transaction.ticker !== ticker));
    setQuotes((prev) => {
      const nextQuotes = { ...prev };
      delete nextQuotes[ticker];
      return nextQuotes;
    });
    setManualRealizedPL((prev) => {
      const nextManualRealizedPL = { ...prev };
      delete nextManualRealizedPL[ticker];
      return nextManualRealizedPL;
    });
    setNotice(`${ticker} and its transaction history removed.`);
  } catch (error) {
    setNotice(
      error instanceof Error
        ? error.message
        : 'Unable to remove position.'
    );
  }
};

  return <div className="app-shell grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)]">
    <aside className="sidebar">
      <div className="brand"><span>investment tracker<span style={{color:'#8da9ff'}}>.</span></span></div>
      <div><div className="nav-label">WORKSPACE</div><div className="nav-item active"><span className="nav-icon">▦</span>Portfolio overview</div><div className="nav-item" onClick={()=>setNotice('Risk analytics will be added after the portfolio ledger is complete.')} role="button"><span className="nav-icon">◉</span>Risk analytics</div></div>
      <div><div className="nav-label">PREFERENCES</div><div className="nav-item" onClick={()=>setNotice('Settings and account persistence will be configured in a later step.')} role="button"><span className="nav-icon">⚙</span>Settings</div></div>
    </aside>
    <main className="main min-w-0 p-4 md:p-8">
      <header className="topbar"><div><div className="eyebrow">INVESTMENT WORKSPACE / OVERVIEW</div><h1 className="page-title">Portfolio overview</h1></div><div className="top-actions"><span className="pill">◷ &nbsp; {new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</span><button className="button-secondary" type="button" onClick={()=>void refreshQuotes(quoteTickers)} disabled={isRefreshingQuotes}>{isRefreshingQuotes?'Refreshing…':'Refresh prices'}</button><button className="button-primary" onClick={openAddTransaction}>＋ Add transaction</button><div className="avatar">A</div></div></header>
      <div style={{fontSize:11,color:'var(--muted)',marginBottom:15,display:'flex',alignItems:'center',gap:8}}><span style={{width:7,height:7,background:'#e5b765',borderRadius:'50%',display:'inline-block'}}/> {notice}</div>
      <section className="metrics grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Metric label="Deposited cash" value={money(totalDeposits)} note={totalReturnPercent === null ? 'Return unavailable' : `${totalReturnPercent >= 0 ? '+' : ''}${totalReturnPercent.toFixed(2)}% total return`} icon="▣" noteTone={totalReturnPercent !== null && totalReturnPercent >= 0?'positive':'negative'} />
        <Metric label="Portfolio market cost" value={totalPortfolioMarketCost === null ? 'FX rate unavailable' : money(totalPortfolioMarketCost)} note="" icon="▢" />
        <Metric label="Portfolio market value" value={totalPortfolioMarketValue === null ? 'FX rate unavailable' : money(totalPortfolioMarketValue)} note="" icon="◈" />
        <Metric label="Unrealized profit / loss" value={totalPortfolioUnrealizedPL === null ? 'FX rate unavailable' : signedMoney(totalPortfolioUnrealizedPL)} note="" icon="↗" tone={totalPortfolioUnrealizedPL !== null && totalPortfolioUnrealizedPL>=0?'positive':'negative'} />
        <Metric label="Realized profit / loss" value={totalManualRealizedPL === null ? 'FX rate unavailable' : signedMoney(totalManualRealizedPL)} note="" icon="⇄" tone={totalManualRealizedPL !== null && totalManualRealizedPL>=0?'positive':'negative'} />
        <Metric label="Uninvested cash" value={<input aria-label="Uninvested cash" className="usd-input" type="text" inputMode="decimal" value={money(manualCash, 'USD')} onFocus={(e) => e.target.select()} onChange={e=>{ const cleaned = e.target.value.replace(/[^\d.-]/g, ''); const nextValue = Number(cleaned); setManualCash(Number.isFinite(nextValue) ? nextValue : 0); }} style={{width:'100%',minWidth:150,maxWidth:220,background:'transparent',border:'none',outline:'none',boxShadow:'none',color:'var(--text)',padding:0,fontSize:28,textAlign:'left',fontWeight:700,appearance:'none',WebkitAppearance:'none',MozAppearance:'textfield'}} />} note={totalPortfolioMarketCost === null ? 'FX rate unavailable' : `${uninvestedCashPercent.toFixed(2)}% of portfolio market cost`} />
      </section>
      <section className="portfolio-checks grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="Portfolio verification checks">
        <VerificationCheck
          title="Cash balance check"
          formula="Deposited cash − portfolio market cost + realized P/L"
          calculated={cashBalanceCheckFormula}
          comparedLabel="Account cash balance"
          compared={manualCash}
          difference={cashBalanceCheckDifference}
        />
        <VerificationCheck
          title="Portfolio check"
          formula="Portfolio market cost + unrealized P/L"
          calculated={portfolioCheckFormula}
          comparedLabel="Portfolio market value"
          compared={totalPortfolioMarketValue}
          difference={portfolioCheckDifference}
        />
      </section>
      <section className="content-grid grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="panel performance-panel"><div className="panel-heading"><div><h2 className="panel-title">Portfolio performance</h2><div className="panel-subtitle">Daily gains rebased to 0% at the last available observation on or before each range starts</div></div><div className="performance-controls"><div style={{display:'flex',gap:8}}>{['3M','6M','1Y'].map((range) => (
          <button
            key={range}
            className="button-secondary"
            type="button"
            onClick={() => setPerformanceRange(range as '3M' | '6M' | '1Y')}
            style={{
              padding:'7px 10px',
              fontSize:11,
              background: performanceRange === range ? 'rgba(141,169,255,0.18)' : undefined,
              borderColor: performanceRange === range ? '#8da9ff' : undefined,
              color: performanceRange === range ? '#edf0f7' : undefined,
            }}
          >
            {range}
          </button>
        ))}</div><button className="button-secondary benchmark-toggle" type="button" aria-pressed={showBenchmark} onClick={() => setShowBenchmark((visible) => !visible)}>S&amp;P 500 {showBenchmark ? 'ON' : 'OFF'}</button></div></div><div className="chart-legend"><span><i className="legend-dot" style={{background:'var(--blue)'}}/>Portfolio gain %</span>{showBenchmark && <span><i className="legend-dot" style={{background:'#7d8aa8'}}/>S&amp;P 500 gain %</span>}</div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={visiblePerformanceSeries} margin={{top:18,right:4,left:-18,bottom:0}}><defs><linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8da9ff" stopOpacity={0.26}/><stop offset="100%" stopColor="#8da9ff" stopOpacity={0}/></linearGradient><linearGradient id="benchmarkGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7d8aa8" stopOpacity={0.18}/><stop offset="100%" stopColor="#7d8aa8" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#252a35" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" ticks={performanceMonthTicks} tick={{fill:'#788397',fontSize:10}} axisLine={false} tickLine={false} interval={0} tickFormatter={(value:string)=>new Date(`${value}T00:00:00`).toLocaleDateString('en-US',{month:'short'})}/><YAxis tick={{fill:'#788397',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`${v >= 0 ? '+' : ''}${Number(v).toFixed(0)}%`}/><Tooltip contentStyle={{background:'#171b25',border:'1px solid #303746',borderRadius:9,fontSize:12}} labelFormatter={(label)=>new Date(`${label}T00:00:00`).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})} formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name === 'portfolio' ? 'Portfolio gain %' : 'S&P 500 gain %']} /><Area type="monotone" dataKey="portfolio" stroke="#8da9ff" strokeWidth={2} fill="url(#valueGradient)"/>{showBenchmark && <Area type="monotone" dataKey="benchmark" stroke="#7d8aa8" strokeWidth={2} fill="url(#benchmarkGradient)" strokeDasharray="5 5"/>}</AreaChart></ResponsiveContainer></div></div>
        <div className="panel"><div className="panel-heading"><div><h2 className="panel-title">Asset allocation</h2><div className="panel-subtitle">Sector exposure by current market value</div></div><span className="pill">{allocation.length} assets</span></div>
          {allocation.length > 0 && <div className="sector-allocation">
            {totalPortfolioMarketValue === null
              ? <div className="empty">Sector allocation is unavailable until the currency conversion rate loads.</div>
              : sectorAllocation.length > 0
                ? <div className="sector-chart-layout">
                  <div className="sector-chart" role="img" aria-label={`Sector allocation: ${sectorAllocation.map((sector) => `${sector.name} ${((sector.value / sectorAllocation.reduce((sum, item) => sum + item.value, 0)) * 100).toFixed(1)}%`).join(', ')}`}>
                    <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sectorAllocation} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3} stroke="none">{sectorAllocation.map((sector, index) => <Cell key={sector.name} fill={colors[index % colors.length]} />)}</Pie><Tooltip contentStyle={{background:'#171b25',border:'1px solid #303746',borderRadius:9,fontSize:12,color:'#fff'}} itemStyle={{color:'#fff'}} labelStyle={{color:'#fff'}} formatter={(value, name) => [`${((Number(value) / sectorAllocation.reduce((sum, item) => sum + item.value, 0)) * 100).toFixed(1)}%`, name]} /></PieChart></ResponsiveContainer>
                  </div>
                  <div className="sector-legend">{sectorAllocation.map((sector, index) => {
                    const total = sectorAllocation.reduce((sum, item) => sum + item.value, 0);
                    return <div className="sector-legend-item" key={sector.name}><span className="allocation-color" style={{background:colors[index % colors.length]}}/><span className="sector-name">{sector.name}</span><strong>{((sector.value / total) * 100).toFixed(1)}%</strong></div>;
                  })}</div>
                </div>
                : <div className="empty">No sector market values are available.</div>}
            {sectorErrors.length > 0 && <div className="sector-status" role="status">Yahoo Finance could not return sector details for {sectorErrors.join(', ')}.</div>}
            {isLoadingSectors && <div className="sector-status" role="status">Loading sector classifications from Yahoo Finance…</div>}
          </div>}
          {allocation.length > 0 && <h3 className="allocation-section-title">Position weights · market cost</h3>}
          <div className="allocation-list">
            {allocation.length
              ? allocation.map((holding, index) => (
                <div key={holding.ticker}>
                  <div className="allocation-head">
                    <div className="allocation-name">
                      <span className="allocation-color" style={{background:colors[index % colors.length]}} />
                      <span>{holding.ticker}<small className={`position-side-tag ${holding.side.toLowerCase()}`}>{holding.side}</small><small className="sector-label">{sectors[holding.ticker] ?? (isLoadingSectors ? 'Loading sector…' : 'Sector unavailable')}</small></span>
                    </div>
                    <div className="allocation-actions" style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontWeight:700}}>{holding.weight.toFixed(1)}%</span>
                      <button className="button-secondary" onClick={() => openEditPosition(holding.ticker)} style={{padding:'5px 8px',fontSize:10,lineHeight:1.2}} type="button">Edit</button>
                      <button className="button-secondary" onClick={() => removePosition(holding.ticker)} style={{padding:'5px 8px',fontSize:10,lineHeight:1.2}} type="button">Remove</button>
                    </div>
                  </div>
                  <div className="track"><div className="track-fill" style={{width:`${holding.weight}%`,background:colors[index % colors.length]}} /></div>
                </div>
              ))
              : <div className="empty">Add a transaction to see allocation.</div>}
          </div>
          <div style={{borderTop:'1px solid var(--border)',marginTop:20,paddingTop:16,display:'flex',justifyContent:'space-between',fontSize:11}}><span style={{color:'var(--muted)'}}>Number of positions</span><span>{allocation.length}</span></div></div>
      </section>
      <section className="panel table-panel"><div className="table-head"><div><h2 className="panel-title">Your holdings</h2><div className="panel-subtitle">Quote checks run every minute; Yahoo Finance results are cached for 10 minutes</div></div><div style={{display:'flex',gap:8}}><select className="button-secondary" value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter holdings"><option>All assets</option><option>Profitable</option><option>At a loss</option></select><button className="button-secondary" onClick={()=>{ setShowTransactions(v=>!v); setShowDeposits(false); }}>{showTransactions?'Hide history':'Transaction history'} ↗</button><button className="button-secondary" onClick={()=>{ setShowDeposits(v=>!v); setShowTransactions(false); }}>{showDeposits?'Hide deposits':'Deposits'} ↗</button></div></div><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Shares</th><th>Avg. cost</th><th>Last price*</th><th>Investment cost</th><th>Market value</th><th>Unrealized P/L</th><th>Return</th><th>Realized P/L</th><th>Action</th></tr></thead><tbody>{allocation.filter(h=>filter==='All assets'||(filter==='Profitable'?h.unrealizedPL>=0:h.unrealizedPL<0)).map(h=><tr key={h.ticker}><td><div className="ticker-cell"><div className="stock-logo">{h.ticker.slice(0,2)}</div><div><div style={{display:'flex',alignItems:'center',gap:7}}>      <div className="ticker">{h.ticker}</div><small className={`position-side-tag ${h.side.toLowerCase()}`}>{h.side}</small><a className="button-secondary" href={`https://finance.yahoo.com/quote/${encodeURIComponent(h.ticker)}/`} target="_blank" rel="noopener noreferrer" style={{padding:'3px 6px',fontSize:9,lineHeight:1.2}}>View on Yahoo</a></div><div className="company">{h.company}</div><small className="sector-label">{sectors[h.ticker] ?? (isLoadingSectors ? 'Loading sector…' : 'Sector unavailable')}</small></div></div></td><td>{h.quantity.toLocaleString('en-US',{maximumFractionDigits:6})}</td><td>{money(h.averageCost,h.currency)}</td><td title={quotes[h.ticker]?.updatedAt ? `Yahoo Finance update: ${new Date(quotes[h.ticker]?.updatedAt ?? '').toLocaleString()}` : 'Yahoo Finance quote unavailable; using transaction cost as a fallback.'} style={{fontWeight:600}}><div>{money(h.marketPrice,h.currency)}</div>{h.quoteSource !== 'live' && <small className="quote-fallback-label">{isRefreshingQuotes || !portfolioDataLoaded ? 'Loading live quote…' : 'Transaction-price fallback'}</small>}</td><td>{money(h.quantity * h.averageCost,h.currency)}</td><td style={{fontWeight:700}}>{money(h.marketValue,h.currency)}</td><td className={h.unrealizedPL>=0?'positive':'negative'}>{signedMoney(h.unrealizedPL,h.currency)}</td><td><span className={h.unrealizedPL>=0?'tag':'tag'} style={h.unrealizedPL<0?{background:'#3a252c',color:'var(--red)'}:{}}>{h.unrealizedPLPercent>=0?'+':''}{h.unrealizedPLPercent.toFixed(2)}%</span></td><td><input aria-label={`Realized P/L for ${h.ticker}`} type="text" inputMode="decimal" value={money(manualRealizedPL[h.ticker] ?? 0, h.currency)} onFocus={(e) => e.target.select()} onChange={e=>{ const raw = e.target.value.replace(/[^\d.-]/g,''); const numericValue = raw === '' ? 0 : Number(raw); setManualRealizedPL((prev)=>({ ...prev, [h.ticker]: Number.isFinite(numericValue) ? numericValue : 0 })); }} style={{width:90,background:'transparent',border:'1px solid #303746',borderRadius:6,color:(manualRealizedPL[h.ticker] ?? 0) >= 0 ? '#69d7a2' : '#ff7e86',padding:'6px 8px',fontSize:12,textAlign:'right',fontWeight:600,outline:'none'}} /></td><td><div style={{display:'flex',gap:6,justifyContent:'flex-start'}}><button className="button-secondary" onClick={()=>openEditPosition(h.ticker)} style={{padding:'6px 8px',fontSize:10,lineHeight:1.2}} type="button">Edit</button><button className="button-secondary" onClick={()=>removePosition(h.ticker)} type="button">Remove</button></div></td></tr>)}{!allocation.length&&<tr><td colSpan={8} className="empty">No holdings yet. Add a buy transaction to get started.</td></tr>}</tbody></table></div></section>
    
      {showTransactions&&<section className="panel table-panel" style={{marginTop:16}}><div className="table-head"><div><h2 className="panel-title">Transaction ledger</h2><div className="panel-subtitle">Buys and sells used to calculate positions</div></div><button className="button-primary" onClick={openAddTransaction}>＋ Add</button></div><div className="table-scroll"><table><thead><tr><th>Date</th><th>Asset</th><th>Type</th><th>Quantity</th><th>Price</th><th>Fees</th><th>Action</th></tr></thead><tbody>{[...transactionHistory].sort((a,b)=>b.date.localeCompare(a.date)).map(t=><tr key={t.id}><td>{t.date}</td><td style={{textAlign:'left'}}><b>{t.ticker}</b><div className="company">{t.company}</div></td><td><span className={t.type==='BUY'?'tag':'tag muted-tag'}>{t.type}</span></td><td>{t.quantity}</td><td>{money(t.price,t.currency)}</td><td>{money(t.fees,t.currency)}</td><td><div style={{display:'flex',gap:6}}><button className="button-secondary" onClick={()=>openEditPosition(t.ticker)} type="button">Edit</button><button className="button-secondary" onClick={()=>removeTransaction(t.id)}>Remove</button></div></td></tr>)}</tbody></table></div></section>}
      {showDeposits&&<section className="panel table-panel" style={{marginTop:16}}><div className="table-head"><div><h2 className="panel-title">Deposits</h2><div className="panel-subtitle">Manual cash deposits by date and value</div></div></div><form className="deposit-form" onSubmit={addDeposit} style={{display:'flex',gap:10,alignItems:'end',padding:'12px 0 16px'}}><div className="field" style={{marginBottom:0,minWidth:140}}><label>Date</label><input type="date" required value={depositForm.date} onChange={e=>setDepositForm({...depositForm,date:e.target.value})}/></div><div className="field" style={{marginBottom:0,minWidth:160}}><label>Value</label><input type="number" min="0.01" step="0.01" required placeholder="2500.00" value={depositForm.value} onChange={e=>setDepositForm({...depositForm,value:e.target.value})}/></div><button className="button-primary" type="submit">＋ Add deposit</button></form><div className="table-scroll"><table><thead><tr><th>Date</th><th>Value</th><th>Action</th></tr></thead><tbody>{deposits.length ? deposits.map(d=> <tr key={d.id}><td>{d.date}</td><td>{money(d.value)}</td><td><button className="button-secondary" onClick={()=>removeDeposit(d.id)} type="button">Remove</button></td></tr>) : <tr><td colSpan={3} style={{textAlign:'center',color:'var(--muted)'}}>No deposits recorded.</td></tr>}</tbody></table></div></section>}
      <div className="footer-note">Prototype only. Starter transactions are illustrative; position prices are fetched from the quote API when available. Before relying on the figures, implement persistent storage, currency conversion, dividends, corporate actions, and validated quote data.</div>
    </main>
    {showAdd && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeTransactionModal(); }}>
      <div className="modal">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title" style={{fontSize:19}}>{editingTicker ? 'Edit position' : 'Add transaction'}</h2>
            <div className="panel-subtitle">{editingTicker ? 'Update this holding and its position details' : 'Record a stock purchase or sale'}</div>
          </div>
          <button className="button-secondary" onClick={closeTransactionModal}>✕</button>
        </div>
        <form onSubmit={addTransaction}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="transaction-date">Date</label>
              <input id="transaction-date" type="date" required value={form.date} onChange={(e) => setForm({...form,date:e.target.value})}/>
            </div>
            <div className="field">
              <label htmlFor="transaction-type">Transaction type</label>
              <select id="transaction-type" value={form.type} onChange={(e) => setForm({...form,type:e.target.value})}>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="transaction-ticker">Ticker</label>
              <input
                id="transaction-ticker"
                required
                placeholder="e.g. MSFT"
                value={form.ticker}
                onChange={(e) => setForm({...form,ticker:e.target.value.toUpperCase()})}
                onBlur={(e) => { void lookupTickerQuote(e.currentTarget.value); }}
              />
              {tickerQuoteLookup?.ticker === form.ticker.trim().toUpperCase() && (
                <div className="quote-lookup-status" aria-live="polite">
                  {tickerQuoteLookup.status === 'loading' && `Looking up ${tickerQuoteLookup.ticker} on Yahoo Finance…`}
                  {tickerQuoteLookup.status === 'loaded' && tickerQuoteLookup.quote &&
                    `Yahoo Finance last price: ${money(tickerQuoteLookup.quote.price, tickerQuoteLookup.quote.currency)}`}
                  {tickerQuoteLookup.status === 'loaded' && tickerQuoteLookup.error}
                  {tickerQuoteLookup.status === 'error' && tickerQuoteLookup.error}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="transaction-company">Company name (optional)</label>
              <input id="transaction-company" placeholder="Microsoft" value={form.company} onChange={(e) => setForm({...form,company:e.target.value})}/>
            </div>
            <div className="field">
              <label htmlFor="transaction-quantity">Quantity</label>
              <input id="transaction-quantity" type="number" min="0.000001" step="any" required placeholder="10" value={form.quantity} onChange={(e) => setForm({...form,quantity:e.target.value})}/>
            </div>
            <div className="field">
              <label htmlFor="transaction-price">Price per share</label>
              <input id="transaction-price" type="number" min="0.000001" step="any" required placeholder="420.00" value={form.price} onChange={(e) => setForm({...form,price:e.target.value})}/>
            </div>
            <div className="field">
              <label htmlFor="transaction-fees">Fees / commission</label>
              <input id="transaction-fees" type="number" min="0" step="any" value={form.fees} onChange={(e) => setForm({...form,fees:e.target.value})}/>
            </div>
            <div className="field">
              <label htmlFor="transaction-currency">Trade currency</label>
              <select id="transaction-currency" value={form.currency} onChange={(e) => setForm({...form,currency:e.target.value})}>
                <option>USD</option>
                <option>EUR</option>
                <option>GBP</option>
                <option>RON</option>
              </select>
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:9,marginTop:22}}>
            <button type="button" className="button-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="button-primary" type="submit">Save transaction</button>
          </div>
          <div className="footer-note">Enter the execution price and fees in the transaction currency. Yahoo Finance looks up the ticker when you leave the ticker field and refreshes it after saving.</div>
        </form>
      </div>
    </div>}
  </div>;
}
function VerificationCheck({title,formula,calculated,comparedLabel,compared,difference}:{title:string;formula:string;calculated:number|null;comparedLabel:string;compared:number|null;difference:number|null}) {
  const isBalanced = difference !== null && Math.abs(difference) < 0.01;
  return <div className="verification-check">
    <div className="verification-heading">
      <h2 className="panel-title">{title}</h2>
      <span className={`tag ${isBalanced ? '' : 'muted-tag'}`} style={isBalanced ? undefined : {background:'#3a252c',color:'var(--red)'}}>
        {difference === null ? 'Unavailable' : isBalanced ? 'Balanced' : 'Difference'}
      </span>
    </div>
    <div className="verification-formula">{formula}</div>
    <div className="verification-values">
      <div><span>Calculated</span><strong>{calculated === null ? 'Unavailable' : money(calculated)}</strong></div>
      <div><span>{comparedLabel}</span><strong>{compared === null ? 'Unavailable' : money(compared)}</strong></div>
    </div>
    <div className="verification-difference">
      <span>Difference (calculated − compared)</span>
      <strong className={difference !== null && Math.abs(difference) < 0.01 ? 'positive' : 'negative'}>
        {difference === null ? 'Unavailable' : signedMoney(difference)}
      </strong>
    </div>
  </div>;
}

function Metric({label,value,note,icon,tone,noteTone,valueTone}:{label:string;value:string | number | React.ReactNode;note:string;icon?:string;tone?:string;noteTone?:string;valueTone?:string}){return <div className="metric"><div className="metric-label"><span>{label}</span>{icon ? <span style={{fontSize:16,color:'var(--muted)'}}>{icon}</span> : null}</div><div className={`metric-value ${valueTone ?? tone ?? ''}`}>{value}</div><div className={`metric-note ${noteTone ?? ''}`} style={noteTone ? { color: noteTone === 'positive' ? 'var(--green)' : 'var(--red)' } : undefined}>{note}</div></div>}
