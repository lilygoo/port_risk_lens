-- The Vercel server uses the service-role key after Vercel Authentication has
-- admitted the request. It needs this explicit privilege for the normalized
-- beta-fallback table created after the initial schema.
grant usage on schema public to service_role;
grant select on table public.portfolio_snapshot_beta_overrides to service_role;
