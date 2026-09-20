from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import yfinance as yf

from port_risk_lens.models import PriceHistory


class YFinanceProvider:
    name = "yfinance"

    def fetch(self, symbols: list[str], requested_as_of: date | None = None) -> tuple[dict[str, PriceHistory], dict[str, str]]:
        as_of = requested_as_of or date.today()
        start = as_of - timedelta(days=380)
        end = as_of + timedelta(days=1)
        downloaded = yf.download(
            tickers=sorted(set(symbols)),
            start=start.isoformat(),
            end=end.isoformat(),
            auto_adjust=False,
            actions=False,
            group_by="ticker",
            threads=True,
            progress=False,
        )
        histories: dict[str, PriceHistory] = {}
        errors: dict[str, str] = {}
        for symbol in sorted(set(symbols)):
            try:
                frame = self._symbol_frame(downloaded, symbol, len(symbols))
                if "Close" not in frame.columns or "Adj Close" not in frame.columns:
                    raise ValueError("provider response lacks raw or adjusted close")
                raw = self._normalize(frame["Close"])
                adjusted = self._normalize(frame["Adj Close"])
                combined = pd.concat([raw.rename("raw"), adjusted.rename("adjusted")], axis=1).dropna()
                if combined.empty:
                    raise ValueError("no valid closes returned")
                eligible = combined[combined.index <= pd.Timestamp(as_of)]
                if eligible.empty:
                    raise ValueError("no valid closes on or before the requested date")
                histories[symbol] = PriceHistory(eligible["raw"], eligible["adjusted"])
            except Exception as exc:  # provider errors are isolated per security
                errors[symbol] = str(exc)
        return histories, errors

    @staticmethod
    def _symbol_frame(downloaded: pd.DataFrame, symbol: str, symbol_count: int) -> pd.DataFrame:
        if not isinstance(downloaded.columns, pd.MultiIndex):
            if symbol_count != 1:
                raise ValueError("unexpected provider column layout")
            return downloaded
        if symbol in downloaded.columns.get_level_values(0):
            return downloaded[symbol]
        if symbol in downloaded.columns.get_level_values(1):
            return downloaded.xs(symbol, axis=1, level=1)
        raise ValueError("ticker missing from provider response")

    @staticmethod
    def _normalize(series: pd.Series) -> pd.Series:
        normalized = series.astype(float).dropna().sort_index()
        normalized.index = pd.DatetimeIndex(normalized.index).tz_localize(None).normalize()
        return normalized[~normalized.index.duplicated(keep="last")]

    @staticmethod
    def _retain_required_history(frame: pd.DataFrame, as_of: date) -> pd.DataFrame:
        end = pd.Timestamp(as_of)
        lower_boundary = end - pd.Timedelta(days=365)
        eligible = frame[frame.index <= end]
        inside = eligible[eligible.index > lower_boundary]
        predecessor = eligible[eligible.index <= lower_boundary].tail(1)
        if inside.empty or predecessor.empty:
            raise ValueError("insufficient history for a 365-day window and predecessor close")
        return pd.concat([predecessor, inside]).sort_index()

    @classmethod
    def retain_required_history(cls, history: PriceHistory, as_of: date) -> PriceHistory:
        frame = history.raw_close.rename("raw").to_frame().join(history.adjusted_close.rename("adjusted"), how="inner")
        retained = cls._retain_required_history(frame, as_of)
        return PriceHistory(retained["raw"], retained["adjusted"])
