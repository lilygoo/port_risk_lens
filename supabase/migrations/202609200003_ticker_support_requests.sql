create table public.ticker_support_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker = upper(trim(ticker)) and ticker ~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$'),
  status text not null default 'requested' check (status in ('requested', 'added', 'declined')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (owner_id, ticker)
);

alter table public.ticker_support_requests enable row level security;

create policy "owner reads ticker support requests" on public.ticker_support_requests for select to authenticated
using (owner_id = auth.uid());

create or replace function public.request_ticker_support(p_ticker text)
returns public.ticker_support_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_ticker text := upper(trim(p_ticker));
  v_request public.ticker_support_requests;
begin
  if v_owner is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if v_ticker !~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$' then raise exception 'invalid ticker'; end if;

  insert into public.ticker_support_requests (owner_id, ticker, status, requested_at, resolved_at)
  values (v_owner, v_ticker, 'requested', now(), null)
  on conflict (owner_id, ticker) do update
    set status = case when ticker_support_requests.status = 'declined' then 'requested' else ticker_support_requests.status end,
        requested_at = case when ticker_support_requests.status = 'declined' then now() else ticker_support_requests.requested_at end,
        resolved_at = case when ticker_support_requests.status = 'declined' then null else ticker_support_requests.resolved_at end
  returning * into v_request;
  return v_request;
end;
$$;

revoke all on function public.request_ticker_support(text) from public, anon;
grant execute on function public.request_ticker_support(text) to authenticated;
