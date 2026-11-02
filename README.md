# Northstar Portfolio — starter project

A Next.js + TypeScript portfolio tracker with Supabase email/password authentication and user-scoped transaction storage.

## Requirements
- Node.js 20.9+ (recommended)
- npm

## Run locally
```bash
npm install
npm run dev
```
Then open http://localhost:3000.

## Configure Supabase
1. Create a Supabase project and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` using the project URL and public anon key. Never put a service-role key in the browser or a `NEXT_PUBLIC_` variable.
2. Apply the SQL files in `supabase/migrations/` in order in the Supabase SQL editor (or with the Supabase CLI). They create the transactions, cash settings, and deposits tables with owner-only row-level security policies.
3. Configure the Supabase Auth email-confirmation settings to match your desired sign-up flow.

The app loads and writes transactions, cash settings, and deposits using the authenticated user's ID. Row-level security is the database enforcement boundary; the client-side sign-in screen is not a substitute for these policies.

Set `FINNHUB_API_KEY` in `.env.local` for server-side quote and benchmark requests. Do not expose this key with a `NEXT_PUBLIC_` prefix. Finnhub supplies live stock quotes and benchmark candles (SPY is used as an S&P 500 proxy); Yahoo Finance supplies company sector, industry, and profile metadata.

## What works in this starter
- Portfolio overview dashboard
- Holdings derived from a transaction ledger
- Add BUY and SELL transactions
- Average-cost basis and realized/unrealized P/L calculations
- Editable sample prices
- Allocation chart and holdings filters

## Important prototype limitations
- Transactions, cash balances, and deposits are stored in Supabase and isolated by authenticated user. Quote cache and per-user performance snapshots remain in browser local storage.
- Sample data is fictional and prices are not live.
- Different currencies are not yet converted into a base currency; totals currently sum displayed numeric values and should only be interpreted with single-currency sample data.
- Performance chart is illustrative and is not computed from transactions.
- Dividends, splits, taxes, withdrawals, and brokerage imports are not implemented.

## Recommended next steps
1. Choose a base currency (EUR is a sensible default if you report your portfolio in euros).
2. Implement currency conversion and daily portfolio valuations.
3. Add dividend/corporate-action handling and import/export (CSV).

## Calculation notes
The portfolio engine uses a moving average-cost method to calculate realized P/L. Sell orders close existing long positions first, then open or increase short positions if they exceed the remaining long quantity. Buy orders close existing shorts first, then open or increase long positions. For short exposure opened by a SELL, the entered CFD cost is used as the short cost basis; when the SELL partly closes a long position first, the CFD cost is allocated proportionally to the shares that open the short. Older SELL transactions without a CFD cost retain their proceeds-based basis. This is a portfolio-monitoring convention, not tax advice; applicable tax cost-basis rules may differ.
