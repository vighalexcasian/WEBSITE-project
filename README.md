# Northstar Portfolio — starter project

A Next.js + TypeScript portfolio-tracker prototype. It currently uses fictional sample transactions and editable sample quotes. It does not connect to a broker, market-data provider, or database yet.

## Requirements
- Node.js 20.9+ (recommended)
- npm

## Run locally
```bash
npm install
npm run dev
```
Then open http://localhost:3000.

## What works in this starter
- Portfolio overview dashboard
- Holdings derived from a transaction ledger
- Add BUY and SELL transactions
- Average-cost basis and realized/unrealized P/L calculations
- Editable sample prices
- Allocation chart and holdings filters

## Important prototype limitations
- Transactions, transaction history, and last-known Yahoo Finance quotes are saved in this browser's local storage; they are not synced across browsers or devices.
- Sample data is fictional and prices are not live.
- Different currencies are not yet converted into a base currency; totals currently sum displayed numeric values and should only be interpreted with single-currency sample data.
- Performance chart is illustrative and is not computed from transactions.
- Dividends, splits, taxes, deposits/withdrawals, and brokerage imports are not implemented.

## Recommended next steps
1. Choose a base currency (EUR is a sensible default if you report your portfolio in euros).
2. Add Supabase authentication and PostgreSQL tables for transactions, accounts, and quotes.
3. Implement currency conversion and daily portfolio valuations.
4. Connect a market-data provider behind a server-side API route. Never expose a secret API key in client code.
5. Add dividend/corporate-action handling and import/export (CSV).

## Calculation notes
The portfolio engine uses a moving average-cost method to calculate realized P/L. Sell orders close existing long positions first, then open or increase short positions if they exceed the remaining long quantity. Buy orders close existing shorts first, then open or increase long positions. Open short P/L is calculated as short-sale proceeds less the current market value. This is a portfolio-monitoring convention, not tax advice; applicable tax cost-basis rules may differ.
