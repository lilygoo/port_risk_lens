from pathlib import Path


def test_snapshot_migration_contains_reproducibility_and_concurrency_contracts() -> None:
    migration = Path("supabase/migrations/202609200002_portfolio_snapshots.sql").read_text()
    for contract in (
        "daily_price_versions",
        "valuation_price_at_save",
        "valuation_price_source_at_save",
        "valuation_incomplete",
        "analytics_published_at",
        "p_base_snapshot_id",
        "auth.uid()",
        "latestSnapshotId",
    ):
        assert contract in migration
    assert "prices.raw_close = (item->>'valuation_price')::numeric" in migration
    assert "where derived_nav > 0" in migration
    assert "greatest(derived_nav" not in migration


def test_snapshot_api_uses_server_only_shared_access_and_returns_conflict_details() -> None:
    route = Path("app/api/portfolio/snapshots/route.ts").read_text()
    migration = Path("supabase/migrations/202609200004_vercel_shared_access.sql").read_text()
    assert "createAdminClient" in route
    assert "create_shared_portfolio_snapshot" in route
    assert "service role required" in migration
    assert "p_base_snapshot_id" in route
    assert "latestSnapshotId" in route
    assert "latestSavedAt" in route
    assert "portfolioId" not in route


def test_editor_keeps_manual_price_fallback_only_and_requires_review() -> None:
    editor = Path("components/portfolio-editor.tsx").read_text()
    assert 'if (position.pipelinePriceActive) return position.sessionPrice' in editor
    assert "Manual fallback price" in editor
    assert "Review snapshot" in editor
    assert "Confirm and save snapshot" in editor
    assert "Incomplete valuation" in editor


def test_analytics_publication_is_separate_from_price_ingestion() -> None:
    pipeline = Path("src/port_risk_lens/pipeline.py").read_text()
    storage = Path("src/port_risk_lens/storage.py").read_text()
    assert "analytics_as_of=as_of" in pipeline
    assert "analytics_published_at" in storage


def test_requested_universe_tickers_are_automatically_onboarded_and_observable() -> None:
    migration = Path("supabase/migrations/202610040007_automatic_universe_onboarding.sql").read_text()
    pipeline = Path("src/port_risk_lens/pipeline.py").read_text()
    storage = Path("src/port_risk_lens/storage.py").read_text()
    universe = Path("src/port_risk_lens/universe.py").read_text()
    assert "last_attempted_at" in migration
    assert "last_price_at" in migration
    assert "last_error" in migration
    assert "support_status in ('requested', 'supported')" in migration
    assert "values (v_ticker, v_ticker, 'equity', true, 'requested'" in migration
    assert ".in_(\"support_status\", [\"requested\", \"supported\"])" in universe
    assert "record_universe_refresh" in pipeline
    assert "support_status\": \"supported\"" in storage
