create index if not exists fund_pool_movements_pool_date_created_idx
  on public.fund_pool_movements(pool_id, movement_date desc, created_at desc);

create index if not exists fund_pool_movements_created_by_idx
  on public.fund_pool_movements(created_by);
