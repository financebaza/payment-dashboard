-- Pool balances are held in the private Supabase project, not this public repository.
create table if not exists public.fund_pools (
  pool_id text primary key,
  name text not null,
  pool_type text not null,
  opening_balance numeric(18,2) not null check (opening_balance >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.fund_pool_movements (
  id uuid primary key default gen_random_uuid(),
  pool_id text not null references public.fund_pools(pool_id),
  movement_date date not null,
  movement_type text not null check (movement_type in ('expense','top_up')),
  amount numeric(18,2) not null check (amount > 0),
  legal_entity text not null default '',
  counterparty text not null default '',
  project text not null default '',
  purpose text not null default '',
  payment_ref text not null default '',
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.fund_pools enable row level security;
alter table public.fund_pool_movements enable row level security;
grant select on public.fund_pools to authenticated;
grant select, insert on public.fund_pool_movements to authenticated;
drop policy if exists "finance staff can read fund pools" on public.fund_pools;
create policy "finance staff can read fund pools" on public.fund_pools for select to authenticated
using (private.current_user_role() = any(array['admin','approver','viewer']));
drop policy if exists "finance staff can read fund pool movements" on public.fund_pool_movements;
create policy "finance staff can read fund pool movements" on public.fund_pool_movements for select to authenticated
using (private.current_user_role() = any(array['admin','approver','viewer']));
drop policy if exists "approvers can record fund pool movements" on public.fund_pool_movements;
create policy "approvers can record fund pool movements" on public.fund_pool_movements for insert to authenticated
with check (private.can_approve() and created_by = auth.uid());
create or replace function private.check_fund_pool_movement_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_opening numeric(18,2); v_movements numeric(18,2);
begin
  if auth.uid() is null or not private.can_approve() then raise exception 'Нет прав на изменение кубышки'; end if;
  select opening_balance into v_opening from public.fund_pools where pool_id = new.pool_id for update;
  if not found then raise exception 'Кубышка не найдена'; end if;
  select coalesce(sum(case when movement_type='expense' then -amount when movement_type='top_up' then amount else 0 end),0)
    into v_movements from public.fund_pool_movements where pool_id=new.pool_id;
  if new.movement_type='expense' and v_opening+v_movements-new.amount<0 then raise exception 'Расход превышает доступный остаток кубышки'; end if;
  return new;
end;
$$;
revoke all on function private.check_fund_pool_movement_balance() from public, anon, authenticated;
drop trigger if exists check_fund_pool_movement_balance on public.fund_pool_movements;
create trigger check_fund_pool_movement_balance before insert on public.fund_pool_movements
for each row execute function private.check_fund_pool_movement_balance();
