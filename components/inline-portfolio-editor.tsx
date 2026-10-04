"use client";

import { useMemo, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { BENCHMARKS, LOOKBACKS, type PortfolioData, type Position } from "@/lib/types";
import { deriveNav } from "@/lib/portfolio";

type DraftPosition = Position & { sessionPrice: number };
const TICKER_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const currency = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);

export function InlinePortfolioEditor({ portfolio, canSave, onCancel, onSaved }: { portfolio: PortfolioData; canSave: boolean; onCancel: () => void; onSaved: () => void }) {
  const router = useRouter();
  const [positions, setPositions] = useState<DraftPosition[]>(() => portfolio.positions.map((position) => ({ ...position, sessionPrice: position.price })));
  const [cash, setCash] = useState(portfolio.cash);
  const [newTicker, setNewTicker] = useState("");
  const [message, setMessage] = useState("");
  const [highlightedTicker, setHighlightedTicker] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const nav = deriveNav(positions, cash);
  const supported = useMemo(() => new Map(portfolio.supportedSecurities.map((security) => [security.ticker, security])), [portfolio.supportedSecurities]);

  function changeQuantity(ticker: string, text: string) {
    const next = Number(text);
    if (!Number.isFinite(next)) return;
    const position = positions.find((item) => item.ticker === ticker);
    if (!position) return;
    setCash((currentCash) => currentCash - (next - position.quantity) * position.sessionPrice);
    setPositions((current) => current.map((item) => item.ticker === ticker ? { ...item, quantity: next } : item));
  }
  function changeMarketValue(ticker: string, text: string) {
    const position = positions.find((item) => item.ticker === ticker);
    const target = Number(text);
    if (!position || !Number.isFinite(target) || position.price <= 0) return;
    changeQuantity(ticker, String(Number((target / position.price).toFixed(2))));
  }
  function addPosition() {
    const ticker = newTicker.trim().toUpperCase();
    if (!TICKER_PATTERN.test(ticker)) { setMessage("Enter a valid ticker."); return; }
    if (positions.some((position) => position.ticker === ticker)) {
      setMessage(`${ticker} is already in the portfolio. Its row is highlighted.`);
      setHighlightedTicker(ticker);
      requestAnimationFrame(() => document.getElementById(`edit-row-${ticker}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    const record = supported.get(ticker);
    const price = record?.latestPrice ?? 0;
    setPositions((current) => [...current, {
      ticker, quantity: 0, price, sessionPrice: price, priceSource: price > 0 ? "pipeline" : "default",
      priceDate: record?.priceDate ?? null, pipelineRunId: record?.pipelineRunId ?? null, manualPriceFallback: null,
      supported: Boolean(record), metrics: portfolio.positions[0]?.metrics ?? { beta: {} as Position["metrics"]["beta"], totalVolatility: { 90: null, 180: null, 365: null }, residualVolatility: { 90: null, 180: null, 365: null } },
      betaFallbacks: [],
    }]);
    setNewTicker(""); setHighlightedTicker(ticker); setMessage(`${ticker} was added to the draft. Enter a quantity to include it in this snapshot.`);
    requestAnimationFrame(() => document.getElementById(`edit-row-${ticker}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  function removePosition(ticker: string) {
    const position = positions.find((item) => item.ticker === ticker);
    if (!position) return;
    setCash((current) => current + position.quantity * position.sessionPrice);
    setPositions((current) => current.filter((item) => item.ticker !== ticker));
  }
  async function save() {
    if (!canSave) { setReviewing(false); setMessage("This local preview cannot save a Supabase snapshot."); return; }
    setSaving(true);
    const response = await fetch("/api/portfolio/snapshots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      baseSnapshotId: portfolio.snapshotId, cash, positions: positions.filter((position) => position.quantity !== 0).map((position) => ({
        ticker: position.ticker, signedQuantity: position.quantity, manualPriceFallback: position.manualPriceFallback,
        priceSource: position.priceSource, sessionPrice: position.sessionPrice, priceDate: position.priceDate, pipelineRunId: position.pipelineRunId,
        betaFallbacks: position.betaFallbacks,
      })),
    }) });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setReviewing(false); setMessage(body.error ?? "Snapshot could not be saved."); return; }
    onSaved(); router.refresh();
  }
  return <section className="panel positions-panel inline-editor" aria-label="Edit portfolio">
    <div className="panel-heading">
      <div><h2>Current positions</h2><p>Inline edit mode — prices are frozen; quantity changes adjust cash automatically.</p></div>
      <div className="panel-actions"><input value={newTicker} onChange={(event) => setNewTicker(event.target.value.toUpperCase())} placeholder="Ticker" aria-label="Add ticker" /><button className="secondary-button" type="button" onClick={addPosition}><Plus size={13} />Add ticker</button><button className="text-button" type="button" onClick={onCancel}><X size={13} />Cancel</button><button className="primary-button" type="button" onClick={() => setReviewing(true)}><Save size={14} />Review snapshot</button></div>
    </div>
    {message && <p className="inline-edit-message" role="status">{message}</p>}
    <div className="table-scroll"><table><thead><tr><th>Ticker</th><th>Price</th><th>Quantity</th><th>Market value</th><th>Exposure</th><th>Fallbacks</th><th aria-label="Actions" /></tr></thead><tbody>
      <tr className="portfolio-total"><th>Portfolio total</th><td>—</td><td>—</td><td>{currency(nav)}</td><td>100.00%</td><td>Beta source remains visible after save</td><td /></tr>
      {[...positions].sort((a, b) => Math.abs(b.quantity * b.price) - Math.abs(a.quantity * a.price)).map((position) => <tr key={position.ticker} id={`edit-row-${position.ticker}`} className={highlightedTicker === position.ticker ? "edit-row-highlight" : undefined}><th className="ticker-cell">{position.ticker}{position.quantity === 0 && <small>New · set quantity</small>}</th><td>{currency(position.price)}<small>{position.priceSource === "pipeline" ? "Pipeline" : position.price > 0 ? "Manual fallback" : "Default $0"}</small></td><td><input className="inline-cell-input" type="number" step="0.01" value={position.quantity.toFixed(2)} onChange={(event) => changeQuantity(position.ticker, event.target.value)} /></td><td>{position.price > 0 ? <input className="inline-cell-input" type="number" step="0.01" value={(position.quantity * position.price).toFixed(2)} onChange={(event) => changeMarketValue(position.ticker, event.target.value)} /> : "Add a fallback price"}</td><td>{nav === 0 ? "—" : `${(position.quantity * position.price / nav * 100).toFixed(2)}%`}</td><td><details className="fallback-details"><summary>Price / beta</summary><label>Manual fallback price<input className="inline-cell-input" type="number" min="0" step="0.01" value={position.manualPriceFallback ?? ""} placeholder="Optional" onChange={(event) => { const fallback = event.target.value === "" ? null : Number(event.target.value); setPositions((current) => current.map((item) => item.ticker !== position.ticker ? item : { ...item, manualPriceFallback: fallback, ...(item.priceSource === "pipeline" ? {} : { price: fallback ?? 0, priceSource: fallback && fallback > 0 ? "manual" : "default" }) })); }} /></label><small>{position.priceSource === "pipeline" ? "Pipeline price is active; fallback is retained for later." : "Manual fallback is the active valuation price."}</small><details className="beta-fallbacks"><summary>Beta fallbacks</summary><p>Pipeline beta is active when available; blank values use default β=1.00.</p><div>{BENCHMARKS.flatMap((benchmark) => LOOKBACKS.map((lookbackDays) => { const existing = position.betaFallbacks.find((fallback) => fallback.benchmark === benchmark && fallback.lookbackDays === lookbackDays); return <label key={`${benchmark}-${lookbackDays}`}><span>{benchmark} · {lookbackDays}D</span><input type="number" step="0.01" value={existing?.beta ?? ""} placeholder="1.00" onChange={(event) => { const beta = event.target.value === "" ? null : Number(event.target.value); setPositions((current) => current.map((item) => { if (item.ticker !== position.ticker) return item; const withoutCurrent = item.betaFallbacks.filter((fallback) => fallback.benchmark !== benchmark || fallback.lookbackDays !== lookbackDays); return { ...item, betaFallbacks: beta === null || !Number.isFinite(beta) ? withoutCurrent : [...withoutCurrent, { benchmark, lookbackDays, beta }] }; })); }} /></label>; }))}</div></details></details></td><td><button className="icon-button" type="button" aria-label={`Remove ${position.ticker}`} onClick={() => removePosition(position.ticker)}><Trash2 size={14} /></button></td></tr>)}
      <tr className="cash-row"><th>Cash<small>Beta contribution 0.00</small></th><td>—</td><td>—</td><td><input className="inline-cell-input" type="number" step="0.01" value={cash.toFixed(2)} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) setCash(next); }} /></td><td>{nav === 0 ? "—" : `${(cash / nav * 100).toFixed(2)}%`}</td><td>0.00</td><td /></tr>
    </tbody></table></div>
    {reviewing && <div className="dialog-backdrop"><section className="review-dialog" role="dialog" aria-modal="true"><div className="review-heading"><h2>Review portfolio and cash changes</h2><button type="button" onClick={() => setReviewing(false)}><X size={16} /></button></div><div className="review-changes"><p>Cash after: <strong>{currency(cash)}</strong></p><p>NAV at save: <strong>{currency(nav)}</strong></p><p>Quantity changes use the frozen edit-session price; manual cash remains editable.</p></div><div className="review-actions"><button className="secondary-button" type="button" onClick={() => setReviewing(false)}>Back to edit</button><button className="primary-button" type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Confirm and save snapshot"}</button></div></section></div>}
  </section>;
}
