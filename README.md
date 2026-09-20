# Portfolio Risk Lens

Portfolio Risk Lens is a private, single-owner long-short portfolio dashboard. It combines a Next.js interface, Supabase authentication and storage, and a Python/yfinance analytics pipeline. This README is the source of truth for valuation, editing, analytics, security, and operating behavior.

## System model

```text
CSV universe + SPY/QQQ/SOXX
              ↓
           yfinance
              ↓
 versioned prices + 90/180/365D analytics
              ↓
           Supabase
              ↓
 latest saved snapshot + session valuation
              ↓
     private Next.js dashboard
```

- `app/` and `components/` contain the private application.
- `src/port_risk_lens/` contains market-data ingestion, analytics, universe loading, seeding, and publication.
- `supabase/migrations/` contains the schema, snapshot transaction, and owner-based access policies.
- `config/initial_universe.csv` contains the normalized initial 78-symbol analytics universe.
- `.github/workflows/portfolio-risk-refresh.yml` runs the same refresh command on schedule and on demand.

The browser receives only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_SECRET_KEY` is restricted to the pipeline and must never use a `NEXT_PUBLIC_` prefix.

## Four separate valuation concepts

The application deliberately distinguishes:

1. **Snapshot state**: signed quantities, cash, manual price fallbacks, and manual beta fallbacks.
2. **Dashboard-session valuation**: the latest database prices read once when a dashboard session opens. There is no real-time polling.
3. **Edit-session valuation**: effective prices copied and frozen when `Edit Portfolio` begins.
4. **NAV at save**: immutable snapshot metadata calculated from the exact prices reviewed and saved.

When a later dashboard session starts, quantities and cash come from the latest snapshot while Current NAV is recalculated from the newest database prices. This can differ from NAV at save without changing the saved snapshot.

```text
NAV at save = saved cash + Σ(saved quantity × valuation price at save)
Current NAV = saved cash + Σ(saved quantity × current effective price)
```

## Portfolio calculations

Signed quantity is authoritative.

```text
signed market value = signed quantity × effective price
position exposure   = signed market value / Current NAV
long exposure       = Σ positive market values / Current NAV
short exposure      = |Σ negative market values| / Current NAV
gross exposure      = long exposure + short exposure
net exposure        = long exposure - short exposure
gross leverage      = Σ |market value| / Current NAV
beta contribution   = signed market value / Current NAV × effective beta
portfolio beta      = Σ beta contributions
```

Cash has beta zero. Stock exposure is never renormalized to 100%. Individual shorts remain negative, while aggregate short exposure is shown as a positive magnitude.

The portfolio table begins with `Portfolio Total` and ends with `Cash`. Portfolio Total displays Current NAV and 100% exposure. Cash displays its value and Current NAV exposure with zero beta contribution. Total and residual volatility are single-security metrics and therefore show `—` in aggregate rows.

## Price and beta precedence

Current and edit-session prices use this order:

1. Dashboard-session pipeline price.
2. Manual fallback price.
3. Application default `0`.

The UI calls the user value **Manual fallback price**. It is retained but inactive when a pipeline price exists; it is not a user override of valid pipeline data.

A nonzero position may be saved at price zero. It has zero market value and exposure, target-market-value editing is disabled, and quantity changes create no cash adjustment. Every NAV-dependent portfolio and scenario result is labelled `Incomplete valuation`. The dashboard separately reports the priced-position count and lists unpriced tickers.

Effective beta uses this order for each benchmark and lookback:

1. Calculated beta.
2. Manual beta fallback.
3. Application default `1.0`.

The default is an application convention, not an estimate. Aggregate beta status is:

- `Calculated` when every valued contribution uses calculated beta.
- `Manual-assisted` when at least one valued contribution uses a manual fallback and none uses the default.
- `Default-assisted` when at least one valued contribution uses the default.

Valuation completeness and beta-source quality are independent. Beta-source shares are gross-exposure weighted among valued non-cash positions and are shown as calculated/manual/default shares.

## Editing and Save Snapshot

The portfolio editor is a transaction-assisted state editor:

- On entering Edit Portfolio, the application freezes an edit-session price for every row.
- Quantity changes adjust draft cash using:

  ```text
  Δcash = −(new quantity − old quantity) × edit-session price
  ```

- The review dialog's cash-impact notional is `Δquantity × edit-session price`, not total position value.
- Long/short crossings use the same formula.
- A manual cash edit creates a new cash baseline; later quantity edits continue applying automatic cash adjustments.
- Changing a manual fallback price revalues the position but never changes cash.
- If the trade-basis price and valuation price differ, both appear in the review.
- Arbitrary normalized tickers may be held. Unsupported tickers are not rejected.
- Saving requires the review dialog and an explicit confirmation.

The review shows quantity deltas, trade-basis prices, cash-impact notionals, valuation prices, cash reconciliation, NAV at save, and incomplete-valuation warnings. A successful save clears browser-local scenarios.

`baseSnapshotId` is the only concurrency guard. If another session saved first, the API returns HTTP 409 with the latest snapshot ID and save time; the user must reload and review. A newer market-data publication does not invalidate an edit because the reviewed price publication is immutable and explicitly referenced.

## Snapshot storage contract

Snapshots are append-only and use UUID IDs. The latest snapshot is queried with the `(portfolio_id, saved_at desc)` index.

Each snapshot stores:

- cash and reproducible NAV at save;
- valuation-incomplete flag and unpriced-position count;
- source (`manual`, `broker`, `seed`, or `legacy`);
- creator, save time, schema version, and application/Git SHA.

Each snapshot position stores:

- normalized ticker and signed quantity;
- optional manual fallback price;
- valuation price, source, and date used at save;
- nullable pipeline-run reference.

Manual beta fallbacks are normalized by position, benchmark, and lookback. Unsupported positions intentionally have no foreign key to the analytics universe; universe membership is enrichment rather than holding validity.

The authenticated save function derives the owner's portfolio from `auth.uid()`. It does not trust a client-selected portfolio ID. It validates values and referenced price publications, derives NAV, and inserts the snapshot, positions, and beta fallbacks atomically.

`daily_price_versions` preserves the immutable price publication identity `(ticker, price_date, pipeline_run_id)` used during review. `daily_prices` remains the rolling analytics history.

## Initial portfolio

All targets are USD market values at seed time.

| Side | Ticker | Target |
| --- | --- | ---: |
| Long | NVDA | $158,000 |
| Long | MU | $119,000 |
| Long | BE | $83,000 |
| Long | SNDK | $80,000 |
| Long | INTC | $67,000 |
| Long | AMD | $66,000 |
| Long | ORCL | $39,000 |
| Short | TSLA | -$26,000 |
| Short | ADBE | -$26,000 |
| Short | INTU | -$26,000 |
| Short | PATH | -$25,000 |
| Short | ADSK | -$21,000 |

| Measure | USD | NAV |
| --- | ---: | ---: |
| Long exposure | $612,000 | 76.50% |
| Short exposure | $124,000 | 15.50% |
| Gross exposure / leverage | $736,000 | 92.00% |
| Net exposure | $488,000 | 61.00% |
| Cash | $312,000 | 39.00% |
| NAV | $800,000 | 100.00% |

Seeding derives six-decimal signed quantities from validated raw closes. At seed time, every quantity multiplied by its seed price must reproduce the target within one cent. Quantities are authoritative thereafter.

## Analytics contract

- Retain a rolling calendar year of closes plus the latest valid trading close preceding the earliest retained return date.
- Use raw close for valuation and adjusted close for analytics.
- Daily simple return is `adjusted_close[t] / adjusted_close[t-1] - 1`.
- Window membership is `as_of - lookback < return_date <= as_of`.
- Beta is the OLS slope with an intercept after inner-joining stock and benchmark returns by date.
- Total volatility is the sample standard deviation of stock returns.
- Residual volatility is the sample standard deviation of residuals from OLS against SPY.
- Volatility uses daily, non-annualized units.
- Residual volatility is always SPY-relative.

| Lookback | Minimum observations | Minimum aligned benchmark coverage |
| ---: | ---: | ---: |
| 90D | 50 | 90% |
| 180D | 100 | 90% |
| 365D | 200 | 90% |

SPY, QQQ, and SOXX beta each use their own valid return dates. SPY residual volatility uses SPY alignment. Standalone total volatility uses only its own valid observation count and has no SPY-calendar dependency.

Failed gates, zero benchmark variance, or unusable data produce a null metric and an availability reason; the UI shows `—`. Metric uniqueness excludes calculation version, so recalculation replaces the same metric key while updating version and pipeline lineage.

## Supported Tickers

`Current Positions` and `Supported Tickers` are URL-addressable tabs. Supported Tickers reports price publication and analytics publication separately.

The global analytics date is the `as_of` date of the latest run whose analytics publication step completed. Price ingestion alone cannot advance it. Every active universe ticker is evaluated against that same date:

```text
9 beta values                 3 benchmarks × 3 lookbacks
3 total-volatility values     90 / 180 / 365
3 SPY residual-vol values     90 / 180 / 365
                              ───────────────
15 expected metrics
```

- `Ready`: 15/15 for the global date.
- `Partial`: 1–14/15.
- `Unavailable`: 0/15.

Older ticker-specific metrics never make a ticker Ready. Unsupported holdings remain valid and use manual/default fallbacks. The Supported Tickers tab filters by price availability and accepts a ticker request directly into `ticker_support_requests`; requests are `requested`, `added`, or `declined`. A refresh marks a pending request `added` when the active universe contains it. The deployment has no GitHub write credential and does not create pull requests.

## Scenario simulator

Scenarios accept a ticker, Buy/Sell, and positive USD notional. Notional is divided by the current effective price. Buying reduces scenario cash, selling increases it, and trades may cross through zero. Scenario NAV remains fixed; negative cash is allowed as hypothetical financing.

Scenario output covers long, short, gross, net, gross leverage, cash, and selected portfolio betas. It does not calculate portfolio/scenario volatility, concentration, financing cost, margin, borrow cost, taxes, fees, or historical risk. Scenarios remain browser-local and are never persisted.

## Local setup and Supabase

Requirements: Node.js 22+, Python 3.13+, `npm`, and `uv`.

```bash
npm install
uv sync
cp .env.example .env.local
npm run dev
```

Without Supabase configuration, local development uses fixed portfolio data and the file universe for UI work. A deployed app shows setup-required rather than exposing that local dataset.

Apply migrations in order:

1. `supabase/migrations/202609200001_initial.sql`
2. `supabase/migrations/202609200002_portfolio_snapshots.sql`
3. `supabase/migrations/202609200003_ticker_support_requests.sql`

The second migration backfills valid legacy state into a `legacy` snapshot. Then:

1. Create or invite the single owner in Supabase Authentication and enable email magic link/OTP.
2. Add local and deployed `/auth/callback` URLs to the redirect allowlist.
3. Configure the variables in `.env.example`.
4. Run the first refresh and seed the snapshot if needed:

   ```bash
   PORTFOLIO_OWNER_ID=<supabase-auth-user-uuid> uv run port-risk-lens refresh --seed-portfolio
   ```

The login flow accepts only `OWNER_EMAIL` and does not create users. Owner-based row-level security protects snapshots and positions. The protected save transaction independently rechecks ownership.

## Universe and later Supabase migration

`UniverseSource.load_active()` trims and uppercases tickers, rejects blanks, duplicates, invalid symbols, and reserved labels such as `Long` and `Short`, and returns deterministic ticker order. The file source contains 78 securities. Required benchmarks SPY, QQQ, and SOXX are fetched separately and are not automatically position-eligible.

Set `UNIVERSE_SOURCE=file` for V1. To migrate later:

1. Create `security_universe` from `supabase/planned/security_universe_cutover.sql`.
2. Import the normalized 78-row CSV set.
3. Compare Supabase and CSV ticker sets exactly with `uv run port-risk-lens compare-universe`.
4. Confirm every existing position's support status; do **not** add a position-to-universe foreign key because unsupported holdings are valid.
5. Switch `UNIVERSE_SOURCE` from `file` to `supabase` and run the same pipeline manually.
6. Compare symbols, prices, metrics, and failures with the file-backed run.
7. Disable CSV runtime loading only after validation.
8. Never silently fall back to CSV when Supabase is selected; source failure must fail the run.

Validate either source with `uv run port-risk-lens validate-universe`.

## Refresh operations

```bash
uv run port-risk-lens refresh
```

GitHub Actions runs the same implementation at 8:35 PM America/New_York each weekday and via manual dispatch. The `portfolio-risk-refresh` concurrency group prevents overlaps without cancelling an active run. `GITHUB_SHA` is recorded in `pipeline_runs`.

A required benchmark failure prevents analytics publication. An individual-security failure produces a partial run with recorded errors. The analytics publication date is recorded only after metric publication completes; price ingestion alone never advances it.

Repository secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

`yfinance` is intended for research and personal use; review its project terms and Yahoo data-use notice before using the pipeline for another purpose.

## Deferred scope

P&L attribution is deferred until transactions, cost basis, external cash flows, dividends, fees, short dividends, and corporate actions are modeled. Snapshot-to-snapshot NAV change is not labelled investment P&L.

## Verification

```bash
npm run typecheck
npm run build
uv run pytest -q
uv run port-risk-lens validate-universe
```

Tests cover window boundaries, predecessor closes, OLS beta, SPY residuals, sample volatility, data-quality gates, signed exposure and beta math, zero-price incomplete valuation, edit-session cash behavior, long/short crossings, immutable snapshot valuation, current revaluation, stale-snapshot conflict metadata, publication status, universe validation, and seed arithmetic.
