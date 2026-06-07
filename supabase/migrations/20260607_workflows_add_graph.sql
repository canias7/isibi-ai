-- Visual workflow graph (trigger + nodes + edges + node positions) produced by
-- the build-workflow function and edited in the app. Nullable: legacy workflows
-- (instruction + trigger only) keep working; the runner executes `instruction`
-- regardless, so this column is display/editing state only.
alter table public.workflows add column if not exists graph jsonb;
