-- Plan scenarios: a client's default plan is the baseline ("Most likely"); one stretch plan ("Would like")
-- per client and year can be generated from it. Additive only; existing plans stay baselines.
alter table plan_versions add column if not exists scenario text not null default 'baseline';
alter table plan_versions drop constraint if exists plan_versions_scenario_check;
alter table plan_versions add constraint plan_versions_scenario_check check (scenario in ('baseline', 'target'));
alter table plan_versions add column if not exists base_plan_id uuid references plan_versions(id) on delete set null;
alter table plan_versions add column if not exists goal jsonb;

create unique index if not exists plan_versions_one_target on plan_versions (client_id, year) where scenario = 'target';
