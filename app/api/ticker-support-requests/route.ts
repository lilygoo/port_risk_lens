import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadActiveUniverse } from "@/lib/universe-file";

const TICKER_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { ticker?: unknown };
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) return NextResponse.json({ error: "Enter a valid ticker." }, { status: 400 });
  try {
    if ((await loadActiveUniverse(supabase)).includes(ticker)) {
      return NextResponse.json({ ticker, status: "added", alreadySupported: true }, { status: 200 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not validate the active universe." }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("request_ticker_support", { p_ticker: ticker });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data, { status: 201 });
}
