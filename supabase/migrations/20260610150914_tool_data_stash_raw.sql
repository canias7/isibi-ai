-- Phase 2: stash the RAW connector tool result (Composio JSON) too, so an export
-- can be built from the exact data with the model only mapping fields->columns.
alter table public.tool_data_stash add column if not exists raw jsonb;
