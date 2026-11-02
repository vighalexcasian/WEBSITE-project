create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cash_balance numeric not null default 25000 check (cash_balance >= 0)
);

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  value numeric not null check (value > 0),
  created_at timestamptz not null default now()
);

create index if not exists deposits_user_date_idx
  on public.deposits (user_id, date);

grant select, insert, update, delete on public.user_settings to authenticated;
grant select, insert, update, delete on public.deposits to authenticated;

alter table public.user_settings enable row level security;
alter table public.deposits enable row level security;

create policy "Users can read their own settings"
  on public.user_settings for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own settings"
  on public.user_settings for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own settings"
  on public.user_settings for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can read their own deposits"
  on public.deposits for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own deposits"
  on public.deposits for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own deposits"
  on public.deposits for delete
  to authenticated
  using ((select auth.uid()) = user_id);
