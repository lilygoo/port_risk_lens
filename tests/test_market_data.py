import pandas as pd

from port_risk_lens.market_data import YFinanceProvider


def test_retention_keeps_latest_predecessor_close() -> None:
    index = pd.to_datetime(["2025-09-18", "2025-09-19", "2025-09-22", "2026-09-18"])
    frame = pd.DataFrame({"raw": [10, 11, 12, 13], "adjusted": [9.5, 10.5, 11.5, 12.5]}, index=index)
    retained = YFinanceProvider._retain_required_history(frame, pd.Timestamp("2026-09-20").date())
    assert list(retained.index) == [pd.Timestamp("2025-09-19"), pd.Timestamp("2025-09-22"), pd.Timestamp("2026-09-18")]


def test_retention_uses_actual_as_of_not_run_date() -> None:
    index = pd.to_datetime(["2025-09-18", "2025-09-19", "2025-09-22", "2026-09-18"])
    frame = pd.DataFrame({"raw": [10, 11, 12, 13], "adjusted": [9.5, 10.5, 11.5, 12.5]}, index=index)
    retained = YFinanceProvider._retain_required_history(frame, pd.Timestamp("2026-09-18").date())
    assert retained.index[0] == pd.Timestamp("2025-09-18")
    assert retained.index[1] == pd.Timestamp("2025-09-19")
