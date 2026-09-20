from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from supabase import create_client

from port_risk_lens.pipeline import refresh
from port_risk_lens.seed import seed_initial_portfolio
from port_risk_lens.storage import SupabaseStore
from port_risk_lens.universe import FileUniverseSource, SupabaseUniverseSource, source_from_environment


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(prog="port-risk-lens")
    subcommands = command.add_subparsers(dest="command", required=True)
    refresh_command = subcommands.add_parser("refresh", help="Fetch prices and publish current analytics.")
    refresh_command.add_argument("--seed-portfolio", action="store_true", help="Seed the initial signed quantities after refresh.")
    subcommands.add_parser("validate-universe", help="Validate and count the configured active universe.")
    compare = subcommands.add_parser("compare-universe", help="Compare the project CSV with Supabase before cutover.")
    compare.add_argument("--file", default="config/initial_universe.csv")
    return command


def main() -> None:
    args = parser().parse_args()
    if args.command == "validate-universe":
        securities = source_from_environment().load_active()
        print(json.dumps({"count": len(securities), "tickers": [security.ticker for security in securities]}, indent=2))
        return
    if args.command == "compare-universe":
        file_tickers = {security.ticker for security in FileUniverseSource(Path(args.file)).load_active()}
        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        database_tickers = {security.ticker for security in SupabaseUniverseSource(client).load_active()}
        result = {
            "matches": file_tickers == database_tickers,
            "only_in_file": sorted(file_tickers - database_tickers),
            "only_in_supabase": sorted(database_tickers - file_tickers),
        }
        print(json.dumps(result, indent=2))
        if not result["matches"]:
            raise SystemExit(1)
        return

    store = SupabaseStore()
    result = refresh(store=store)
    if args.seed_portfolio:
        owner_id = os.environ["PORTFOLIO_OWNER_ID"]
        result["portfolio_id"] = seed_initial_portfolio(store, owner_id)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
