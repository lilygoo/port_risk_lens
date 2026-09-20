from datetime import date

import numpy as np
import pandas as pd
import pytest

from port_risk_lens.analytics import calculate_beta, calculate_risk, simple_returns, window_returns


def series(values: np.ndarray, end: str = "2026-09-18") -> pd.Series:
    index = pd.bdate_range(end=end, periods=len(values))
    return pd.Series(values, index=index)


def test_simple_return_and_calendar_window_boundaries() -> None:
    prices = pd.Series(
        [100.0, 101.0, 103.02, 102.0],
        index=pd.to_datetime(["2026-06-19", "2026-06-20", "2026-09-17", "2026-09-18"]),
    )
    returns = simple_returns(prices)
    selected = window_returns(returns, date(2026, 9, 18), 90)
    assert pd.Timestamp("2026-06-20") not in selected.index
    assert list(selected.index) == [pd.Timestamp("2026-09-17"), pd.Timestamp("2026-09-18")]
    assert returns.loc["2026-06-20"] == pytest.approx(0.01)


def test_ols_beta_uses_intercept_and_aligned_dates() -> None:
    benchmark = series(np.linspace(-0.025, 0.03, 65))
    stock = 0.001 + 1.5 * benchmark
    result = calculate_beta("TEST", stock, "SPY", benchmark, date(2026, 9, 18), 90)
    assert result.beta == pytest.approx(1.5)
    assert result.aligned_observations == 65
    assert result.coverage_ratio == pytest.approx(1.0)
    assert result.availability_reason is None


def test_beta_requires_coverage_and_minimum_observations() -> None:
    benchmark = series(np.linspace(-0.02, 0.02, 60))
    stock = benchmark.iloc[-40:] * 1.2
    result = calculate_beta("TEST", stock, "SPY", benchmark, date(2026, 9, 18), 90)
    assert result.beta is None
    assert result.aligned_observations == 40
    assert result.coverage_ratio == pytest.approx(40 / 60)
    assert "coverage" in (result.availability_reason or "")
    assert "observations" in (result.availability_reason or "")


def test_total_volatility_is_independent_of_spy_coverage() -> None:
    stock = series(np.sin(np.arange(60)) / 100)
    spy = stock.iloc[-40:]
    result = calculate_risk("005930.KS", stock, spy, date(2026, 9, 18), 90)
    assert result.total_volatility == pytest.approx(stock.std(ddof=1))
    assert result.total_volatility_reason is None
    assert result.residual_volatility_spy is None
    assert result.residual_volatility_reason is not None


def test_volatility_is_daily_sample_standard_deviation() -> None:
    stock = series(np.array([0.01, -0.02, 0.03, -0.01, 0.005] * 12))
    spy = series(np.array([0.005, -0.01, 0.015, -0.005, 0.0025] * 12))
    result = calculate_risk("TEST", stock, spy, date(2026, 9, 18), 90)
    assert result.total_volatility == pytest.approx(float(stock.std(ddof=1)))
    assert result.total_volatility < 0.1
