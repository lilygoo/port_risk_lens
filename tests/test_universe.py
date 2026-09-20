from pathlib import Path

import pytest

from port_risk_lens.constants import BENCHMARKS, SEED_TARGETS
from port_risk_lens.universe import FileUniverseSource


def test_initial_universe_is_clean_sorted_and_contains_seed_positions() -> None:
    securities = FileUniverseSource(Path("config/initial_universe.csv")).load_active()
    tickers = [security.ticker for security in securities]
    assert len(tickers) == 78
    assert tickers == sorted(tickers)
    assert len(tickers) == len(set(tickers))
    assert set(SEED_TARGETS).issubset(tickers)
    assert set(BENCHMARKS).isdisjoint(tickers)


def test_reserved_section_label_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "bad.csv"
    source.write_text("Ticker\nAAPL\nShort\n", encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid universe ticker"):
        FileUniverseSource(source).load_active()


def test_duplicate_after_normalization_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "duplicate.csv"
    source.write_text("Ticker\nAAPL\n aapl \n", encoding="utf-8")
    with pytest.raises(ValueError, match="Duplicate universe ticker"):
        FileUniverseSource(source).load_active()
