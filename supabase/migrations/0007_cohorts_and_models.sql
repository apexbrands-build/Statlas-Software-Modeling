/* Forecasting models: cohort history (whole store history, rebuilt from orders) and the saved model per plan.

   cohort_stats:   one row per acquisition month. first_revenue = revenue of the customers' first orders;
                   rev_60d / rev_365d = their repeat order revenue within 60 / 365 days of the first order.
   cohort_periods: repeat revenue per cohort by 30-day period since the first order (period 1 = days 0-30, 2 = 31-60 ...).
   Order revenue basis (refunds not deducted), DTC orders only, zero-dollar orders ignored.
   Customers whose first order is before the store's history are not in a cohort (the "pre-cohort"). */

create table if not exists cohort_stats (
  client_id uuid not null references clients(id) on delete cascade,
  cohort_month date not null,
  customers int not null default 0,
  first_revenue numeric not null default 0,
  rev_60d numeric not null default 0,
  rev_365d numeric not null default 0,
  primary key (client_id, cohort_month)
);

create table if not exists cohort_periods (
  client_id uuid not null references clients(id) on delete cascade,
  cohort_month date not null,
  period int not null,
  revenue numeric not null default 0,
  orders int not null default 0,
  primary key (client_id, cohort_month, period)
);

/* One saved model per plan and kind ('new_customer', later 'returning', 'event'). */
create table if not exists plan_models (
  plan_id uuid not null references plan_versions(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  kind text not null,
  settings jsonb not null default '{}'::jsonb,
  results jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (plan_id, kind)
);

alter table cohort_stats enable row level security;
alter table cohort_periods enable row level security;
alter table plan_models enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cohort_stats','cohort_periods','plan_models'] loop
    execute format('create policy %I on %I for select to authenticated using (public.has_client_access(client_id))', t || '_read', t);
  end loop;
  execute 'create policy plan_models_insert on plan_models for insert to authenticated with check (public.has_client_access(client_id))';
  execute 'create policy plan_models_update on plan_models for update to authenticated using (public.has_client_access(client_id)) with check (public.has_client_access(client_id))';
  execute 'create policy plan_models_delete on plan_models for delete to authenticated using (public.has_client_access(client_id))';
end $$;

create or replace function public.rebuild_cohorts(p_client uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.has_client_access(p_client) then
    raise exception 'no access';
  end if;

  delete from cohort_stats where client_id = p_client;
  delete from cohort_periods where client_id = p_client;

  create temporary table _first on commit drop as
    select customer_id, order_date as fd, order_revenue as fr, date_trunc('month', order_date)::date as cm
    from orders
    where client_id = p_client and is_first_order and is_dtc and order_revenue > 0 and customer_id is not null;

  create temporary table _repeat on commit drop as
    select f.cm, (o.order_date - f.fd) as d, o.order_revenue as rev
    from _first f
    join orders o on o.client_id = p_client and o.customer_id = f.customer_id
      and not o.is_first_order and o.is_dtc and o.order_revenue > 0 and o.order_date >= f.fd;

  insert into cohort_stats (client_id, cohort_month, customers, first_revenue, rev_60d, rev_365d)
  select p_client, f.cm, f.n, f.rev, coalesce(r.r60, 0), coalesce(r.r365, 0)
  from (select cm, count(*) as n, sum(fr) as rev from _first group by cm) f
  left join (
    select cm, sum(rev) filter (where d <= 60) as r60, sum(rev) filter (where d <= 365) as r365 from _repeat group by cm
  ) r on r.cm = f.cm;

  insert into cohort_periods (client_id, cohort_month, period, revenue, orders)
  select p_client, cm, greatest(1, ceil(d / 30.0)::int), sum(rev), count(*)
  from _repeat group by cm, greatest(1, ceil(d / 30.0)::int);
end $$;

revoke all on function public.rebuild_cohorts(uuid) from public;
grant execute on function public.rebuild_cohorts(uuid) to authenticated, service_role;
