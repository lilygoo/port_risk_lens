"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { BENCHMARKS, LOOKBACKS, type Benchmark, type LookbackDays, type PortfolioData } from "@/lib/types";

const TICKER_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;

function currency(value: number, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value);
}

function fallbackKey(benchmark: Benchmark, lookback: LookbackDays) {
  return `${benchmark}-${lookback}`;
}

type DraftPosition = {
  ticker: string;
  quantity: string;
  lastValidQuantity: number;
  initialQuantity: number;
  sessionPrice: number;
  pipelinePriceActive: boolean;
  priceDate: string | null;
  pipelineRunId: string | null;
  manualPriceFallback: string;
  initialManualPriceFallback: number | null;
  betaFallbacks: Record<string, string>;
  isNew: boolean;
};

function createDraft(portfolio: PortfolioData): DraftPosition[] {
  return portfolio.positions.map((position) => ({
    ticker: position.ticker,
    quantity: String(position.quantity),
    lastValidQuantity: position.quantity,
    initialQuantity: position.quantity,
    sessionPrice: position.price,
    pipelinePriceActive: position.priceSource === "pipeline",
    priceDate: position.priceDate,
    pipelineRunId: position.pipelineRunId,
    manualPriceFallback: position.manualPriceFallback === null ? "" : String(position.manualPriceFallback),
    initialManualPriceFallback: position.manualPriceFallback,
    betaFallbacks: Object.fromEntries(position.betaFallbacks.map((fallback) => [
      fallbackKey(fallback.benchmark, fallback.lookbackDays), String(fallback.beta),
    ])),
    isNew: false,
  }));
}

function manualFallback(position: DraftPosition) {
  const value = Number(position.manualPriceFallback);
  return position.manualPriceFallback !== "" && Number.isFinite(value) && value > 0 ? value : null;
}

function valuationPrice(position: DraftPosition) {
  if (position.pipelinePriceActive) return position.sessionPrice;
  return manualFallback(position) ?? 0;
}

type ReviewChange = {
  ticker: string;
  from: number;
  to: number;
  tradeBasis: number;
  cashImpactNotional: number;
  cashChange: number;
  valuationPrice: number;
};

export function PortfolioEditor({
  portfolio, canSave, onCancel, onSaved,
}: {
  portfolio: PortfolioData;
  canSave: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [positions, setPositions] = useState(() => createDraft(portfolio));
  const [cash, setCash] = useState(String(portfolio.cash));
  const [automaticCashAdjustment, setAutomaticCashAdjustment] = useState(0);
  const [cashManuallyEdited, setCashManuallyEdited] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [message, setMessage] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const supportedByTicker = useMemo(() => new Map(portfolio.supportedSecurities.map((security) => [security.ticker, security])), [portfolio.supportedSecurities]);
  const originalByTicker = useMemo(() => new Map(portfolio.positions.map((position) => [position.ticker, position])), [portfolio.positions]);
  const cashValue = Number(cash);

  function applyCashDelta(delta: number) {
    if (!Number.isFinite(delta)) return;
    const currentCash = Number(cash);
    setCash(String((Number.isFinite(currentCash) ? currentCash : portfolio.cash) + delta));
    setAutomaticCashAdjustment((current) => current + delta);
  }

  function updateQuantity(ticker: string, nextText: string) {
    const position = positions.find((item) => item.ticker === ticker);
    if (!position) return;
    const next = Number(nextText);
    if (Number.isFinite(next)) applyCashDelta(-(next - position.lastValidQuantity) * position.sessionPrice);
    setPositions((current) => current.map((item) => item.ticker === ticker
      ? { ...item, quantity: nextText, lastValidQuantity: Number.isFinite(next) ? next : item.lastValidQuantity }
      : item));
  }

  function updateTargetValue(ticker: string, valueText: string) {
    const position = positions.find((item) => item.ticker === ticker);
    if (!position) return;
    const price = valuationPrice(position);
    const target = Number(valueText);
    if (price <= 0 || !Number.isFinite(target)) return;
    updateQuantity(ticker, String(Number((target / price).toFixed(6))));
  }

  function updateManualPrice(ticker: string, value: string) {
    setPositions((current) => current.map((position) => {
      if (position.ticker !== ticker) return position;
      const parsed = Number(value);
      const canEstablishNewBasis = position.isNew && !position.pipelinePriceActive
        && position.sessionPrice === 0 && position.lastValidQuantity === 0 && Number.isFinite(parsed) && parsed > 0;
      return { ...position, manualPriceFallback: value, sessionPrice: canEstablishNewBasis ? parsed : position.sessionPrice };
    }));
  }

  function addPosition() {
    const ticker = newTicker.trim().toUpperCase();
    if (!TICKER_PATTERN.test(ticker)) {
      setMessage("Enter a valid ticker such as NVDA or 005930.KS.");
      return;
    }
    if (positions.some((position) => position.ticker === ticker)) {
      setMessage(`${ticker} is already in the draft.`);
      return;
    }
    const supported = supportedByTicker.get(ticker);
    const pipelinePrice = supported?.latestPrice ?? 0;
    setPositions((current) => [...current, {
      ticker,
      quantity: "0",
      lastValidQuantity: 0,
      initialQuantity: 0,
      sessionPrice: pipelinePrice,
      pipelinePriceActive: pipelinePrice > 0,
      priceDate: supported?.priceDate ?? null,
      pipelineRunId: supported?.pipelineRunId ?? null,
      manualPriceFallback: "",
      initialManualPriceFallback: null,
      betaFallbacks: {},
      isNew: true,
    }]);
    setNewTicker("");
    setMessage("");
  }

  function removePosition(ticker: string) {
    const position = positions.find((item) => item.ticker === ticker);
    if (!position) return;
    applyCashDelta(position.lastValidQuantity * position.sessionPrice);
    setPositions((current) => current.filter((item) => item.ticker !== ticker));
  }

  function validateDraft() {
    if (!Number.isFinite(cashValue)) return "Cash must be a valid number.";
    for (const position of positions) {
      if (!Number.isFinite(position.lastValidQuantity)) return `${position.ticker} needs a valid quantity.`;
      const fallback = Number(position.manualPriceFallback);
      if (position.manualPriceFallback !== "" && (!Number.isFinite(fallback) || fallback <= 0)) {
        return `${position.ticker} manual fallback price must be positive or blank.`;
      }
      for (const value of Object.values(position.betaFallbacks)) {
        if (value !== "" && !Number.isFinite(Number(value))) return `${position.ticker} has an invalid beta fallback.`;
      }
    }
    const savedPositions = positions.filter((position) => position.lastValidQuantity !== 0);
    const nav = cashValue + savedPositions.reduce((sum, position) => sum + position.lastValidQuantity * valuationPrice(position), 0);
    if (nav <= 0) return "Derived NAV must be positive before this snapshot can be saved.";
    return null;
  }

  function openReview() {
    const error = validateDraft();
    if (error) {
      setMessage(error);
      return;
    }
    setMessage("");
    setReviewOpen(true);
  }

  const reviewChanges: ReviewChange[] = useMemo(() => {
    const draftByTicker = new Map(positions.map((position) => [position.ticker, position]));
    const tickers = new Set([...originalByTicker.keys(), ...draftByTicker.keys()]);
    return [...tickers].sort().flatMap((ticker) => {
      const original = originalByTicker.get(ticker);
      const draft = draftByTicker.get(ticker);
      const from = original?.quantity ?? 0;
      const to = draft?.lastValidQuantity ?? 0;
      const fallbackChanged = (draft ? manualFallback(draft) : null) !== (original?.manualPriceFallback ?? null);
      if (Math.abs(from - to) < 0.0000001 && !fallbackChanged) return [];
      const tradeBasis = draft?.sessionPrice ?? original?.price ?? 0;
      const cashImpactNotional = (to - from) * tradeBasis;
      return [{
        ticker, from, to, tradeBasis, cashImpactNotional, cashChange: -cashImpactNotional,
        valuationPrice: draft ? valuationPrice(draft) : tradeBasis,
      }];
    });
  }, [positions, originalByTicker]);

  const betaFallbackChangeCount = useMemo(() => positions.reduce((count, position) => {
    const original = originalByTicker.get(position.ticker);
    const originalFallbacks = new Map((original?.betaFallbacks ?? []).map((fallback) => [
      fallbackKey(fallback.benchmark, fallback.lookbackDays), String(fallback.beta),
    ]));
    return count + BENCHMARKS.reduce((benchmarkCount, benchmark) => benchmarkCount + LOOKBACKS.reduce((lookbackCount, lookback) => {
      const key = fallbackKey(benchmark, lookback);
      return lookbackCount + ((position.betaFallbacks[key] ?? "") !== (originalFallbacks.get(key) ?? "") ? 1 : 0);
    }, 0), 0);
  }, 0), [positions, originalByTicker]);

  const savedPositions = positions.filter((position) => position.lastValidQuantity !== 0);
  const unpriced = savedPositions.filter((position) => valuationPrice(position) === 0).map((position) => position.ticker);
  const navAtSave = Number.isFinite(cashValue)
    ? cashValue + savedPositions.reduce((sum, position) => sum + position.lastValidQuantity * valuationPrice(position), 0)
    : Number.NaN;
  const manualCashCorrection = Number.isFinite(cashValue) ? cashValue - portfolio.cash - automaticCashAdjustment : 0;
  const cashBasisLabel = cashManuallyEdited
    ? "Manual baseline + derived adjustments"
    : Math.abs(automaticCashAdjustment) > 0.000001 ? "Derived from quantity changes" : "Unchanged";

  async function confirmSave() {
    if (!canSave) {
      setReviewOpen(false);
      setMessage("Configure Supabase to save snapshots. The review flow is available locally for UI testing.");
      return;
    }
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/portfolio/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseSnapshotId: portfolio.snapshotId,
        cash: cashValue,
        positions: savedPositions.map((position) => ({
          ticker: position.ticker,
          signedQuantity: position.lastValidQuantity,
          manualPriceFallback: manualFallback(position),
          priceSource: position.pipelinePriceActive ? "pipeline" : valuationPrice(position) > 0 ? "manual" : "default",
          sessionPrice: position.sessionPrice,
          priceDate: position.priceDate,
          pipelineRunId: position.pipelineRunId,
          betaFallbacks: BENCHMARKS.flatMap((benchmark) => LOOKBACKS.flatMap((lookbackDays) => {
            const value = position.betaFallbacks[fallbackKey(benchmark, lookbackDays)] ?? "";
            return value === "" ? [] : [{ benchmark, lookbackDays, beta: Number(value) }];
          })),
        })),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setReviewOpen(false);
      const conflict = response.status === 409 && body.latestSavedAt
        ? ` Latest save: ${new Date(body.latestSavedAt).toLocaleString()}.`
        : "";
      setMessage(`${body.error ?? "Snapshot could not be saved."}${conflict}`);
      return;
    }
    setReviewOpen(false);
    onSaved();
    router.refresh();
  }

  return (
    <section className="panel snapshot-editor" aria-labelledby="editor-title">
      <div className="editor-toolbar">
        <div>
          <p className="eyebrow">EDIT SESSION</p>
          <h2 id="editor-title">Prepare the next portfolio snapshot</h2>
          <p>Prices are frozen for this edit. Quantity changes adjust cash; price changes only revalue the portfolio.</p>
        </div>
        <button className="text-button" type="button" onClick={onCancel}><X size={14} />Cancel</button>
      </div>

      <div className="editor-cash-row">
        <label><span>Cash (USD)</span><input type="number" step="0.01" value={cash} onChange={(event) => { setCash(event.target.value); setCashManuallyEdited(true); }} /></label>
        <div><span>Cash basis</span><strong>{cashBasisLabel}</strong><small>{currency(automaticCashAdjustment)} automatic adjustment</small></div>
        <div><span>Draft NAV</span><strong>{Number.isFinite(navAtSave) ? currency(navAtSave) : "—"}</strong><small>{unpriced.length ? "Incomplete valuation" : "All positions priced"}</small></div>
      </div>

      <div className="add-position">
        <label className="sr-only" htmlFor="new-ticker">Add ticker</label>
        <input id="new-ticker" list="supported-tickers" value={newTicker} onChange={(event) => setNewTicker(event.target.value.toUpperCase())} placeholder="Ticker, e.g. NVDA" />
        <datalist id="supported-tickers">{portfolio.supportedSecurities.map((security) => <option key={security.ticker} value={security.ticker} />)}</datalist>
        <button type="button" onClick={addPosition}><Plus size={14} />Add position</button>
      </div>

      <div className="snapshot-editor-rows">
        {positions.map((position) => {
          const activeValuationPrice = valuationPrice(position);
          const sourceLabel = position.pipelinePriceActive ? "Pipeline" : activeValuationPrice > 0 ? "Manual fallback" : "Default $0";
          return (
            <article className="snapshot-editor-row" key={position.ticker}>
              <div className="editor-position-heading">
                <div><strong>{position.ticker}</strong><span className={`source-badge source-${position.pipelinePriceActive ? "calculated" : activeValuationPrice > 0 ? "manual" : "default"}`}>{sourceLabel}</span></div>
                <button type="button" aria-label={`Remove ${position.ticker}`} onClick={() => removePosition(position.ticker)}><Trash2 size={15} /></button>
              </div>
              <div className="editor-position-inputs">
                <label><span>Edit-session price</span><input value={currency(position.sessionPrice, 2)} disabled /></label>
                <label><span>Signed quantity</span><input type="number" step="0.000001" value={position.quantity} onChange={(event) => updateQuantity(position.ticker, event.target.value)} /></label>
                <label><span>Target market value</span><input type="number" step="0.01" value={activeValuationPrice > 0 ? String(Number((position.lastValidQuantity * activeValuationPrice).toFixed(2))) : ""} disabled={activeValuationPrice <= 0} onChange={(event) => updateTargetValue(position.ticker, event.target.value)} placeholder={activeValuationPrice <= 0 ? "Add a price first" : ""} /></label>
                <label><span>Manual fallback price</span><input type="number" min="0.00000001" step="0.01" value={position.manualPriceFallback} onChange={(event) => updateManualPrice(position.ticker, event.target.value)} /><small>{position.pipelinePriceActive ? "Stored but inactive while pipeline price exists" : "Used for valuation only"}</small></label>
              </div>
              <details className="beta-fallbacks">
                <summary>Beta fallbacks</summary>
                <p>Pipeline beta is active when available. Blank values use the application default β=1.0.</p>
                <div>{BENCHMARKS.flatMap((benchmark) => LOOKBACKS.map((lookback) => (
                  <label key={`${benchmark}-${lookback}`}><span>{benchmark} · {lookback}D</span><input type="number" step="0.001" value={position.betaFallbacks[fallbackKey(benchmark, lookback)] ?? ""} onChange={(event) => setPositions((current) => current.map((item) => item.ticker === position.ticker ? {
                    ...item, betaFallbacks: { ...item.betaFallbacks, [fallbackKey(benchmark, lookback)]: event.target.value },
                  } : item))} placeholder="1.000" /></label>
                )))}</div>
              </details>
            </article>
          );
        })}
      </div>

      <footer className="editor-footer">
        <p role="status">{message}</p>
        <button className="primary-button" type="button" onClick={openReview}><Save size={15} />Review snapshot</button>
      </footer>

      {reviewOpen && (
        <div className="dialog-backdrop">
          <section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <div className="review-heading"><div><p className="eyebrow">CONFIRM SNAPSHOT</p><h2 id="review-title">Review portfolio and cash changes</h2></div><button type="button" aria-label="Close review" onClick={() => setReviewOpen(false)}><X size={16} /></button></div>
            {unpriced.length > 0 && <div className="review-warning"><AlertTriangle size={16} /><span><strong>Incomplete valuation</strong>{unpriced.join(", ")} will be saved at the $0 application default.</span></div>}
            {betaFallbackChangeCount > 0 && <div className="review-warning review-information"><span><strong>Beta fallbacks updated</strong>{betaFallbackChangeCount} benchmark/lookback {betaFallbackChangeCount === 1 ? "value" : "values"} will be saved with this snapshot.</span></div>}
            <div className="review-changes">
              {reviewChanges.length === 0 ? <p>No quantity or fallback-price changes.</p> : reviewChanges.map((change) => (
                <div key={change.ticker}>
                  <strong>{change.ticker}</strong>
                  <span>Quantity {change.from.toLocaleString()} → {change.to.toLocaleString()}</span>
                  <span>Trade basis {currency(change.tradeBasis, 2)}</span>
                  <span>Cash-impact notional {currency(change.cashImpactNotional)}</span>
                  <span>Cash change {currency(change.cashChange)}</span>
                  <span>Valuation price {currency(change.valuationPrice, 2)}{change.tradeBasis !== change.valuationPrice ? " · differs from trade basis" : ""}</span>
                </div>
              ))}
            </div>
            <dl className="cash-reconciliation">
              <div><dt>Cash before</dt><dd>{currency(portfolio.cash)}</dd></div>
              <div><dt>Automatic adjustment</dt><dd>{currency(automaticCashAdjustment)}</dd></div>
              <div><dt>Manual correction</dt><dd>{currency(manualCashCorrection)}</dd></div>
              <div><dt>Cash after</dt><dd>{currency(cashValue)}</dd></div>
              <div className="review-nav"><dt>NAV at save</dt><dd>{currency(navAtSave)}</dd></div>
            </dl>
            <div className="review-actions"><button className="secondary-button" type="button" onClick={() => setReviewOpen(false)}>Back to edit</button><button className="primary-button" type="button" disabled={saving} onClick={confirmSave}>{saving ? "Saving…" : "Confirm and save snapshot"}</button></div>
          </section>
        </div>
      )}
    </section>
  );
}
