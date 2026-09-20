from __future__ import annotations

import os
from datetime import date

from port_risk_lens.analytics import calculate_beta, calculate_risk, simple_returns
from port_risk_lens.constants import BENCHMARKS, CALCULATION_VERSION, LOOKBACKS
from port_risk_lens.market_data import YFinanceProvider
from port_risk_lens.models import BetaMetric, PriceHistory, RiskMetric
from port_risk_lens.storage import SupabaseStore
from port_risk_lens.universe import source_from_environment


def refresh(requested_as_of: date | None = None, store: SupabaseStore | None = None) -> dict[str, object]:
    provider = YFinanceProvider()
    database = store or SupabaseStore()
    run_id = database.start_run(provider.name, os.getenv("GITHUB_SHA"))
    errors: dict[str, str] = {}
    try:
        securities = source_from_environment().load_active()
        provider_to_ticker = {security.provider_symbol: security.ticker for security in securities}
        for benchmark in BENCHMARKS:
            provider_to_ticker[benchmark] = benchmark
        provider_histories, provider_errors = provider.fetch(list(provider_to_ticker), requested_as_of)
        histories: dict[str, PriceHistory] = {
            provider_to_ticker[provider_symbol]: history for provider_symbol, history in provider_histories.items()
        }
        errors.update({provider_to_ticker.get(symbol, symbol): message for symbol, message in provider_errors.items()})

        missing_benchmarks = [benchmark for benchmark in BENCHMARKS if benchmark not in histories]
        if missing_benchmarks:
            raise RuntimeError(f"Required benchmark retrieval failed: {', '.join(missing_benchmarks)}")

        as_of = min(max(histories[benchmark].adjusted_close.index).date() for benchmark in BENCHMARKS)
        retained_histories: dict[str, PriceHistory] = {}
        for ticker, history in histories.items():
            try:
                retained_histories[ticker] = provider.retain_required_history(history, as_of)
            except ValueError as exc:
                errors[ticker] = str(exc)
        histories = retained_histories
        missing_benchmarks = [benchmark for benchmark in BENCHMARKS if benchmark not in histories]
        if missing_benchmarks:
            raise RuntimeError(f"Required benchmark history is incomplete: {', '.join(missing_benchmarks)}")
        returns = {ticker: simple_returns(history.adjusted_close) for ticker, history in histories.items()}
        risk_metrics: list[RiskMetric] = []
        beta_metrics: list[BetaMetric] = []
        for security in securities:
            ticker = security.ticker
            if ticker not in returns:
                errors.setdefault(ticker, "no usable price history")
                continue
            for lookback in LOOKBACKS:
                risk_metrics.append(calculate_risk(ticker, returns[ticker], returns["SPY"], as_of, lookback))
                for benchmark in BENCHMARKS:
                    beta_metrics.append(calculate_beta(ticker, returns[ticker], benchmark, returns[benchmark], as_of, lookback))

        database.upsert_prices(histories, run_id)
        calculation_version = os.getenv("CALCULATION_VERSION", CALCULATION_VERSION)
        database.upsert_risk_metrics(risk_metrics, run_id, calculation_version)
        database.upsert_beta_metrics(beta_metrics, run_id, calculation_version)
        status = "partial_success" if errors else "success"
        database.finish_run(run_id, status, errors, analytics_as_of=as_of)
        return {"run_id": run_id, "status": status, "as_of": as_of.isoformat(), "errors": errors}
    except Exception as exc:
        errors.setdefault("pipeline", str(exc))
        try:
            database.finish_run(run_id, "failed", errors)
        finally:
            raise
