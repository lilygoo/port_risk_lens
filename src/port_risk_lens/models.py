from dataclasses import dataclass
from datetime import date

import pandas as pd


@dataclass(frozen=True, slots=True)
class SecurityDefinition:
    ticker: str
    provider_symbol: str
    display_name: str | None = None
    instrument_type: str = "equity"


@dataclass(frozen=True, slots=True)
class RegressionResult:
    beta: float | None
    residual_volatility: float | None
    observations: int
    coverage_ratio: float
    availability_reason: str | None


@dataclass(frozen=True, slots=True)
class RiskMetric:
    ticker: str
    as_of_date: date
    lookback_days: int
    total_volatility: float | None
    residual_volatility_spy: float | None
    stock_observations: int
    spy_aligned_observations: int
    spy_coverage_ratio: float
    total_volatility_reason: str | None
    residual_volatility_reason: str | None


@dataclass(frozen=True, slots=True)
class BetaMetric:
    ticker: str
    as_of_date: date
    lookback_days: int
    benchmark_ticker: str
    beta: float | None
    aligned_observations: int
    coverage_ratio: float
    availability_reason: str | None


@dataclass(frozen=True, slots=True)
class PriceHistory:
    raw_close: pd.Series
    adjusted_close: pd.Series
