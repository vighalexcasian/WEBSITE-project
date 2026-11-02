alter table public.transactions
  add column if not exists cfd_cost numeric
  check (cfd_cost is null or cfd_cost > 0);
