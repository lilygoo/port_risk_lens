"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, CirclePlus, Pencil, RotateCcw, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { InlinePortfolioEditor } from "@/components/inline-portfolio-editor";
import { applyTrades, betaAggregate, betaContribution, portfolioBeta, positionRows, summarizePortfolio } from "@/lib/portfolio";
import {
  BENCHMARKS, LOOKBACKS, METRICS,
  type Benchmark, type BetaSource, type LookbackDays, type Metric, type PortfolioData, type Position, type Trade,
} from "@/lib/types";

const REPOSITORY_URL = "https://github.com/lilygoo/port_risk_lens";
const metricLabels: Record<Metric, string> = {
  beta: "Beta",
  beta_contribution: "β contribution",
  total_volatility: "Total volatility",
  residual_volatility: "Residual volatility",
};

type MetricColumn = { metric: Metric; lookback: LookbackDays; benchmark?: Benchmark };

function currency(value: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: decimals, minimumFractionDigits: decimals,
  }).format(value);
}

function percent(value: number) { return `${(value * 100).toFixed(2)}%`; }
function number(value: number | null, digits = 2) { return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits); }
function signed(value: number, formatter: (value: number) => string) {
  if (Math.abs(value) < 0.0000001) return formatter(0);
  return `${value > 0 ? "+" : "−"}${formatter(Math.abs(value))}`;
}
function valueAndExposure(value: number, exposure: number) { return `${currency(value)} · ${percent(exposure)}`; }
function valueAndExposureChange(value: number, exposure: number) { return `${signed(value, currency)} · ${signed(exposure, percent)}`; }
function toggleRequired<T>(current: T[], value: T): T[] {
  if (current.includes(value)) return current.length === 1 ? current : current.filter((item) => item !== value);
  return [...current, value];
}

function sourceLabel(source: BetaSource) {
  return source === "calculated" ? "Calculated" : source === "manual" ? "Manual" : "Default β=1";
}

function MetricCell({ position, column, nav }: { position: Position; column: MetricColumn; nav: number }) {
  if ((column.metric === "beta" || column.metric === "beta_contribution") && column.benchmark) {
    const reading = position.metrics.beta[column.benchmark][column.lookback];
    const value = column.metric === "beta" ? reading.value : betaContribution(position, nav, column.benchmark, column.lookback);
    return <span className={`metric-reading metric-${reading.source}`} title={`${sourceLabel(reading.source)} beta`}><strong>{number(value, 2)}</strong>{reading.source !== "calculated" && <small>{sourceLabel(reading.source)}</small>}</span>;
  }
  const value = column.metric === "total_volatility"
    ? position.metrics.totalVolatility[column.lookback]
    : position.metrics.residualVolatility[column.lookback];
  return <>{value === null ? "—" : percent(value)}</>;
}

function SummaryCell({ label, current, simulated, difference, incomplete = false }: { label: string; current: string; simulated: string; difference: string; incomplete?: boolean }) {
  const changeTone = difference.startsWith("+") ? "positive-change" : difference.startsWith("−") ? "negative-change" : "neutral-change";
  return (
    <div className="scenario-stat">
      <span>{label}</span>
      <div className="scenario-values"><strong>{simulated}</strong><small className={changeTone}>{difference}</small></div>
      <em>Current {current}</em>
      {incomplete && <b className="incomplete-label">Incomplete valuation</b>}
    </div>
  );
}

function SupportedTickers({ portfolio, persistent }: { portfolio: PortfolioData; persistent: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [priceFilter, setPriceFilter] = useState<"all" | "available" | "missing">("all");
  const [requestedTicker, setRequestedTicker] = useState("");
  const [localRequests, setLocalRequests] = useState(portfolio.tickerSupportRequests);
  const [message, setMessage] = useState("");
  const rows = persistent ? portfolio.universeSecurities : [
    ...portfolio.universeSecurities,
    ...localRequests.filter((request) => !portfolio.universeSecurities.some((security) => security.ticker === request.ticker)).map((request) => ({
      ticker: request.ticker, latestPrice: null, priceDate: null, pipelineRunId: null, analyticsAsOf: null,
      availableMetricCount: 0, analyticsStatus: "unavailable" as const, supportStatus: "requested" as const, active: false,
    })),
  ].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const statusByTicker = new Map(rows.map((security) => [security.ticker, security.supportStatus]));
  const filtered = rows.filter((security) => (
    security.ticker.includes(query.trim().toUpperCase())
    && (priceFilter === "all" || (priceFilter === "available" ? security.latestPrice !== null : security.latestPrice === null))
  ));

  async function requestTicker() {
    const ticker = requestedTicker.trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(ticker)) { setMessage("Enter a valid ticker."); return; }
    if (statusByTicker.get(ticker) === "supported") { setMessage(`${ticker} is already supported.`); return; }
    if (statusByTicker.get(ticker) === "requested") { setMessage(`${ticker} is already requested.`); return; }
    if (!persistent) {
      setLocalRequests((current) => [...current, { ticker, status: "requested" }]);
      setRequestedTicker(""); setMessage(`${ticker} is now requested in this local preview.`); return;
    }
    const response = await fetch("/api/ticker-support-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker }) });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? `${ticker} is now requested.` : body.error ?? "Ticker request could not be saved.");
    if (response.ok) { setRequestedTicker(""); router.refresh(); }
  }
  return (
    <section className="panel supported-panel" aria-labelledby="supported-title">
      <div className="panel-heading">
        <div><h2 id="supported-title">Supported tickers</h2><p>Symbols included in the scheduled analytics pipeline</p></div>
        <div className="supported-actions"><select value={priceFilter} onChange={(event) => setPriceFilter(event.target.value as "all" | "available" | "missing")} aria-label="Filter by price status"><option value="all">All price statuses</option><option value="available">Price available</option><option value="missing">Price missing</option></select><input value={requestedTicker} onChange={(event) => setRequestedTicker(event.target.value.toUpperCase())} placeholder="Ticker" aria-label="Request a ticker" /><button className="secondary-button" type="button" onClick={requestTicker}>Request ticker</button><label className="search-field"><Search size={15} aria-hidden="true" /><span className="sr-only">Filter supported tickers</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter ticker" /></label></div>
      </div>
      <div className="supported-note">
        <p>Unsupported tickers can still be held using manual or application-default values. “Requested” means the ticker is not yet in the scheduled analytics universe. {message}</p>
      </div>
      <div className="table-scroll">
        <table className="supported-table">
          <thead><tr><th scope="col">Ticker</th><th scope="col">Support status</th><th scope="col">Price status</th><th scope="col">Analytics status</th></tr></thead>
          <tbody>{filtered.map((security) => (
            <tr key={security.ticker}>
              <th scope="row" className="ticker-cell">{security.ticker}</th>
              <td><span className={`status-badge status-${security.supportStatus === "supported" ? "ready" : security.supportStatus === "requested" ? "partial" : "unavailable"}`}>{security.supportStatus === "supported" ? "Supported" : security.supportStatus === "requested" ? "Requested" : "Declined"}</span></td>
              <td><span className={`status-badge ${security.latestPrice === null ? "status-unavailable" : "status-ready"}`}>{security.latestPrice === null ? "Missing" : "Available"}</span></td>
              <td><span className={`status-badge status-${security.analyticsStatus}`}>{security.analyticsStatus === "ready" ? "Ready" : security.analyticsStatus === "partial" ? `Partial · ${security.availableMetricCount}/15` : "Unavailable · 0/15"}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export function Dashboard({
  initialPortfolio, persistent = false, activeTab = "positions", initialEdit = false,
}: {
  initialPortfolio: PortfolioData;
  persistent?: boolean;
  activeTab?: "positions" | "supported";
  initialEdit?: boolean;
}) {
  const scenarioTickers = useMemo(() => initialPortfolio.positions.filter((position) => position.price > 0).map((position) => position.ticker).sort(), [initialPortfolio.positions]);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>(["SPY", "QQQ"]);
  const [lookbacks, setLookbacks] = useState<LookbackDays[]>([90, 365]);
  const [metrics, setMetrics] = useState<Metric[]>(["beta", "beta_contribution"]);
  const [query, setQuery] = useState("");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ticker, setTicker] = useState(scenarioTickers[0] ?? "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [notional, setNotional] = useState("25000");
  const [editing, setEditing] = useState(initialEdit);

  const columns = useMemo<MetricColumn[]>(() => {
    const selected: MetricColumn[] = [];
    for (const metric of metrics) {
      for (const lookback of lookbacks) {
        if (metric === "beta" || metric === "beta_contribution") {
          for (const benchmark of benchmarks) selected.push({ metric, lookback, benchmark });
        } else selected.push({ metric, lookback });
      }
    }
    return selected;
  }, [benchmarks, lookbacks, metrics]);

  const baseRows = useMemo(() => positionRows(initialPortfolio.positions, initialPortfolio.nav).sort((a, b) => {
    if (a.marketValue >= 0 && b.marketValue < 0) return -1;
    if (a.marketValue < 0 && b.marketValue >= 0) return 1;
    return Math.abs(b.marketValue) - Math.abs(a.marketValue);
  }), [initialPortfolio]);
  const filteredRows = baseRows.filter((row) => row.ticker.includes(query.trim().toUpperCase()));
  const currentSummary = summarizePortfolio(initialPortfolio.positions, initialPortfolio.nav, initialPortfolio.cash);
  const simulatedPortfolio = applyTrades(initialPortfolio, trades);
  const simulatedSummary = summarizePortfolio(simulatedPortfolio.positions, simulatedPortfolio.nav, simulatedPortfolio.cash);

  function addTrade(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number(notional);
    if (!ticker || !Number.isFinite(parsed) || parsed <= 0) return;
    setTrades((current) => [...current, { id: crypto.randomUUID(), ticker, side, notional: parsed }]);
  }

  const asOf = new Date(`${initialPortfolio.asOf}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const pricedCount = initialPortfolio.positions.length - initialPortfolio.unpricedTickers.length;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">PORTFOLIO / RISK</p><h1>Portfolio Risk Lens</h1></div>
        <div className="header-actions">
          <a className="header-link" href={`${REPOSITORY_URL}/issues/new?template=feature-request.yml`} target="_blank" rel="noreferrer">Send feedback</a>
          <div className="as-of"><span aria-hidden="true" />Prices as of {asOf}</div>
        </div>
      </header>

      <nav className="dashboard-tabs" aria-label="Dashboard sections">
        <Link className={activeTab === "positions" ? "active" : ""} href="/?tab=positions">Current positions</Link>
        <Link className={activeTab === "supported" ? "active" : ""} href="/?tab=supported">Supported tickers</Link>
      </nav>

      {activeTab === "supported" ? <SupportedTickers portfolio={initialPortfolio} persistent={persistent} /> : <>
        {editing ? <InlinePortfolioEditor portfolio={initialPortfolio} canSave={persistent} onCancel={() => setEditing(false)} onSaved={() => { setTrades([]); setEditing(false); }} /> : <section className="panel positions-panel" aria-labelledby="positions-title">
          <div className="panel-heading">
            <div><h2 id="positions-title">Current positions</h2><p>Signed exposure and single-name risk metrics</p></div>
            <div className="panel-actions">
              {!editing && <button className="secondary-button" type="button" onClick={() => setEditing(true)}><Pencil size={13} />Edit portfolio</button>}
              <label className="search-field"><Search size={15} aria-hidden="true" /><span className="sr-only">Filter positions</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter ticker" /></label>
            </div>
          </div>

          <div className="quality-strip">
            <div><span>Valuation completeness</span><strong>{pricedCount} / {initialPortfolio.positions.length} positions priced</strong>{initialPortfolio.unpricedTickers.length > 0 && <small>Unpriced: {initialPortfolio.unpricedTickers.join(", ")}</small>}</div>
            <div><span>Snapshot</span><strong>{initialPortfolio.snapshotSavedAt ? new Date(initialPortfolio.snapshotSavedAt).toLocaleString() : "Local preview"}</strong><small>NAV at save {currency(initialPortfolio.navAtSave)}</small></div>
            {initialPortfolio.valuationIncomplete && <div className="quality-warning"><AlertTriangle size={15} /><strong>Incomplete valuation</strong><small>NAV-dependent metrics exclude unpriced holdings.</small></div>}
          </div>

          <div className="risk-controls">
            <fieldset><legend>Benchmark</legend><div className="chip-row">{BENCHMARKS.map((benchmark) => <label className="toggle-chip" key={benchmark}><input type="checkbox" checked={benchmarks.includes(benchmark)} onChange={() => setBenchmarks(toggleRequired(benchmarks, benchmark))} /><span>{benchmark}</span></label>)}</div></fieldset>
            <fieldset><legend>Lookback</legend><div className="chip-row">{LOOKBACKS.map((lookback) => <label className="toggle-chip" key={lookback}><input type="checkbox" checked={lookbacks.includes(lookback)} onChange={() => setLookbacks(toggleRequired(lookbacks, lookback))} /><span>{lookback}D</span></label>)}</div></fieldset>
            <fieldset className="metric-fieldset"><legend>Metric</legend><div className="chip-row">{METRICS.map((metric) => <label className="toggle-chip" key={metric}><input type="checkbox" checked={metrics.includes(metric)} onChange={() => setMetrics(toggleRequired(metrics, metric))} /><span>{metricLabels[metric]}</span></label>)}</div></fieldset>
            <div className="column-count">{columns.length} risk columns</div>
          </div>

          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Ticker</th><th scope="col">Price</th><th scope="col">Quantity</th><th scope="col">Market value</th><th scope="col">Exposure</th>{columns.map((column) => <th key={`${column.metric}-${column.benchmark ?? "standalone"}-${column.lookback}`} scope="col">{metricLabels[column.metric]}<small>{column.benchmark ? `${column.benchmark} · ` : ""}{column.lookback}D</small></th>)}</tr></thead>
              <tbody>
                <tr className="portfolio-total">
                  <th scope="row">Portfolio total<small>{initialPortfolio.positions.length} positions{initialPortfolio.valuationIncomplete ? " · incomplete" : ""}</small></th>
                  <td>—</td><td>—</td><td>{currency(initialPortfolio.nav)}</td><td>100.00%</td>
                  {columns.map((column) => {
                    if (!column.benchmark || (column.metric !== "beta" && column.metric !== "beta_contribution")) return <td key={`${column.metric}-${column.benchmark ?? "standalone"}-${column.lookback}`}>—</td>;
                    const aggregate = betaAggregate(initialPortfolio.positions, initialPortfolio.nav, column.benchmark, column.lookback);
                    return <td key={`${column.metric}-${column.benchmark}-${column.lookback}`}><span className={`metric-reading aggregate-${aggregate.status}`} title={`Calculated ${percent(aggregate.coverage.calculated)} · Manual ${percent(aggregate.coverage.manual)} · Default ${percent(aggregate.coverage.default)}`}><strong>{number(aggregate.value, 2)}</strong><small>{aggregate.status === "calculated" ? "Calculated" : aggregate.status === "manual-assisted" ? "Manual-assisted" : "Default-assisted"}{initialPortfolio.valuationIncomplete ? " · incomplete" : ""}</small></span></td>;
                  })}
                </tr>
                {filteredRows.map((position) => (
                  <tr key={position.ticker} className={position.price === 0 ? "unpriced-row" : ""}>
                    <th scope="row" className="ticker-cell">{position.ticker}{!position.supported && <small>Unsupported</small>}</th>
                    <td><span className={`price-reading price-${position.priceSource}`}>{currency(position.price, 2)}{position.priceSource !== "pipeline" && <small>{position.priceSource === "manual" ? "Manual fallback" : "Default $0"}</small>}</span></td>
                    <td>{position.quantity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={position.marketValue < 0 ? "negative" : ""}>{currency(position.marketValue)}</td>
                    <td className={position.exposure < 0 ? "negative" : ""}>{percent(position.exposure)}</td>
                    {columns.map((column) => <td key={`${column.metric}-${column.benchmark ?? "standalone"}-${column.lookback}`}><MetricCell position={position} column={column} nav={initialPortfolio.nav} /></td>)}
                  </tr>
                ))}
                <tr className="cash-row"><th scope="row">Cash<small>Beta contribution 0.00</small></th><td>—</td><td>—</td><td>{currency(initialPortfolio.cash)}</td><td>{percent(currentSummary.cashExposure)}</td>{columns.map((column) => <td key={`${column.metric}-${column.benchmark ?? "standalone"}-${column.lookback}`}>{column.metric === "beta" || column.metric === "beta_contribution" ? "0.00" : "—"}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </section>}

        <section className="scenario-section" aria-labelledby="scenario-title">
          <div className="section-heading"><div><h2 id="scenario-title">Scenario simulator</h2><p>Stage hypothetical trades without changing the saved portfolio.</p></div><button className="text-button danger-button" type="button" onClick={() => setTrades([])} disabled={!trades.length}><RotateCcw size={14} aria-hidden="true" /> Reset scenario</button></div>
          <div className="scenario-grid">
            <div className="panel trade-panel">
              <form className="trade-form" onSubmit={addTrade}>
                <label><span>Ticker</span><div className="select-wrap"><select value={ticker} onChange={(event) => setTicker(event.target.value)} disabled={!scenarioTickers.length}>{scenarioTickers.map((symbol) => <option key={symbol}>{symbol}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></div></label>
                <label><span>Action</span><div className="select-wrap"><select value={side} onChange={(event) => setSide(event.target.value as "buy" | "sell")}><option value="buy">Buy</option><option value="sell">Sell</option></select><ChevronDown size={14} aria-hidden="true" /></div></label>
                <label><span>Notional (USD) · $100 increments</span><input type="number" min="100" step="100" value={notional} onChange={(event) => setNotional(event.target.value)} /></label>
                <button className="primary-button" type="submit" disabled={!scenarioTickers.length}><CirclePlus size={16} aria-hidden="true" />Add trade</button>
              </form>
              <div className="staged-trades"><div className="subheading"><h3>Staged trades</h3><span>{trades.length}</span></div>{trades.length === 0 ? <p className="empty-state">No hypothetical trades added.</p> : <ul>{trades.map((trade) => <li key={trade.id}><div><strong className={trade.side}>{trade.side.toUpperCase()} {trade.ticker}</strong><span>{currency(trade.notional)} notional</span></div><button type="button" aria-label={`Remove ${trade.side} ${trade.ticker}`} onClick={() => setTrades((current) => current.filter((item) => item.id !== trade.id))}><Trash2 size={15} aria-hidden="true" /></button></li>)}</ul>}</div>
            </div>
            <div className="panel result-panel">
              <div className="result-heading"><div><span>Scenario result</span><strong>{trades.length ? `${trades.length} staged ${trades.length === 1 ? "trade" : "trades"}` : "Current portfolio"}</strong></div>{simulatedPortfolio.cash < 0 && <div className="financing-flag">Negative cash uses hypothetical financing</div>}</div>
              <div className="scenario-stats">
                <SummaryCell label="Long" current={valueAndExposure(currentSummary.longMarketValue, currentSummary.longExposure)} simulated={valueAndExposure(simulatedSummary.longMarketValue, simulatedSummary.longExposure)} difference={valueAndExposureChange(simulatedSummary.longMarketValue - currentSummary.longMarketValue, simulatedSummary.longExposure - currentSummary.longExposure)} incomplete={initialPortfolio.valuationIncomplete} />
                <SummaryCell label="Short" current={valueAndExposure(currentSummary.shortMarketValue, currentSummary.shortExposure)} simulated={valueAndExposure(simulatedSummary.shortMarketValue, simulatedSummary.shortExposure)} difference={valueAndExposureChange(simulatedSummary.shortMarketValue - currentSummary.shortMarketValue, simulatedSummary.shortExposure - currentSummary.shortExposure)} incomplete={initialPortfolio.valuationIncomplete} />
                <SummaryCell label="Gross / leverage" current={valueAndExposure(currentSummary.grossMarketValue, currentSummary.grossLeverage)} simulated={valueAndExposure(simulatedSummary.grossMarketValue, simulatedSummary.grossLeverage)} difference={valueAndExposureChange(simulatedSummary.grossMarketValue - currentSummary.grossMarketValue, simulatedSummary.grossLeverage - currentSummary.grossLeverage)} incomplete={initialPortfolio.valuationIncomplete} />
                <SummaryCell label="Net" current={valueAndExposure(currentSummary.netMarketValue, currentSummary.netExposure)} simulated={valueAndExposure(simulatedSummary.netMarketValue, simulatedSummary.netExposure)} difference={valueAndExposureChange(simulatedSummary.netMarketValue - currentSummary.netMarketValue, simulatedSummary.netExposure - currentSummary.netExposure)} incomplete={initialPortfolio.valuationIncomplete} />
                <SummaryCell label="Cash" current={valueAndExposure(currentSummary.cash, currentSummary.cashExposure)} simulated={valueAndExposure(simulatedSummary.cash, simulatedSummary.cashExposure)} difference={valueAndExposureChange(simulatedSummary.cash - currentSummary.cash, simulatedSummary.cashExposure - currentSummary.cashExposure)} incomplete={initialPortfolio.valuationIncomplete} />
                {benchmarks.flatMap((benchmark) => lookbacks.map((lookback) => {
                  const current = portfolioBeta(initialPortfolio.positions, initialPortfolio.nav, benchmark, lookback);
                  const simulated = portfolioBeta(simulatedPortfolio.positions, simulatedPortfolio.nav, benchmark, lookback);
                  const difference = current === null || simulated === null ? null : simulated - current;
                  return <SummaryCell key={`${benchmark}-${lookback}`} label={`${benchmark} beta · ${lookback}D`} current={number(current, 3)} simulated={number(simulated, 3)} difference={difference === null ? "—" : signed(difference, (value) => value.toFixed(3))} incomplete={initialPortfolio.valuationIncomplete} />;
                }))}
              </div>
            </div>
          </div>
        </section>
      </>}
    </main>
  );
}
