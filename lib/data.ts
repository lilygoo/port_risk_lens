import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadActiveUniverse } from "@/lib/universe-file";
import { deriveNav, unpricedTickers } from "@/lib/portfolio";
import {
  BENCHMARKS, LOOKBACKS,
  type Benchmark, type BetaReading, type LookbackDays, type ManualBetaFallback, type PortfolioData, type SecurityMetrics,
  type SupportedSecurity,
} from "@/lib/types";

function betaKey(ticker: string, benchmark: Benchmark, lookback: LookbackDays) {
  return `${ticker}|${benchmark}|${lookback}`;
}

function emptyMetrics(ticker: string, fallbacks: Map<string, number>): SecurityMetrics {
  const beta = Object.fromEntries(BENCHMARKS.map((benchmark) => [benchmark, Object.fromEntries(LOOKBACKS.map((lookback) => {
    const fallback = fallbacks.get(betaKey(ticker, benchmark, lookback));
    const reading: BetaReading = fallback === undefined
      ? { value: 1, source: "default" }
      : { value: fallback, source: "manual" };
    return [lookback, reading];
  }))])) as SecurityMetrics["beta"];
  const empty = () => ({ 90: null, 180: null, 365: null }) as Record<LookbackDays, number | null>;
  return { beta, totalVolatility: empty(), residualVolatility: empty() };
}

export async function loadPortfolio(): Promise<PortfolioData> {
  const supabase = createAdminClient();
  const { data: portfolio, error: portfolioError } = await supabase
    .from("portfolios").select("id,name,owner_id").order("created_at").limit(2);
  if (portfolioError) throw portfolioError;
  if (!portfolio || portfolio.length !== 1) throw new Error("Shared deployment requires exactly one portfolio.");
  const sharedPortfolio = portfolio[0];

  const { data: snapshot, error: snapshotError } = await supabase
    .from("portfolio_snapshots")
    .select("id,cash,nav_at_save,saved_at,valuation_incomplete,unpriced_position_count")
    .eq("portfolio_id", sharedPortfolio.id)
    .order("saved_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshotError) throw snapshotError;
  if (!snapshot) throw new Error("No saved portfolio snapshot exists. Run the seed command first.");

  const [{ data: snapshotPositions, error: positionError }, universe] = await Promise.all([
    supabase.from("portfolio_snapshot_positions")
      .select("id,ticker,signed_quantity,manual_price_fallback,valuation_price_at_save,valuation_price_source_at_save,valuation_price_date_at_save,valuation_pipeline_run_id")
      .eq("snapshot_id", snapshot.id),
    loadActiveUniverse(supabase),
  ]);
  if (positionError) throw positionError;

  const positionIds = (snapshotPositions ?? []).map((row) => row.id);
  const { data: overrideRows, error: overrideError } = positionIds.length
    ? await supabase.from("portfolio_snapshot_beta_overrides")
      .select("snapshot_position_id,benchmark_ticker,lookback_days,beta")
      .in("snapshot_position_id", positionIds)
    : { data: [], error: null };
  if (overrideError) throw overrideError;

  const tickerByPositionId = new Map((snapshotPositions ?? []).map((row) => [row.id, row.ticker]));
  const fallbackMap = new Map<string, number>();
  const fallbackRowsByTicker = new Map<string, ManualBetaFallback[]>();
  for (const row of overrideRows ?? []) {
    const ticker = tickerByPositionId.get(row.snapshot_position_id);
    if (!ticker || !BENCHMARKS.includes(row.benchmark_ticker as Benchmark) || !LOOKBACKS.includes(row.lookback_days as LookbackDays)) continue;
    const fallback: ManualBetaFallback = {
      benchmark: row.benchmark_ticker as Benchmark,
      lookbackDays: row.lookback_days as LookbackDays,
      beta: Number(row.beta),
    };
    fallbackMap.set(betaKey(ticker, fallback.benchmark, fallback.lookbackDays), fallback.beta);
    fallbackRowsByTicker.set(ticker, [...(fallbackRowsByTicker.get(ticker) ?? []), fallback]);
  }

  const { data: requestRows, error: requestError } = await supabase
    .from("ticker_support_requests")
    .select("ticker,status")
    .eq("owner_id", sharedPortfolio.owner_id)
    .eq("status", "requested");
  if (requestError) throw requestError;
  const positionTickers = (snapshotPositions ?? []).map((row) => row.ticker);
  const requestedTickers = (requestRows ?? []).map((row) => row.ticker);
  const allTickers = [...new Set([...universe, ...positionTickers, ...requestedTickers])].sort();
  const [{ data: prices, error: priceError }, { data: publication, error: publicationError }] = await Promise.all([
    allTickers.length
      ? supabase.from("latest_daily_price_versions").select("ticker,price_date,raw_close,pipeline_run_id").in("ticker", allTickers)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("pipeline_runs")
      .select("analytics_as_of_date,analytics_published_at")
      .not("analytics_published_at", "is", null)
      .order("analytics_published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (priceError) throw priceError;
  if (publicationError) throw publicationError;
  const analyticsAsOf = publication?.analytics_as_of_date ?? null;

  const [{ data: risk, error: riskError }, { data: beta, error: betaError }] = analyticsAsOf && allTickers.length
    ? await Promise.all([
      supabase.from("security_risk_metrics")
        .select("ticker,as_of_date,lookback_days,total_volatility,residual_volatility_spy")
        .eq("as_of_date", analyticsAsOf)
        .in("ticker", allTickers),
      supabase.from("security_beta_metrics")
        .select("ticker,as_of_date,lookback_days,benchmark_ticker,beta")
        .eq("as_of_date", analyticsAsOf)
        .in("ticker", allTickers),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (riskError) throw riskError;
  if (betaError) throw betaError;

  const metricMap = new Map<string, SecurityMetrics>();
  for (const ticker of allTickers) metricMap.set(ticker, emptyMetrics(ticker, fallbackMap));
  const availableMetricCount = new Map<string, number>();
  for (const row of risk ?? []) {
    const metrics = metricMap.get(row.ticker);
    if (!metrics || !LOOKBACKS.includes(row.lookback_days as LookbackDays)) continue;
    const lookback = row.lookback_days as LookbackDays;
    metrics.totalVolatility[lookback] = row.total_volatility === null ? null : Number(row.total_volatility);
    metrics.residualVolatility[lookback] = row.residual_volatility_spy === null ? null : Number(row.residual_volatility_spy);
    const count = Number(row.total_volatility !== null) + Number(row.residual_volatility_spy !== null);
    availableMetricCount.set(row.ticker, (availableMetricCount.get(row.ticker) ?? 0) + count);
  }
  for (const row of beta ?? []) {
    const metrics = metricMap.get(row.ticker);
    if (!metrics || !LOOKBACKS.includes(row.lookback_days as LookbackDays) || !BENCHMARKS.includes(row.benchmark_ticker as Benchmark)) continue;
    if (row.beta !== null) {
      metrics.beta[row.benchmark_ticker as Benchmark][row.lookback_days as LookbackDays] = {
        value: Number(row.beta), source: "calculated",
      };
      availableMetricCount.set(row.ticker, (availableMetricCount.get(row.ticker) ?? 0) + 1);
    }
  }

  const priceMap = new Map((prices ?? []).map((row) => [row.ticker, row]));
  const supportedSet = new Set(universe);
  const positions = (snapshotPositions ?? []).map((row) => {
    const pipelinePrice = priceMap.get(row.ticker);
    const fallback = row.manual_price_fallback === null ? null : Number(row.manual_price_fallback);
    const price = pipelinePrice ? Number(pipelinePrice.raw_close) : fallback && fallback > 0 ? fallback : 0;
    return {
      snapshotPositionId: row.id,
      ticker: row.ticker,
      quantity: Number(row.signed_quantity),
      price,
      priceSource: pipelinePrice ? "pipeline" as const : price > 0 ? "manual" as const : "default" as const,
      priceDate: pipelinePrice?.price_date ?? null,
      pipelineRunId: pipelinePrice?.pipeline_run_id ?? null,
      manualPriceFallback: fallback,
      supported: supportedSet.has(row.ticker),
      metrics: metricMap.get(row.ticker) ?? emptyMetrics(row.ticker, fallbackMap),
      betaFallbacks: fallbackRowsByTicker.get(row.ticker) ?? [],
    };
  });
  const unpriced = unpricedTickers(positions);
  const currentNav = deriveNav(positions, Number(snapshot.cash));

  const supportedSecurities: SupportedSecurity[] = universe.map((ticker) => {
    const price = priceMap.get(ticker);
    const count = availableMetricCount.get(ticker) ?? 0;
    return {
      ticker,
      latestPrice: price ? Number(price.raw_close) : null,
      priceDate: price?.price_date ?? null,
      pipelineRunId: price?.pipeline_run_id ?? null,
      analyticsAsOf,
      availableMetricCount: count,
      analyticsStatus: count === 15 ? "ready" : count > 0 ? "partial" : "unavailable",
    };
  });
  const priceDates = (prices ?? []).map((row) => row.price_date).sort();

  return {
    id: sharedPortfolio.id,
    name: sharedPortfolio.name,
    snapshotId: snapshot.id,
    snapshotSavedAt: snapshot.saved_at,
    navAtSave: Number(snapshot.nav_at_save),
    nav: currentNav,
    cash: Number(snapshot.cash),
    asOf: priceDates.at(-1) ?? analyticsAsOf ?? new Date().toISOString().slice(0, 10),
    positions,
    supportedSecurities,
    tickerSupportRequests: (requestRows ?? []).map((row) => ({ ticker: row.ticker, status: row.status as "requested" })),
    valuationIncomplete: unpriced.length > 0,
    unpricedTickers: unpriced,
  };
}
