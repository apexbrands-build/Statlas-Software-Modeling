/* AOV Histogram report (spec 2026-10-12-four-reports-design.md).
   Orders counted: DTC orders with order revenue above zero dated in the range (same filter as the daily rollup).
   Both functions are read-only and run as the caller, so row-level security on `orders` applies.

   aov_stats:      count, revenue, mean, median and mode (most frequent exact value, ties: the lowest) of order revenue.
   aov_histogram:  p_mode 'dynamic'  = ten equal-width buckets between the 2.5th and 97.5th percentile (orders outside are excluded and counted),
                   p_mode 'complete' = ten equal-width buckets from the smallest to the largest order,
                   p_mode 'step'     = buckets of p_step from zero, at most 60 regular buckets (up to the 99th percentile) and a last
                                       open-ended bucket (high is null) holding everything above.
                   One bucket when the low and high bounds are equal. `excluded` is the same on every row. Empty buckets are returned. */

create or replace function public.aov_stats(p_client uuid, p_from date, p_to date)
returns table (orders bigint, revenue numeric, mean numeric, median numeric, mode numeric)
language sql stable set search_path to 'public' as $$
  with o as (
    select order_revenue as v from orders
    where client_id = p_client and is_dtc and order_revenue > 0 and order_date between p_from and p_to
  )
  select count(*), coalesce(sum(v), 0), avg(v), (percentile_cont(0.5) within group (order by v))::numeric,
         (select v from o group by v order by count(*) desc, v limit 1)
  from o;
$$;

create or replace function public.aov_histogram(p_client uuid, p_from date, p_to date, p_mode text, p_step numeric default 25)
returns table (bucket int, low numeric, high numeric, orders bigint, revenue numeric, excluded bigint)
language plpgsql stable set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_total bigint;
  v_lo numeric;
  v_hi numeric;
  v_w numeric;
  v_n int;
  v_p99 numeric;
begin
  if p_mode not in ('dynamic', 'complete', 'step') then
    raise exception 'unknown mode %', p_mode;
  end if;

  select count(*) into v_total from orders o
  where o.client_id = p_client and o.is_dtc and o.order_revenue > 0 and o.order_date between p_from and p_to;
  if v_total = 0 then
    return;
  end if;

  if p_mode = 'step' then
    if p_step is null or p_step <= 0 then
      raise exception 'p_step must be positive';
    end if;
    select (percentile_cont(0.99) within group (order by o.order_revenue))::numeric into v_p99 from orders o
    where o.client_id = p_client and o.is_dtc and o.order_revenue > 0 and o.order_date between p_from and p_to;
    v_n := least(greatest(ceil(v_p99 / p_step)::int, 1), 60);
    return query
      with b as (
        select least(floor(o.order_revenue / p_step)::int + 1, v_n + 1) as k, o.order_revenue as v
        from orders o
        where o.client_id = p_client and o.is_dtc and o.order_revenue > 0 and o.order_date between p_from and p_to
      )
      select g.k, ((g.k - 1) * p_step)::numeric, (case when g.k = v_n + 1 then null else g.k * p_step end)::numeric,
             count(b.v)::bigint, coalesce(sum(b.v), 0)::numeric, 0::bigint
      from generate_series(1, v_n + 1) as g(k) left join b on b.k = g.k
      group by g.k order by g.k;
    return;
  end if;

  if p_mode = 'dynamic' then
    select (percentile_cont(0.025) within group (order by o.order_revenue))::numeric,
           (percentile_cont(0.975) within group (order by o.order_revenue))::numeric
      into v_lo, v_hi from orders o
    where o.client_id = p_client and o.is_dtc and o.order_revenue > 0 and o.order_date between p_from and p_to;
  else
    select min(o.order_revenue), max(o.order_revenue) into v_lo, v_hi from orders o
    where o.client_id = p_client and o.is_dtc and o.order_revenue > 0 and o.order_date between p_from and p_to;
  end if;

  if v_hi = v_lo then
    return query
      select 1, v_lo, v_hi, count(*)::bigint, coalesce(sum(o.order_revenue), 0)::numeric, v_total - count(*)
      from orders o
      where o.client_id = p_client and o.is_dtc and o.order_revenue > 0 and o.order_date between p_from and p_to
        and o.order_revenue between v_lo and v_hi;
    return;
  end if;

  v_w := (v_hi - v_lo) / 10;
  return query
    with b as (
      select least(floor((o.order_revenue - v_lo) / v_w)::int + 1, 10) as k, o.order_revenue as v
      from orders o
      where o.client_id = p_client and o.is_dtc and o.order_revenue > 0 and o.order_date between p_from and p_to
        and o.order_revenue between v_lo and v_hi
    ), counted as (select count(*) as c from b)
    select g.k, (v_lo + (g.k - 1) * v_w)::numeric, (v_lo + g.k * v_w)::numeric,
           count(b.v)::bigint, coalesce(sum(b.v), 0)::numeric, (v_total - (select c from counted))::bigint
    from generate_series(1, 10) as g(k) left join b on b.k = g.k
    group by g.k order by g.k;
end $$;

grant execute on function public.aov_stats(uuid, date, date) to authenticated;
grant execute on function public.aov_histogram(uuid, date, date, text, numeric) to authenticated;
