from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExposureSummary:
    long_market_value: float
    short_market_value: float
    gross_market_value: float
    net_market_value: float
    long_exposure: float
    short_exposure: float
    gross_exposure: float
    net_exposure: float


def summarize_exposure(signed_market_values: list[float], nav: float) -> ExposureSummary:
    if nav <= 0:
        raise ValueError("NAV must be positive.")
    long_market_value = sum(value for value in signed_market_values if value > 0)
    short_market_value = abs(sum(value for value in signed_market_values if value < 0))
    gross_market_value = long_market_value + short_market_value
    net_market_value = long_market_value - short_market_value
    return ExposureSummary(
        long_market_value=long_market_value,
        short_market_value=short_market_value,
        gross_market_value=gross_market_value,
        net_market_value=net_market_value,
        long_exposure=long_market_value / nav,
        short_exposure=short_market_value / nav,
        gross_exposure=gross_market_value / nav,
        net_exposure=net_market_value / nav,
    )


def portfolio_beta(signed_market_values: list[float], betas: list[float], nav: float) -> float:
    if len(signed_market_values) != len(betas):
        raise ValueError("Market values and betas must have equal length.")
    if nav <= 0:
        raise ValueError("NAV must be positive.")
    return sum((value / nav) * beta for value, beta in zip(signed_market_values, betas, strict=True))


def scenario_cash(cash: float, side: str, notional: float) -> float:
    if notional <= 0:
        raise ValueError("Notional must be positive.")
    if side == "buy":
        return cash - notional
    if side == "sell":
        return cash + notional
    raise ValueError("Side must be buy or sell.")


def quantity_change_cash(cash: float, old_quantity: float, new_quantity: float, session_price: float) -> float:
    if session_price < 0:
        raise ValueError("Session price cannot be negative.")
    return cash - (new_quantity - old_quantity) * session_price


def derived_nav(cash: float, quantities: list[float], prices: list[float]) -> float:
    if len(quantities) != len(prices):
        raise ValueError("Quantities and prices must have equal length.")
    if any(price < 0 for price in prices):
        raise ValueError("Prices cannot be negative.")
    return cash + sum(quantity * price for quantity, price in zip(quantities, prices, strict=True))
