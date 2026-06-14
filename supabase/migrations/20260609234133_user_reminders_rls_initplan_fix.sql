-- Perf-lint fix (auth_rls_initplan): wrap auth.uid() in a scalar subquery so
-- it's evaluated once per statement instead of once per row.
alter policy "reminders select own" on public.user_reminders
  using ((select auth.uid()) = user_id);
alter policy "reminders insert own" on public.user_reminders
  with check ((select auth.uid()) = user_id);
alter policy "reminders update own" on public.user_reminders
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "reminders delete own" on public.user_reminders
  using ((select auth.uid()) = user_id);
