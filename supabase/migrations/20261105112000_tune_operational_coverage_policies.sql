create index if not exists operational_coverage_inputs_updated_by_idx
  on public.operational_coverage_inputs (updated_by);

drop policy if exists "staff read operational coverage inputs" on public.operational_coverage_inputs;
create policy "staff read operational coverage inputs"
  on public.operational_coverage_inputs for select to authenticated
  using ((select private.current_user_role()) = any (array['admin'::text,'approver'::text,'viewer'::text]));

drop policy if exists "editors add operational coverage inputs" on public.operational_coverage_inputs;
create policy "editors add operational coverage inputs"
  on public.operational_coverage_inputs for insert to authenticated
  with check ((select private.can_approve()) and (updated_by is null or updated_by = (select auth.uid())));

drop policy if exists "editors update operational coverage inputs" on public.operational_coverage_inputs;
create policy "editors update operational coverage inputs"
  on public.operational_coverage_inputs for update to authenticated
  using ((select private.can_approve()))
  with check ((select private.can_approve()) and (updated_by is null or updated_by = (select auth.uid())));

drop policy if exists "editors delete operational coverage inputs" on public.operational_coverage_inputs;
create policy "editors delete operational coverage inputs"
  on public.operational_coverage_inputs for delete to authenticated
  using ((select private.can_approve()));