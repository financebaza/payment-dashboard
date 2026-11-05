create table public.operational_coverage_inputs (
  month_start date not null,
  entry_key text not null check (length(btrim(entry_key)) between 1 and 100),
  category text not null check (category = any (array['payroll','salary_advance','rent','other'])),
  label text not null check (length(btrim(label)) between 1 and 200),
  amount numeric(16,2) not null check (amount >= 0),
  planned_date date,
  is_estimate boolean not null default false,
  note text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (month_start, entry_key)
);

alter table public.operational_coverage_inputs enable row level security;
revoke all on public.operational_coverage_inputs from anon;
grant select, insert, update, delete on public.operational_coverage_inputs to authenticated;

create policy "staff read operational coverage inputs"
  on public.operational_coverage_inputs for select to authenticated
  using (private.current_user_role() = any (array['admin'::text,'approver'::text,'viewer'::text]));

create policy "editors add operational coverage inputs"
  on public.operational_coverage_inputs for insert to authenticated
  with check (private.can_approve() and (updated_by is null or updated_by = auth.uid()));

create policy "editors update operational coverage inputs"
  on public.operational_coverage_inputs for update to authenticated
  using (private.can_approve())
  with check (private.can_approve() and (updated_by is null or updated_by = auth.uid()));

create policy "editors delete operational coverage inputs"
  on public.operational_coverage_inputs for delete to authenticated
  using (private.can_approve());