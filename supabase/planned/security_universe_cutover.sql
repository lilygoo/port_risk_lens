-- Apply only during the documented file-to-Supabase universe cutover.
create table public.security_universe (
  ticker text primary key check (ticker = upper(trim(ticker)) and ticker ~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$'),
  provider_symbol text not null,
  display_name text,
  instrument_type text not null default 'equity',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.security_universe enable row level security;
create policy "authenticated reads universe" on public.security_universe for select to authenticated using (true);
create trigger security_universe_touch_updated_at before update on public.security_universe for each row execute function public.touch_updated_at();

-- Snapshot positions intentionally have no universe foreign key. Unsupported holdings are valid;
-- matching security_universe is analytics-support enrichment rather than position validity.
