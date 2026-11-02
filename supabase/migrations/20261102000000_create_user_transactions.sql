create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  ticker text not null,
  company text not null,
  type text not null check (type in ('BUY', 'SELL')),
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price > 0),
  fees numeric not null default 0 check (fees >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc);

grant select, insert, update, delete on public.transactions to authenticated;

alter table public.transactions enable row level security;

create policy "Users can read their own transactions"
  on public.transactions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own transactions"
  on public.transactions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own transactions"
  on public.transactions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own transactions"
  on public.transactions for delete
  to authenticated
  using ((select auth.uid()) = user_id);
