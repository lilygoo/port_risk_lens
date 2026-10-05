-- Make request status and pipeline eligibility a single enforced lifecycle.
-- This is intentionally a new migration: 006 may already be applied.
alter table public.security_universe
  add column if not exists last_attempted_at timestamptz,
  add column if not exists last_price_at timestamptz,
  add column if not exists last_error text;

-- Repair pre-existing rows and queue every valid request for the next refresh.
update public.security_universe
set active = true
where support_status in ('requested', 'supported');

update public.security_universe
set active = false
where support_status = 'declined';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'security_universe_lifecycle_check'
      and conrelid = 'public.security_universe'::regclass
  ) then
    alter table public.security_universe
      add constraint security_universe_lifecycle_check
      check (
        (support_status in ('requested', 'supported') and active)
        or (support_status = 'declined' and not active)
      );
  end if;
end;
$$;

-- The Vercel server and GitHub Actions use this role. Browser clients do not.
grant select, update on table public.security_universe to service_role;

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
    ticker, provider_symbol, instrument_type, active, support_status, requested_at, last_error
  ) values (v_ticker, v_ticker, 'equity', true, 'requested', now(), null)
  on conflict (ticker) do update
    set support_status = 'requested',
        active = true,
        requested_at = now(),
        last_error = null
    where public.security_universe.support_status = 'declined';

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  return public.request_ticker_support(v_ticker);
end;
$$;

revoke all on function public.request_shared_ticker_support(text) from public, anon, authenticated;
grant execute on function public.request_shared_ticker_support(text) to service_role;
