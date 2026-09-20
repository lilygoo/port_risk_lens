from __future__ import annotations

import os
from decimal import Decimal, ROUND_HALF_UP

from port_risk_lens.constants import SEED_CASH, SEED_NAV, SEED_TARGETS
from port_risk_lens.storage import SupabaseStore


def seed_initial_portfolio(store: SupabaseStore, owner_id: str) -> str:
    tickers = sorted(SEED_TARGETS)
    response = store.client.table("latest_daily_price_versions").select(
        "ticker,price_date,raw_close,pipeline_run_id"
    ).in_("ticker", tickers).execute()
    prices = {row["ticker"]: row for row in response.data}
    missing = sorted(set(tickers) - set(prices))
    if missing:
        raise ValueError(f"Cannot seed positions without current raw prices: {', '.join(missing)}")

    portfolio_lookup = store.client.table("portfolios").select("id").eq("owner_id", owner_id).limit(1).execute()
    if portfolio_lookup.data:
        portfolio_id = str(portfolio_lookup.data[0]["id"])
        existing = store.client.table("portfolio_snapshots").select("id").eq("portfolio_id", portfolio_id).limit(1).execute()
        if existing.data:
            raise ValueError("Portfolio already has a saved snapshot; refusing to seed it again.")
    else:
        portfolio_response = store.client.table("portfolios").insert({
            "owner_id": owner_id,
            "name": "Primary portfolio",
            "nav": SEED_NAV,
            "cash": SEED_CASH,
        }).execute()
        portfolio_id = str(portfolio_response.data[0]["id"])

    position_rows: list[dict] = []
    valued_positions = Decimal("0")
    for ticker, target_value in SEED_TARGETS.items():
        price = Decimal(str(prices[ticker]["raw_close"]))
        target = Decimal(str(target_value))
        quantity = (target / price).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        market_value = quantity * price
        error = abs(market_value - target)
        if error > Decimal("0.01"):
            raise ValueError(f"Six-decimal seed quantity for {ticker} misses target by {error}")
        valued_positions += market_value
        position_rows.append({
            "ticker": ticker,
            "signed_quantity": float(quantity),
            "valuation_price_at_save": float(price),
            "valuation_price_source_at_save": "pipeline",
            "valuation_price_date_at_save": prices[ticker]["price_date"],
            "valuation_pipeline_run_id": prices[ticker]["pipeline_run_id"],
        })

    nav_at_save = Decimal(str(SEED_CASH)) + valued_positions
    snapshot_response = store.client.table("portfolio_snapshots").insert({
        "portfolio_id": portfolio_id,
        "cash": SEED_CASH,
        "nav_at_save": float(nav_at_save),
        "valuation_incomplete": False,
        "unpriced_position_count": 0,
        "source": "seed",
        "schema_version": 1,
        "app_version": os.getenv("GITHUB_SHA", "seed-local"),
        "created_by": owner_id,
    }).execute()
    snapshot_id = str(snapshot_response.data[0]["id"])
    for row in position_rows:
        row["snapshot_id"] = snapshot_id
    store.client.table("portfolio_snapshot_positions").insert(position_rows).execute()
    return portfolio_id
