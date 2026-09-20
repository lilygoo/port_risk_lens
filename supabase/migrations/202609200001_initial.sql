create extension if not exists pgcrypto;

create table public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'partial_success', 'failed')),
  provider text not null default 'yfinance',
  git_sha text,
  error_summary jsonb not null default '[]'::jsonb
);

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Primary portfolio',
  nav numeric(20, 6) not null check (nav > 0),
  cash numeric(20, 6) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id)
);

create table public.positions (
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  ticker text not null check (ticker = upper(trim(ticker)) and ticker ~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$'),
  signed_quantity numeric(24, 6) not null check (signed_quantity <> 0),
  updated_at timestamptz not null default now(),
  primary key (portfolio_id, ticker)
);

create table public.daily_prices (
  ticker text not null,
  price_date date not null,
  raw_close numeric(20, 8) not null check (raw_close > 0),
  adjusted_close numeric(20, 8) not null check (adjusted_close > 0),
  pipeline_run_id uuid not null references public.pipeline_runs(id),
  created_at timestamptz not null default now(),
  primary key (ticker, price_date)
);

create table public.security_risk_metrics (
  ticker text not null,
  as_of_date date not null,
  lookback_days integer not null check (lookback_days in (90, 180, 365)),
  total_volatility numeric(20, 12),
  residual_volatility_spy numeric(20, 12),
  stock_observations integer not null check (stock_observations >= 0),
  spy_aligned_observations integer not null check (spy_aligned_observations >= 0),
  spy_coverage_ratio numeric(12, 8),
  total_volatility_reason text,
  residual_volatility_reason text,
  calculation_version text not null,
  pipeline_run_id uuid not null references public.pipeline_runs(id),
  calculated_at timestamptz not null default now(),
  primary key (ticker, as_of_date, lookback_days)
);

create table public.security_beta_metrics (
  ticker text not null,
  as_of_date date not null,
  lookback_days integer not null check (lookback_days in (90, 180, 365)),
  benchmark_ticker text not null check (benchmark_ticker in ('SPY', 'QQQ', 'SOXX')),
  beta numeric(20, 12),
  aligned_observations integer not null check (aligned_observations >= 0),
  coverage_ratio numeric(12, 8),
  availability_reason text,
  calculation_version text not null,
  pipeline_run_id uuid not null references public.pipeline_runs(id),
  calculated_at timestamptz not null default now(),
  primary key (ticker, as_of_date, lookback_days, benchmark_ticker)
);

create index daily_prices_ticker_date_desc on public.daily_prices (ticker, price_date desc);
create index risk_metrics_ticker_as_of_desc on public.security_risk_metrics (ticker, as_of_date desc);
create index beta_metrics_ticker_as_of_desc on public.security_beta_metrics (ticker, as_of_date desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger portfolios_touch_updated_at before update on public.portfolios for each row execute function public.touch_updated_at();
create trigger positions_touch_updated_at before update on public.positions for each row execute function public.touch_updated_at();

alter table public.pipeline_runs enable row level security;
alter table public.portfolios enable row level security;
alter table public.positions enable row level security;
alter table public.daily_prices enable row level security;
alter table public.security_risk_metrics enable row level security;
alter table public.security_beta_metrics enable row level security;

create policy "owner reads portfolio" on public.portfolios for select to authenticated using (owner_id = auth.uid());
create policy "owner updates portfolio" on public.portfolios for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner reads positions" on public.positions for select to authenticated using (exists (select 1 from public.portfolios where portfolios.id = positions.portfolio_id and portfolios.owner_id = auth.uid()));
create policy "owner inserts positions" on public.positions for insert to authenticated with check (exists (select 1 from public.portfolios where portfolios.id = positions.portfolio_id and portfolios.owner_id = auth.uid()));
create policy "owner updates positions" on public.positions for update to authenticated using (exists (select 1 from public.portfolios where portfolios.id = positions.portfolio_id and portfolios.owner_id = auth.uid())) with check (exists (select 1 from public.portfolios where portfolios.id = positions.portfolio_id and portfolios.owner_id = auth.uid()));
create policy "owner deletes positions" on public.positions for delete to authenticated using (exists (select 1 from public.portfolios where portfolios.id = positions.portfolio_id and portfolios.owner_id = auth.uid()));
create policy "authenticated reads pipeline runs" on public.pipeline_runs for select to authenticated using (true);
create policy "authenticated reads prices" on public.daily_prices for select to authenticated using (true);
create policy "authenticated reads risk metrics" on public.security_risk_metrics for select to authenticated using (true);
create policy "authenticated reads beta metrics" on public.security_beta_metrics for select to authenticated using (true);

create or replace view public.latest_daily_prices with (security_invoker = true) as
select distinct on (ticker) ticker, price_date, raw_close, adjusted_close, pipeline_run_id
from public.daily_prices order by ticker, price_date desc;

create or replace view public.latest_security_risk_metrics with (security_invoker = true) as
select ticker, as_of_date, lookback_days, total_volatility, residual_volatility_spy,
       stock_observations, spy_aligned_observations, spy_coverage_ratio,
       total_volatility_reason, residual_volatility_reason, calculation_version, pipeline_run_id
from (
  select metrics.*, row_number() over (partition by ticker, lookback_days order by as_of_date desc) as row_number
  from public.security_risk_metrics metrics
) ranked where row_number = 1;

create or replace view public.latest_security_beta_metrics with (security_invoker = true) as
select ticker, as_of_date, lookback_days, benchmark_ticker, beta,
       aligned_observations, coverage_ratio, availability_reason, calculation_version, pipeline_run_id
from (
  select metrics.*, row_number() over (partition by ticker, lookback_days, benchmark_ticker order by as_of_date desc) as row_number
  from public.security_beta_metrics metrics
) ranked where row_number = 1;

grant select on public.latest_daily_prices, public.latest_security_risk_metrics, public.latest_security_beta_metrics to authenticated;

create or replace function public.replace_portfolio_state(p_portfolio_id uuid, p_nav numeric, p_cash numeric, p_positions jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if jsonb_typeof(p_positions) <> 'array' then raise exception 'positions must be an array'; end if;
  if not exists (select 1 from public.portfolios where id = p_portfolio_id and owner_id = auth.uid()) then raise exception 'portfolio not found'; end if;
  update public.portfolios set nav = p_nav, cash = p_cash where id = p_portfolio_id;
  delete from public.positions where portfolio_id = p_portfolio_id
    and ticker not in (select upper(trim(item->>'ticker')) from jsonb_array_elements(p_positions) item);
  insert into public.positions (portfolio_id, ticker, signed_quantity)
  select p_portfolio_id, upper(trim(item->>'ticker')), (item->>'signed_quantity')::numeric from jsonb_array_elements(p_positions) item
  on conflict (portfolio_id, ticker) do update set signed_quantity = excluded.signed_quantity, updated_at = now();
end;
$$;

revoke all on function public.replace_portfolio_state(uuid, numeric, numeric, jsonb) from public, anon;
grant execute on function public.replace_portfolio_state(uuid, numeric, numeric, jsonb) to authenticated;
