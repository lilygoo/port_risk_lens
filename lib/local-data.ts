import type { Benchmark, LookbackDays, PortfolioData, SecurityMetrics, SupportedSecurity, UniverseSecurity } from "@/lib/types";
import { deriveNav } from "@/lib/portfolio";

const targets: Array<[string, number, number, number]> = [
  ["NVDA", 158_000, 184.2, 1.88], ["MU", 119_000, 168.9, 3.47], ["BE", 83_000, 52.4, 1.92],
  ["SNDK", 80_000, 74.6, 1.61], ["INTC", 67_000, 35.8, 1.36], ["AMD", 66_000, 226.1, 3.12],
  ["ORCL", 39_000, 155.4, 1.08], ["TSLA", -26_000, 450.2, 2.05], ["ADBE", -26_000, 318.7, 0.27],
  ["INTU", -26_000, 650.4, 0.91], ["PATH", -25_000, 20.6, 1.15], ["ADSK", -21_000, 300.5, 1.22],
];

const benchmarkScale: Record<Benchmark, number> = { SPY: 1, QQQ: 0.78, SOXX: 0.42 };
const lookbackScale: Record<LookbackDays, number> = { 90: 1.08, 180: 1.03, 365: 1 };

function metrics(baseBeta: number, index: number): SecurityMetrics {
  const beta = Object.fromEntries(
    (["SPY", "QQQ", "SOXX"] as Benchmark[]).map((benchmark) => [benchmark, Object.fromEntries(
      ([90, 180, 365] as LookbackDays[]).map((lookback) => [lookback, {
        value: Number((baseBeta * benchmarkScale[benchmark] * lookbackScale[lookback]).toFixed(3)), source: "calculated",
      }]),
    )]),
  ) as SecurityMetrics["beta"];
  const totalBase = 0.019 + (index % 5) * 0.0037;
  return {
    beta,
    totalVolatility: { 90: Number((totalBase * 1.08).toFixed(4)), 180: Number((totalBase * 1.03).toFixed(4)), 365: Number(totalBase.toFixed(4)) },
    residualVolatility: { 90: Number((totalBase * 0.84).toFixed(4)), 180: Number((totalBase * 0.8).toFixed(4)), 365: Number((totalBase * 0.76).toFixed(4)) },
  };
}

const positions = targets.map(([ticker, targetMarketValue, price, baseBeta], index) => ({
  ticker,
  price,
  priceSource: "pipeline" as const,
  priceDate: "2026-09-18",
  pipelineRunId: `local-run-${ticker}`,
  manualPriceFallback: null,
  supported: true,
  quantity: Number((targetMarketValue / price).toFixed(6)),
  metrics: metrics(baseBeta, index),
  betaFallbacks: [],
}));

export const localPortfolio: PortfolioData = {
  id: "local-seed",
  name: "Primary portfolio",
  snapshotId: "local-snapshot",
  snapshotSavedAt: "2026-09-18T20:35:00Z",
  navAtSave: 800_000,
  nav: deriveNav(positions, 312_000),
  cash: 312_000,
  asOf: "2026-09-18",
  positions,
  supportedSecurities: positions.map((position) => ({
    ticker: position.ticker,
    latestPrice: position.price,
    priceDate: position.priceDate,
    pipelineRunId: position.pipelineRunId,
    analyticsAsOf: "2026-09-18",
    availableMetricCount: 15,
    analyticsStatus: "ready",
  })),
  universeSecurities: [
    ...positions.map((position) => ({
      ticker: position.ticker,
      latestPrice: position.price,
      priceDate: position.priceDate,
      pipelineRunId: position.pipelineRunId,
      analyticsAsOf: "2026-09-18",
      availableMetricCount: 15,
      analyticsStatus: "ready" as const,
      supportStatus: "supported" as const,
      active: true,
    })),
    { ticker: "CRWV", latestPrice: null, priceDate: null, pipelineRunId: null, analyticsAsOf: null, availableMetricCount: 0, analyticsStatus: "unavailable", supportStatus: "requested", active: false },
  ],
  tickerSupportRequests: [{ ticker: "CRWV", status: "requested" }],
  valuationIncomplete: false,
  unpricedTickers: [],
};

export function withLocalSupportedSecurities(portfolio: PortfolioData, tickers: string[]): PortfolioData {
  const byTicker = new Map(portfolio.supportedSecurities.map((security) => [security.ticker, security]));
  const supportedSecurities: SupportedSecurity[] = tickers.map((ticker) => byTicker.get(ticker) ?? {
    ticker,
    latestPrice: null,
    priceDate: null,
    pipelineRunId: null,
    analyticsAsOf: portfolio.asOf,
    availableMetricCount: 0,
    analyticsStatus: "unavailable",
  });
  const requested = portfolio.universeSecurities.filter((security) => security.supportStatus === "requested");
  const universeSecurities: UniverseSecurity[] = [
    ...supportedSecurities.map((security) => ({ ...security, supportStatus: "supported" as const, active: true })),
    ...requested.filter((security) => !tickers.includes(security.ticker)),
  ];
  return { ...portfolio, supportedSecurities, universeSecurities };
}
