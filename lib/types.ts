export const LOOKBACKS = [90, 180, 365] as const;
export const BENCHMARKS = ["SPY", "QQQ", "SOXX"] as const;
export const METRICS = ["beta", "beta_contribution", "total_volatility", "residual_volatility"] as const;

export type LookbackDays = (typeof LOOKBACKS)[number];
export type Benchmark = (typeof BENCHMARKS)[number];
export type Metric = (typeof METRICS)[number];
export type PriceSource = "pipeline" | "manual" | "default";
export type BetaSource = "calculated" | "manual" | "default";
export type AnalyticsStatus = "ready" | "partial" | "unavailable";
export type SupportStatus = "supported" | "requested";
export type NullableSeries = Record<LookbackDays, number | null>;

export interface BetaReading {
  value: number;
  source: BetaSource;
}

export interface SecurityMetrics {
  beta: Record<Benchmark, Record<LookbackDays, BetaReading>>;
  totalVolatility: NullableSeries;
  residualVolatility: NullableSeries;
}

export interface ManualBetaFallback {
  benchmark: Benchmark;
  lookbackDays: LookbackDays;
  beta: number;
}

export interface Position {
  snapshotPositionId?: string;
  ticker: string;
  quantity: number;
  price: number;
  priceSource: PriceSource;
  priceDate: string | null;
  pipelineRunId: string | null;
  manualPriceFallback: number | null;
  supported: boolean;
  metrics: SecurityMetrics;
  betaFallbacks: ManualBetaFallback[];
}

export interface SupportedSecurity {
  ticker: string;
  latestPrice: number | null;
  priceDate: string | null;
  pipelineRunId: string | null;
  analyticsAsOf: string | null;
  availableMetricCount: number;
  analyticsStatus: AnalyticsStatus;
}

export interface TickerSupportRequest {
  ticker: string;
  status: "requested" | "added" | "declined";
}

export interface PortfolioData {
  id: string;
  name: string;
  snapshotId: string | null;
  snapshotSavedAt: string | null;
  navAtSave: number;
  nav: number;
  cash: number;
  asOf: string;
  positions: Position[];
  supportedSecurities: SupportedSecurity[];
  tickerSupportRequests: TickerSupportRequest[];
  valuationIncomplete: boolean;
  unpricedTickers: string[];
}

export interface Trade {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  notional: number;
}

export interface PositionRow extends Position {
  marketValue: number;
  exposure: number;
}

export interface PortfolioSummary {
  nav: number;
  longMarketValue: number;
  shortMarketValue: number;
  grossMarketValue: number;
  netMarketValue: number;
  longExposure: number;
  shortExposure: number;
  grossExposure: number;
  netExposure: number;
  grossLeverage: number;
  cash: number;
  cashExposure: number;
  valuationIncomplete: boolean;
}

export interface BetaAggregate {
  value: number | null;
  status: "calculated" | "manual-assisted" | "default-assisted";
  coverage: Record<BetaSource, number>;
}
