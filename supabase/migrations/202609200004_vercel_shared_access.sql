-- Vercel Authentication is the only interactive access gate for this deployment.
-- Browser clients never receive the Supabase secret and these entry points can
-- be called only with the service-role key from Vercel server code.

create or replace function public.shared_portfolio_owner_id()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select count(*) into v_count from public.portfolios;
  select owner_id into v_owner_id from public.portfolios order by created_at limit 1;
  if v_count <> 1 or v_owner_id is null then
    raise exception 'shared deployment requires exactly one portfolio';
  end if;
  return v_owner_id;
end;
$$;

revoke all on function public.shared_portfolio_owner_id() from public, anon, authenticated;
grant execute on function public.shared_portfolio_owner_id() to service_role;

create or replace function public.create_shared_portfolio_snapshot(
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
  v_owner_id uuid;
begin
  v_owner_id := public.shared_portfolio_owner_id();
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  return public.create_portfolio_snapshot(
    p_base_snapshot_id, p_cash, p_positions, p_beta_overrides, p_schema_version, p_app_version
  );
end;
$$;

revoke all on function public.create_shared_portfolio_snapshot(uuid, numeric, jsonb, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.create_shared_portfolio_snapshot(uuid, numeric, jsonb, jsonb, integer, text) to service_role;

create or replace function public.request_shared_ticker_support(p_ticker text)
returns public.ticker_support_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  v_owner_id := public.shared_portfolio_owner_id();
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  return public.request_ticker_support(p_ticker);
end;
$$;

revoke all on function public.request_shared_ticker_support(text) from public, anon, authenticated;
grant execute on function public.request_shared_ticker_support(text) to service_role;
