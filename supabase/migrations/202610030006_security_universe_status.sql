-- The universe is the canonical support lifecycle. `active` alone controls
-- pipeline eligibility; support_status explains that state to the dashboard.
alter table public.security_universe
  add column if not exists support_status text,
  add column if not exists requested_at timestamptz,
  add column if not exists supported_at timestamptz;

update public.security_universe
set support_status = case when active then 'supported' else 'requested' end
where support_status is null;

alter table public.security_universe
  alter column support_status set default 'supported',
  alter column support_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'security_universe_support_status_check'
      and conrelid = 'public.security_universe'::regclass
  ) then
    alter table public.security_universe
      add constraint security_universe_support_status_check
      check (support_status in ('requested', 'supported', 'declined'));
  end if;
end;
$$;

create index if not exists security_universe_support_status_active_idx
  on public.security_universe (support_status, active, ticker);

-- Preserve pre-existing website requests while making the universe record the
-- canonical current status. A request never activates the scheduled pipeline.
insert into public.security_universe (
  ticker, provider_symbol, instrument_type, active, support_status, requested_at
)
select ticker, ticker, 'equity', false, 'requested', requested_at
from public.ticker_support_requests
where status = 'requested'
on conflict (ticker) do nothing;

create or replace function public.request_shared_ticker_support(p_ticker text)
returns public.ticker_support_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_ticker text := upper(trim(p_ticker));
begin
  v_owner_id := public.shared_portfolio_owner_id();
  if v_ticker !~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$' then
    raise exception 'invalid ticker' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.security_universe
    where ticker = v_ticker and support_status = 'supported'
  ) then
    raise exception '% is already supported', v_ticker using errcode = '23505';
  end if;

  insert into public.security_universe (
    ticker, provider_symbol, instrument_type, active, support_status, requested_at
  ) values (v_ticker, v_ticker, 'equity', false, 'requested', now())
  on conflict (ticker) do update
    set support_status = 'requested',
        active = false,
        requested_at = now()
    where public.security_universe.support_status = 'declined';

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  return public.request_ticker_support(v_ticker);
end;
$$;

revoke all on function public.request_shared_ticker_support(text) from public, anon, authenticated;
grant execute on function public.request_shared_ticker_support(text) to service_role;
