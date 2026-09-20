from typing import Final

BENCHMARKS: Final[tuple[str, ...]] = ("SPY", "QQQ", "SOXX")
LOOKBACKS: Final[tuple[int, ...]] = (90, 180, 365)
MIN_OBSERVATIONS: Final[dict[int, int]] = {90: 50, 180: 100, 365: 200}
MIN_COVERAGE: Final[float] = 0.90
CALCULATION_VERSION: Final[str] = "v1"

SEED_NAV: Final[float] = 800_000.0
SEED_CASH: Final[float] = 312_000.0
SEED_TARGETS: Final[dict[str, float]] = {
    "NVDA": 158_000.0,
    "MU": 119_000.0,
    "BE": 83_000.0,
    "SNDK": 80_000.0,
    "INTC": 67_000.0,
    "AMD": 66_000.0,
    "ORCL": 39_000.0,
    "TSLA": -26_000.0,
    "ADBE": -26_000.0,
    "INTU": -26_000.0,
    "PATH": -25_000.0,
    "ADSK": -21_000.0,
}
