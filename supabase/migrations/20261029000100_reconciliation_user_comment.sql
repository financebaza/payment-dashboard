alter table public.reconciliation_plan_rows
  add column if not exists user_comment text not null default '';

comment on column public.reconciliation_plan_rows.user_comment is
  'User-authored note for a plan/fact reconciliation discrepancy.';
