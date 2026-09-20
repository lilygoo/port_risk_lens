alter table public.pipeline_runs
  add column analytics_as_of_date date,
  add column analytics_published_at timestamptz;

update public.pipeline_runs runs
set analytics_as_of_date = published.as_of_date,
    analytics_published_at = coalesce(runs.finished_at, runs.started_at)
from (
  select pipeline_run_id, max(as_of_date) as as_of_date
  from (
    select pipeline_run_id, as_of_date from public.security_risk_metrics
    union all
    select pipeline_run_id, as_of_date from public.security_beta_metrics
  ) metrics
  group by pipeline_run_id
) published
where runs.id = published.pipeline_run_id
  and runs.status in ('success', 'partial_success');

create table public.daily_price_versions (
  ticker text not null,
  price_date date not null,
  raw_close numeric(20, 8) not null check (raw_close > 0),
  adjusted_close numeric(20, 8) not null check (adjusted_close > 0),
  pipeline_run_id uuid not null references public.pipeline_runs(id),
  published_at timestamptz not null default now(),
  primary key (ticker, price_date, pipeline_run_id)
);

insert into public.daily_price_versions (ticker, price_date, raw_close, adjusted_close, pipeline_run_id, published_at)
select ticker, price_date, raw_close, adjusted_close, pipeline_run_id, now()
from public.latest_daily_prices
on conflict do nothing;

alter table public.daily_price_versions enable row level security;
create policy "authenticated reads price versions" on public.daily_price_versions for select to authenticated using (true);

create or replace view public.latest_daily_price_versions with (security_invoker = true) as
select distinct on (ticker) ticker, price_date, raw_close, adjusted_close, pipeline_run_id, published_at
from public.daily_price_versions
order by ticker, price_date desc, published_at desc;

grant select on public.latest_daily_price_versions to authenticated;

create table public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  cash numeric(20, 6) not null,
  nav_at_save numeric(20, 6) not null check (nav_at_save > 0),
  valuation_incomplete boolean not null,
  unpriced_position_count integer not null check (unpriced_position_count >= 0),
  source text not null check (source in ('manual', 'broker', 'seed', 'legacy')),
  schema_version integer not null check (schema_version > 0),
  app_version text not null,
  created_by uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default now()
);

create index portfolio_snapshots_latest on public.portfolio_snapshots (portfolio_id, saved_at desc);

create table public.portfolio_snapshot_positions (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.portfolio_snapshots(id) on delete cascade,
  ticker text not null check (ticker = upper(trim(ticker)) and ticker ~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$'),
  signed_quantity numeric(24, 6) not null check (signed_quantity <> 0),
  manual_price_fallback numeric(20, 8) check (manual_price_fallback > 0),
  valuation_price_at_save numeric(20, 8) not null check (valuation_price_at_save >= 0),
  valuation_price_source_at_save text not null check (valuation_price_source_at_save in ('pipeline', 'manual', 'default')),
  valuation_price_date_at_save date,
  valuation_pipeline_run_id uuid references public.pipeline_runs(id),
  unique (snapshot_id, ticker),
  unique (id, ticker)
);

create table public.portfolio_snapshot_beta_overrides (
  snapshot_position_id uuid not null references public.portfolio_snapshot_positions(id) on delete cascade,
  benchmark_ticker text not null check (benchmark_ticker in ('SPY', 'QQQ', 'SOXX')),
  lookback_days integer not null check (lookback_days in (90, 180, 365)),
  beta numeric(20, 12) not null,
  primary key (snapshot_position_id, benchmark_ticker, lookback_days)
);

alter table public.portfolio_snapshots enable row level security;
alter table public.portfolio_snapshot_positions enable row level security;
alter table public.portfolio_snapshot_beta_overrides enable row level security;

create policy "owner reads snapshots" on public.portfolio_snapshots for select to authenticated
using (exists (
  select 1 from public.portfolios
  where portfolios.id = portfolio_snapshots.portfolio_id and portfolios.owner_id = auth.uid()
));

create policy "owner reads snapshot positions" on public.portfolio_snapshot_positions for select to authenticated
using (exists (
  select 1
  from public.portfolio_snapshots snapshots
  join public.portfolios on portfolios.id = snapshots.portfolio_id
  where snapshots.id = portfolio_snapshot_positions.snapshot_id and portfolios.owner_id = auth.uid()
));

create policy "owner reads snapshot beta overrides" on public.portfolio_snapshot_beta_overrides for select to authenticated
using (exists (
  select 1
  from public.portfolio_snapshot_positions positions
  join public.portfolio_snapshots snapshots on snapshots.id = positions.snapshot_id
  join public.portfolios on portfolios.id = snapshots.portfolio_id
  where positions.id = portfolio_snapshot_beta_overrides.snapshot_position_id and portfolios.owner_id = auth.uid()
));

create or replace function public.create_portfolio_snapshot(
  p_base_snapshot_id uuid,
  p_cash numeric,
  p_positions jsonb,
  p_beta_overrides jsonb,
  p_schema_version integer,
  p_app_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_portfolio_id uuid;
  v_latest_snapshot_id uuid;
  v_latest_saved_at timestamptz;
  v_snapshot_id uuid;
  v_nav numeric;
  v_unpriced integer;
begin
  if v_owner_id is null then raise exception 'unauthorized' using errcode = '42501'; end if;

  select id into v_portfolio_id
  from public.portfolios
  where owner_id = v_owner_id
  for update;
  if v_portfolio_id is null then raise exception 'portfolio not found' using errcode = '42501'; end if;

  select id, saved_at into v_latest_snapshot_id, v_latest_saved_at
  from public.portfolio_snapshots
  where portfolio_id = v_portfolio_id
  order by saved_at desc, id desc
  limit 1;

  if v_latest_snapshot_id is distinct from p_base_snapshot_id then
    return jsonb_build_object(
      'conflict', true,
      'latestSnapshotId', v_latest_snapshot_id,
      'latestSavedAt', v_latest_saved_at
    );
  end if;

  if p_cash is null or p_positions is null or jsonb_typeof(p_positions) <> 'array' then
    raise exception 'cash and positions are required';
  end if;
  if p_beta_overrides is null or jsonb_typeof(p_beta_overrides) <> 'array' then
    raise exception 'beta overrides must be an array';
  end if;
  if p_schema_version is null or p_schema_version <= 0 or nullif(trim(p_app_version), '') is null then
    raise exception 'snapshot version metadata is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_positions) item
    where (item->>'ticker') is null
       or upper(trim(item->>'ticker')) !~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$'
       or (item->>'signed_quantity') is null
       or (item->>'signed_quantity')::numeric = 0
       or (item->>'valuation_price') is null
       or (item->>'valuation_price')::numeric < 0
       or (item->>'price_source') is null
       or item->>'price_source' not in ('pipeline', 'manual', 'default')
       or ((item->>'manual_price_fallback') is not null and (item->>'manual_price_fallback')::numeric <= 0)
  ) then raise exception 'invalid snapshot position'; end if;
  if (
    select count(*) from jsonb_array_elements(p_positions)
  ) <> (
    select count(distinct upper(trim(item->>'ticker'))) from jsonb_array_elements(p_positions) item
  ) then raise exception 'duplicate snapshot ticker'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_positions) item
    where item->>'price_source' = 'pipeline'
      and not exists (
        select 1 from public.daily_price_versions prices
        where prices.ticker = upper(trim(item->>'ticker'))
          and prices.price_date = (item->>'price_date')::date
          and prices.pipeline_run_id = (item->>'pipeline_run_id')::uuid
          and prices.raw_close = (item->>'valuation_price')::numeric
      )
  ) then raise exception 'referenced pipeline price is invalid'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_positions) item
    where (item->>'price_source' = 'manual' and (
      (item->>'manual_price_fallback') is null
      or (item->>'manual_price_fallback')::numeric <> (item->>'valuation_price')::numeric
    )) or (item->>'price_source' = 'default' and (item->>'valuation_price')::numeric <> 0)
  ) then raise exception 'valuation price does not match its source'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_beta_overrides) item
    where (item->>'ticker') is null
       or upper(trim(item->>'ticker')) !~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$'
       or item->>'benchmark' not in ('SPY', 'QQQ', 'SOXX')
       or (item->>'lookback_days')::integer not in (90, 180, 365)
       or (item->>'beta') is null
  ) then raise exception 'invalid beta fallback'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_beta_overrides) override_item
    where not exists (
      select 1 from jsonb_array_elements(p_positions) position_item
      where upper(trim(position_item->>'ticker')) = upper(trim(override_item->>'ticker'))
    )
  ) then raise exception 'beta fallback ticker is not in the snapshot'; end if;
  if (
    select count(*) from jsonb_array_elements(p_beta_overrides)
  ) <> (
    select count(distinct concat_ws('|', upper(trim(item->>'ticker')), item->>'benchmark', item->>'lookback_days'))
    from jsonb_array_elements(p_beta_overrides) item
  ) then raise exception 'duplicate beta fallback'; end if;

  select p_cash + coalesce(sum(
    (item->>'signed_quantity')::numeric * (item->>'valuation_price')::numeric
  ), 0), count(*) filter (where (item->>'valuation_price')::numeric = 0)
  into v_nav, v_unpriced
  from jsonb_array_elements(p_positions) item;
  if v_nav <= 0 then raise exception 'derived NAV must be positive'; end if;

  insert into public.portfolio_snapshots (
    portfolio_id, cash, nav_at_save, valuation_incomplete, unpriced_position_count,
    source, schema_version, app_version, created_by
  ) values (
    v_portfolio_id, p_cash, v_nav, v_unpriced > 0, v_unpriced,
    'manual', p_schema_version, p_app_version, v_owner_id
  ) returning id into v_snapshot_id;

  insert into public.portfolio_snapshot_positions (
    snapshot_id, ticker, signed_quantity, manual_price_fallback,
    valuation_price_at_save, valuation_price_source_at_save,
    valuation_price_date_at_save, valuation_pipeline_run_id
  )
  select
    v_snapshot_id,
    upper(trim(item->>'ticker')),
    (item->>'signed_quantity')::numeric,
    nullif(item->>'manual_price_fallback', '')::numeric,
    (item->>'valuation_price')::numeric,
    item->>'price_source',
    nullif(item->>'price_date', '')::date,
    nullif(item->>'pipeline_run_id', '')::uuid
  from jsonb_array_elements(p_positions) item;

  insert into public.portfolio_snapshot_beta_overrides (
    snapshot_position_id, benchmark_ticker, lookback_days, beta
  )
  select positions.id, item->>'benchmark', (item->>'lookback_days')::integer, (item->>'beta')::numeric
  from jsonb_array_elements(p_beta_overrides) item
  join public.portfolio_snapshot_positions positions
    on positions.snapshot_id = v_snapshot_id
   and positions.ticker = upper(trim(item->>'ticker'));

  return jsonb_build_object(
    'conflict', false,
    'snapshotId', v_snapshot_id,
    'savedAt', (select saved_at from public.portfolio_snapshots where id = v_snapshot_id),
    'navAtSave', v_nav,
    'valuationIncomplete', v_unpriced > 0
  );
end;
$$;

revoke all on function public.create_portfolio_snapshot(uuid, numeric, jsonb, jsonb, integer, text) from public, anon;
grant execute on function public.create_portfolio_snapshot(uuid, numeric, jsonb, jsonb, integer, text) to authenticated;

with legacy_values as (
  select
    portfolios.id as portfolio_id,
    portfolios.owner_id,
    portfolios.cash,
    portfolios.updated_at,
    portfolios.cash + coalesce(sum(positions.signed_quantity * coalesce(prices.raw_close, 0)), 0) as derived_nav,
    count(*) filter (where positions.ticker is not null and prices.raw_close is null) as unpriced_count
  from public.portfolios
  left join public.positions on positions.portfolio_id = portfolios.id
  left join public.latest_daily_prices prices on prices.ticker = positions.ticker
  group by portfolios.id, portfolios.owner_id, portfolios.cash, portfolios.updated_at
)
insert into public.portfolio_snapshots (
  portfolio_id, cash, nav_at_save, valuation_incomplete, unpriced_position_count,
  source, schema_version, app_version, created_by, saved_at
)
select
  portfolio_id, cash, derived_nav, unpriced_count > 0, unpriced_count,
  'legacy', 1, 'legacy-migration', owner_id, updated_at
from legacy_values
where derived_nav > 0;

insert into public.portfolio_snapshot_positions (
  snapshot_id, ticker, signed_quantity, valuation_price_at_save,
  valuation_price_source_at_save, valuation_price_date_at_save, valuation_pipeline_run_id
)
select
  snapshots.id,
  positions.ticker,
  positions.signed_quantity,
  coalesce(prices.raw_close, 0),
  case when prices.raw_close is null then 'default' else 'pipeline' end,
  prices.price_date,
  prices.pipeline_run_id
from public.positions positions
join public.portfolio_snapshots snapshots
  on snapshots.portfolio_id = positions.portfolio_id and snapshots.source = 'legacy'
left join public.latest_daily_price_versions prices on prices.ticker = positions.ticker;
