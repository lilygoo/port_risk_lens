from decimal import Decimal, ROUND_HALF_UP

import pytest

from port_risk_lens.constants import SEED_CASH, SEED_NAV, SEED_TARGETS
from port_risk_lens.portfolio import (
    derived_nav,
    portfolio_beta,
    quantity_change_cash,
    scenario_cash,
    summarize_exposure,
)


def test_seed_portfolio_reconciles_to_nav() -> None:
    summary = summarize_exposure(list(SEED_TARGETS.values()), SEED_NAV)
    assert summary.long_market_value == 612_000
    assert summary.short_market_value == 124_000
    assert summary.gross_market_value == 736_000
    assert summary.net_market_value == 488_000
    assert summary.long_exposure == pytest.approx(0.765)
    assert summary.short_exposure == pytest.approx(0.155)
    assert summary.gross_exposure == pytest.approx(0.92)
    assert summary.net_exposure == pytest.approx(0.61)
    assert SEED_CASH + summary.net_market_value == SEED_NAV


def test_nav_based_beta_preserves_short_sign_and_cash_beta_zero() -> None:
    assert portfolio_beta([160_000, -80_000], [1.5, 2.0], 800_000) == pytest.approx(0.1)


def test_scenario_cash_can_be_negative() -> None:
    assert scenario_cash(50_000, "buy", 100_000) == -50_000
    assert scenario_cash(50_000, "sell", 100_000) == 150_000


def test_six_decimal_seed_quantity_hits_each_target_within_one_cent() -> None:
    prices = {ticker: Decimal(str(37.25 + index * 13.17)) for index, ticker in enumerate(SEED_TARGETS)}
    for ticker, target_value in SEED_TARGETS.items():
        target = Decimal(str(target_value))
        quantity = (target / prices[ticker]).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        assert abs(quantity * prices[ticker] - target) <= Decimal("0.01")


@pytest.mark.parametrize(("old_quantity", "new_quantity", "expected_cash"), [
    (100, 150, 11_000),
    (100, 50, 29_000),
    (-100, -150, 29_000),
    (-100, -50, 11_000),
    (100, -50, 47_000),
])
def test_quantity_changes_use_one_signed_cash_formula(old_quantity: float, new_quantity: float, expected_cash: float) -> None:
    assert quantity_change_cash(20_000, old_quantity, new_quantity, 180) == expected_cash


def test_snapshot_nav_and_current_nav_can_diverge_without_changing_state() -> None:
    cash = 20_000
    quantity = [100]
    nav_at_save = derived_nav(cash, quantity, [180])
    current_nav = derived_nav(cash, quantity, [190])
    assert nav_at_save == 38_000
    assert current_nav == 39_000
    assert cash == 20_000
    assert quantity == [100]


def test_zero_price_is_allowed_but_contributes_no_valuation() -> None:
    assert derived_nav(20_000, [100, 50], [180, 0]) == 38_000
