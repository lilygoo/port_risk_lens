from __future__ import annotations

import csv
import os
import re
from abc import ABC, abstractmethod
from pathlib import Path

from supabase import Client, create_client

from port_risk_lens.models import SecurityDefinition

SYMBOL_PATTERN = re.compile(r"^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$")
RESERVED_LABELS = frozenset({"LONG", "SHORT", "TICKER", "SYMBOL"})


def normalize_ticker(value: str) -> str:
    ticker = value.strip().upper()
    if not ticker or ticker in RESERVED_LABELS or not SYMBOL_PATTERN.fullmatch(ticker):
        raise ValueError(f"Invalid universe ticker: {value!r}")
    return ticker


class UniverseSource(ABC):
    @abstractmethod
    def load_active(self) -> list[SecurityDefinition]:
        """Return active position-eligible securities sorted by ticker."""


class FileUniverseSource(UniverseSource):
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def load_active(self) -> list[SecurityDefinition]:
        with self.path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames or "Ticker" not in reader.fieldnames:
                raise ValueError("Universe CSV must contain a Ticker header.")
            securities: dict[str, SecurityDefinition] = {}
            for row in reader:
                ticker = normalize_ticker(row.get("Ticker", ""))
                if ticker in securities:
                    raise ValueError(f"Duplicate universe ticker: {ticker}")
                securities[ticker] = SecurityDefinition(ticker=ticker, provider_symbol=ticker)
        return [securities[ticker] for ticker in sorted(securities)]


class SupabaseUniverseSource(UniverseSource):
    def __init__(self, client: Client) -> None:
        self.client = client

    def load_active(self) -> list[SecurityDefinition]:
        response = (
            self.client.table("security_universe")
            .select("ticker,provider_symbol,display_name,instrument_type")
            .eq("active", True)
            .execute()
        )
        securities: dict[str, SecurityDefinition] = {}
        for row in response.data:
            ticker = normalize_ticker(str(row["ticker"]))
            if ticker in securities:
                raise ValueError(f"Duplicate Supabase universe ticker: {ticker}")
            securities[ticker] = SecurityDefinition(
                ticker=ticker,
                provider_symbol=normalize_ticker(str(row.get("provider_symbol") or ticker)),
                display_name=row.get("display_name"),
                instrument_type=row.get("instrument_type") or "equity",
            )
        return [securities[ticker] for ticker in sorted(securities)]


def source_from_environment(root: Path | None = None) -> UniverseSource:
    source = os.getenv("UNIVERSE_SOURCE", "file").strip().lower()
    if source == "file":
        base = root or Path.cwd()
        return FileUniverseSource(base / os.getenv("UNIVERSE_FILE", "config/initial_universe.csv"))
    if source == "supabase":
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SECRET_KEY"]
        return SupabaseUniverseSource(create_client(url, key))
    raise ValueError("UNIVERSE_SOURCE must be exactly 'file' or 'supabase'.")
