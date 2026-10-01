/* Planning layer (Phase A): plans per year with monthly inputs, a change log, and daily P&L lines.
   Daily rows stay in plan_targets (read by Home and the reports); plan_months holds what the strategist typed. */

alter table plan_versions add column if not exists year int not null default (extract(year from now()))::int;
alter table plan_versions add column if not exists description text not null default '';
alter table plan_versions add column if not exists seasonality jsonb;
alter table plan_versions add column if not exists updated_at timestamptz not null default now();
alter table plan_versions add column if not exists updated_by text;
-- one default plan per client per year
create unique index if not exists plan_versions_one_default on plan_versions (client_id, year) where is_default;

alter table plan_targets add column if not exists tax numeric;
alter table plan_targets add column if not exists cogs numeric;
alter table plan_targets add column if not exists cost_of_delivery numeric;

create table if not exists plan_months (
  plan_id uuid not null references plan_versions(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  month date not null,
  inputs jsonb,
  status text not null default 'in_progress',
  locked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (plan_id, month)
);

create table if not exists plan_changes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plan_versions(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  at timestamptz not null default now(),
  by text not null default '',
  summary text not null
);

alter table plan_months enable row level security;
alter table plan_changes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['plan_months','plan_changes'] loop
    execute format('create policy %I on %I for select to authenticated using (public.has_client_access(client_id))', t || '_read', t);
  end loop;
  foreach t in array array['plan_versions','plan_targets','plan_months','plan_changes'] loop
    execute format('create policy %I on %I for insert to authenticated with check (public.has_client_access(client_id))', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (public.has_client_access(client_id)) with check (public.has_client_access(client_id))', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (public.has_client_access(client_id))', t || '_delete', t);
  end loop;
end $$;
