import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const TICKER_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { ticker?: unknown };
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) return NextResponse.json({ error: "Enter a valid ticker." }, { status: 400 });
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("request_shared_ticker_support", { p_ticker: ticker });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
