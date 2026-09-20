import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const SYMBOL_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const RESERVED = new Set(["LONG", "SHORT", "TICKER", "SYMBOL"]);

export async function loadFileUniverse(): Promise<string[]> {
  const filePath = path.join(process.cwd(), "config", "initial_universe.csv");
  const lines = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim().toLowerCase() !== "ticker") throw new Error("Universe CSV must have a Ticker header.");
  const seen = new Set<string>();
  for (const raw of lines.slice(1)) {
    if (!raw.trim()) continue;
    const ticker = raw.trim().toUpperCase();
    if (RESERVED.has(ticker) || !SYMBOL_PATTERN.test(ticker)) throw new Error(`Invalid universe ticker: ${raw}`);
    if (seen.has(ticker)) throw new Error(`Duplicate universe ticker: ${ticker}`);
    seen.add(ticker);
  }
  return [...seen].sort();
}

export async function loadActiveUniverse(supabase?: SupabaseClient): Promise<string[]> {
  const source = (process.env.UNIVERSE_SOURCE ?? "file").trim().toLowerCase();
  if (source === "file") return loadFileUniverse();
  if (source === "supabase") {
    if (!supabase) throw new Error("A Supabase client is required for UNIVERSE_SOURCE=supabase.");
    const { data, error } = await supabase.from("security_universe").select("ticker").eq("active", true).order("ticker");
    if (error) throw error;
    const tickers = (data ?? []).map((row) => String(row.ticker).trim().toUpperCase());
    if (tickers.some((ticker) => RESERVED.has(ticker) || !SYMBOL_PATTERN.test(ticker)) || new Set(tickers).size !== tickers.length) {
      throw new Error("Supabase universe contains an invalid or duplicate ticker.");
    }
    return tickers;
  }
  throw new Error("UNIVERSE_SOURCE must be exactly 'file' or 'supabase'.");
}
