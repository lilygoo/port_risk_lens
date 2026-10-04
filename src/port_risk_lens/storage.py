from __future__ import annotations

import os
from dataclasses import asdict
from datetime import date, datetime, timezone
from typing import Iterable

from supabase import Client, create_client

from port_risk_lens.models import BetaMetric, PriceHistory, RiskMetric


def _chunks(rows: list[dict], size: int = 500) -> Iterable[list[dict]]:
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


class SupabaseStore:
    def __init__(self, client: Client | None = None) -> None:
        self.client = client or create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])

    def start_run(self, provider: str, git_sha: str | None) -> str:
        response = self.client.table("pipeline_runs").insert({
            "status": "running", "provider": provider, "git_sha": git_sha,
        }).execute()
        return str(response.data[0]["id"])

    def finish_run(self, run_id: str, status: str, errors: dict[str, str], analytics_as_of: date | None = None) -> None:
        finished_at = datetime.now(timezone.utc).isoformat()
        values = {
            "finished_at": finished_at,
            "status": status,
            "error_summary": [{"ticker": ticker, "error": message} for ticker, message in sorted(errors.items())],
        }
        if analytics_as_of is not None:
            values.update({
                "analytics_as_of_date": analytics_as_of.isoformat(),
                "analytics_published_at": finished_at,
            })
        self.client.table("pipeline_runs").update(values).eq("id", run_id).execute()

    def upsert_prices(self, histories: dict[str, PriceHistory], run_id: str) -> None:
        rows: list[dict] = []
        version_rows: list[dict] = []
        for ticker, history in histories.items():
            frame = history.raw_close.rename("raw").to_frame().join(history.adjusted_close.rename("adjusted"), how="inner")
            for price_date, row in frame.iterrows():
                rows.append({
                    "ticker": ticker,
                    "price_date": price_date.date().isoformat(),
                    "raw_close": float(row["raw"]),
                    "adjusted_close": float(row["adjusted"]),
                    "pipeline_run_id": run_id,
                })
            latest_date = frame.index[-1]
            latest = frame.iloc[-1]
            version_rows.append({
                "ticker": ticker,
                "price_date": latest_date.date().isoformat(),
                "raw_close": float(latest["raw"]),
                "adjusted_close": float(latest["adjusted"]),
                "pipeline_run_id": run_id,
            })
        for chunk in _chunks(version_rows):
            self.client.table("daily_price_versions").upsert(
                chunk, on_conflict="ticker,price_date,pipeline_run_id"
            ).execute()
        for chunk in _chunks(rows):
            self.client.table("daily_prices").upsert(chunk, on_conflict="ticker,price_date").execute()
        for ticker, history in histories.items():
            earliest = min(history.raw_close.index).date().isoformat()
            self.client.table("daily_prices").delete().eq("ticker", ticker).lt("price_date", earliest).execute()

    def upsert_risk_metrics(self, metrics: list[RiskMetric], run_id: str, calculation_version: str) -> None:
        rows = []
        for metric in metrics:
            row = asdict(metric)
            row["as_of_date"] = metric.as_of_date.isoformat()
            row.update({"pipeline_run_id": run_id, "calculation_version": calculation_version})
            rows.append(row)
        for chunk in _chunks(rows):
            self.client.table("security_risk_metrics").upsert(chunk, on_conflict="ticker,as_of_date,lookback_days").execute()

    def upsert_beta_metrics(self, metrics: list[BetaMetric], run_id: str, calculation_version: str) -> None:
        rows = []
        for metric in metrics:
            row = asdict(metric)
            row["as_of_date"] = metric.as_of_date.isoformat()
            row.update({"pipeline_run_id": run_id, "calculation_version": calculation_version})
            rows.append(row)
        for chunk in _chunks(rows):
            self.client.table("security_beta_metrics").upsert(chunk, on_conflict="ticker,as_of_date,lookback_days,benchmark_ticker").execute()

    def mark_requested_tickers_supported(self, priced_tickers: Iterable[str]) -> None:
        """Promote requested symbols only after the provider returned usable prices."""
        tickers = sorted(set(priced_tickers))
        if not tickers:
            return
        resolved_at = datetime.now(timezone.utc).isoformat()
        self.client.table("security_universe").update({
            "support_status": "supported",
            "active": True,
            "supported_at": resolved_at,
        }).eq("support_status", "requested").in_("ticker", tickers).execute()
        self.client.table("ticker_support_requests").update({
            "status": "added",
            "resolved_at": resolved_at,
        }).eq("status", "requested").in_("ticker", tickers).execute()
