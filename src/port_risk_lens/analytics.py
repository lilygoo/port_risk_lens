from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from port_risk_lens.constants import MIN_COVERAGE, MIN_OBSERVATIONS
from port_risk_lens.models import BetaMetric, RegressionResult, RiskMetric


def simple_returns(adjusted_close: pd.Series) -> pd.Series:
    prices = adjusted_close.astype(float).sort_index()
    prices = prices[~prices.index.duplicated(keep="last")]
    returns = prices.pct_change(fill_method=None).replace([np.inf, -np.inf], np.nan).dropna()
    returns.name = "return"
    return returns


def window_returns(returns: pd.Series, as_of: date | pd.Timestamp, lookback_days: int) -> pd.Series:
    end = pd.Timestamp(as_of).normalize()
    start = end - pd.Timedelta(days=lookback_days)
    normalized_index = pd.DatetimeIndex(returns.index).tz_localize(None).normalize()
    selected = returns.copy()
    selected.index = normalized_index
    return selected[(selected.index > start) & (selected.index <= end)].dropna()


def regress(stock: pd.Series, benchmark: pd.Series, as_of: date, lookback_days: int) -> RegressionResult:
    stock_window = window_returns(stock, as_of, lookback_days)
    benchmark_window = window_returns(benchmark, as_of, lookback_days)
    aligned = pd.concat([stock_window.rename("stock"), benchmark_window.rename("benchmark")], axis=1, join="inner").dropna()
    observations = len(aligned)
    denominator = len(benchmark_window)
    coverage = observations / denominator if denominator else 0.0
    minimum = MIN_OBSERVATIONS[lookback_days]

    reasons: list[str] = []
    if coverage < MIN_COVERAGE:
        reasons.append(f"coverage {coverage:.1%} below {MIN_COVERAGE:.0%}")
    if observations < minimum:
        reasons.append(f"{observations} observations below {minimum}")
    if reasons:
        return RegressionResult(None, None, observations, coverage, "; ".join(reasons))

    x = aligned["benchmark"].to_numpy(dtype=float)
    y = aligned["stock"].to_numpy(dtype=float)
    if np.isclose(np.var(x, ddof=1), 0.0):
        return RegressionResult(None, None, observations, coverage, "benchmark variance is zero")
    design = np.column_stack((np.ones(observations), x))
    coefficients, _, _, _ = np.linalg.lstsq(design, y, rcond=None)
    residuals = y - design @ coefficients
    return RegressionResult(
        beta=float(coefficients[1]),
        residual_volatility=float(np.std(residuals, ddof=1)),
        observations=observations,
        coverage_ratio=coverage,
        availability_reason=None,
    )


def calculate_beta(ticker: str, stock: pd.Series, benchmark_ticker: str, benchmark: pd.Series, as_of: date, lookback_days: int) -> BetaMetric:
    result = regress(stock, benchmark, as_of, lookback_days)
    return BetaMetric(
        ticker=ticker,
        as_of_date=as_of,
        lookback_days=lookback_days,
        benchmark_ticker=benchmark_ticker,
        beta=result.beta,
        aligned_observations=result.observations,
        coverage_ratio=result.coverage_ratio,
        availability_reason=result.availability_reason,
    )


def calculate_risk(ticker: str, stock: pd.Series, spy: pd.Series, as_of: date, lookback_days: int) -> RiskMetric:
    stock_window = window_returns(stock, as_of, lookback_days)
    stock_observations = len(stock_window)
    minimum = MIN_OBSERVATIONS[lookback_days]
    total_reason = None if stock_observations >= minimum else f"{stock_observations} observations below {minimum}"
    total_volatility = float(stock_window.std(ddof=1)) if total_reason is None else None
    spy_result = regress(stock, spy, as_of, lookback_days)
    return RiskMetric(
        ticker=ticker,
        as_of_date=as_of,
        lookback_days=lookback_days,
        total_volatility=total_volatility,
        residual_volatility_spy=spy_result.residual_volatility,
        stock_observations=stock_observations,
        spy_aligned_observations=spy_result.observations,
        spy_coverage_ratio=spy_result.coverage_ratio,
        total_volatility_reason=total_reason,
        residual_volatility_reason=spy_result.availability_reason,
    )
