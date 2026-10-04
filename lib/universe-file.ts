import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const SYMBOL_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const RESERVED = new Set(["LONG", "SHORT", "TICKER", "SYMBOL"]);

export type UniverseRecord = {
  ticker: string;
  active: boolean;
  supportStatus: "requested" | "supported" | "declined";
};

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

/**
 * Load the support lifecycle for the dashboard. The CSV is deliberately
 * treated as an all-supported baseline; Supabase carries pending requests.
 */
export async function loadUniverse(supabase?: SupabaseClient): Promise<UniverseRecord[]> {
  const source = (process.env.UNIVERSE_SOURCE ?? "file").trim().toLowerCase();
  if (source === "file") {
    return (await loadFileUniverse()).map((ticker) => ({ ticker, active: true, supportStatus: "supported" as const }));
  }
  if (source === "supabase") {
    if (!supabase) throw new Error("A Supabase client is required for UNIVERSE_SOURCE=supabase.");
    const { data, error } = await supabase
      .from("security_universe")
      .select("ticker,active,support_status")
      .order("ticker");
    if (error) throw error;
    const records = (data ?? []).map((row) => {
      const ticker = String(row.ticker).trim().toUpperCase();
      const supportStatus = row.support_status === "requested" || row.support_status === "declined"
        ? row.support_status
        : "supported";
      return { ticker, active: Boolean(row.active), supportStatus } as UniverseRecord;
    });
    if (records.some(({ ticker }) => RESERVED.has(ticker) || !SYMBOL_PATTERN.test(ticker)) || new Set(records.map(({ ticker }) => ticker)).size !== records.length) {
      throw new Error("Supabase universe contains an invalid or duplicate ticker.");
    }
    return records;
  }
  throw new Error("UNIVERSE_SOURCE must be exactly 'file' or 'supabase'.");
}

export async function loadActiveUniverse(supabase?: SupabaseClient): Promise<string[]> {
  const records = await loadUniverse(supabase);
  return records.filter((record) => record.active && record.supportStatus === "supported").map((record) => record.ticker);
}
