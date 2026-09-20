import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BENCHMARKS, LOOKBACKS, type Benchmark, type LookbackDays, type PriceSource } from "@/lib/types";

const TICKER_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const SNAPSHOT_SCHEMA_VERSION = 1;

type PositionInput = {
  ticker?: string;
  signedQuantity?: number;
  manualPriceFallback?: number | null;
  priceSource?: PriceSource;
  sessionPrice?: number;
  priceDate?: string | null;
  pipelineRunId?: string | null;
  betaFallbacks?: Array<{ benchmark?: Benchmark; lookbackDays?: LookbackDays; beta?: number }>;
};

type SnapshotBody = {
  baseSnapshotId?: string | null;
  cash?: number;
  positions?: PositionInput[];
};

export async function POST(request: NextRequest) {
  const supabase = createAdminClient();

  const body = await request.json().catch(() => ({})) as SnapshotBody;
  if (!Number.isFinite(body.cash) || !Array.isArray(body.positions)) {
    return NextResponse.json({ error: "Cash and positions are required." }, { status: 400 });
  }

  const normalized = body.positions.map((position) => ({
    ...position,
    ticker: String(position.ticker ?? "").trim().toUpperCase(),
    signedQuantity: Number(position.signedQuantity),
    manualPriceFallback: position.manualPriceFallback === null || position.manualPriceFallback === undefined
      ? null
      : Number(position.manualPriceFallback),
    sessionPrice: Number(position.sessionPrice),
  }));
  const unique = new Set(normalized.map((position) => position.ticker));
  if (unique.size !== normalized.length || normalized.some((position) => (
    !TICKER_PATTERN.test(position.ticker)
    || !Number.isFinite(position.signedQuantity)
    || position.signedQuantity === 0
    || (position.manualPriceFallback !== null && (!Number.isFinite(position.manualPriceFallback) || position.manualPriceFallback <= 0))
    || !["pipeline", "manual", "default"].includes(String(position.priceSource))
  ))) {
    return NextResponse.json({ error: "Every position needs a unique valid ticker and non-zero signed quantity." }, { status: 400 });
  }

  const databasePositions: Array<Record<string, string | number | null>> = [];
  const betaOverrides: Array<Record<string, string | number>> = [];
  for (const position of normalized) {
    let valuationPrice = 0;
    let priceDate: string | null = null;
    let pipelineRunId: string | null = null;
    if (position.priceSource === "pipeline") {
      if (!position.priceDate || !position.pipelineRunId || !Number.isFinite(position.sessionPrice) || position.sessionPrice <= 0) {
        return NextResponse.json({ error: `The reviewed pipeline price for ${position.ticker} is incomplete.` }, { status: 400 });
      }
      const { data: referencedPrice, error: priceError } = await supabase
        .from("daily_price_versions")
        .select("ticker,price_date,raw_close,pipeline_run_id")
        .eq("ticker", position.ticker)
        .eq("price_date", position.priceDate)
        .eq("pipeline_run_id", position.pipelineRunId)
        .maybeSingle();
      if (priceError) return NextResponse.json({ error: priceError.message }, { status: 400 });
      if (!referencedPrice || Number(referencedPrice.raw_close) !== position.sessionPrice) {
        return NextResponse.json({ error: `The reviewed pipeline price for ${position.ticker} could not be verified.` }, { status: 400 });
      }
      valuationPrice = Number(referencedPrice.raw_close);
      priceDate = referencedPrice.price_date;
      pipelineRunId = referencedPrice.pipeline_run_id;
    } else if (position.priceSource === "manual") {
      if (position.manualPriceFallback === null) {
        return NextResponse.json({ error: `${position.ticker} needs a positive manual fallback price.` }, { status: 400 });
      }
      valuationPrice = position.manualPriceFallback;
    }

    for (const fallback of position.betaFallbacks ?? []) {
      const beta = Number(fallback.beta);
      if (!BENCHMARKS.includes(fallback.benchmark as Benchmark) || !LOOKBACKS.includes(fallback.lookbackDays as LookbackDays) || !Number.isFinite(beta)) {
        return NextResponse.json({ error: `A beta fallback for ${position.ticker} is invalid.` }, { status: 400 });
      }
      betaOverrides.push({
        ticker: position.ticker,
        benchmark: fallback.benchmark as Benchmark,
        lookback_days: fallback.lookbackDays as LookbackDays,
        beta,
      });
    }

    databasePositions.push({
      ticker: position.ticker,
      signed_quantity: position.signedQuantity,
      manual_price_fallback: position.manualPriceFallback,
      valuation_price: valuationPrice,
      price_source: position.priceSource ?? "default",
      price_date: priceDate,
      pipeline_run_id: pipelineRunId,
    });
  }

  const appVersion = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local";
  const { data, error } = await supabase.rpc("create_shared_portfolio_snapshot", {
    p_base_snapshot_id: body.baseSnapshotId ?? null,
    p_cash: Number(body.cash),
    p_positions: databasePositions,
    p_beta_overrides: betaOverrides,
    p_schema_version: SNAPSHOT_SCHEMA_VERSION,
    p_app_version: appVersion,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  const result = data as {
    conflict?: boolean;
    latestSnapshotId?: string | null;
    latestSavedAt?: string | null;
    snapshotId?: string;
    savedAt?: string;
    navAtSave?: number;
    valuationIncomplete?: boolean;
  };
  if (result.conflict) {
    return NextResponse.json({
      error: "Portfolio changed in another session. Reload before saving.",
      latestSnapshotId: result.latestSnapshotId,
      latestSavedAt: result.latestSavedAt,
    }, { status: 409 });
  }
  return NextResponse.json(result, { status: 201 });
}
