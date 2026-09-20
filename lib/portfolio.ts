import type {
  Benchmark, BetaAggregate, BetaSource, LookbackDays, PortfolioData, PortfolioSummary, Position, PositionRow, Trade,
} from "@/lib/types";

export function deriveNav(positions: Position[], cash: number) {
  return cash + positions.reduce((sum, position) => sum + position.quantity * position.price, 0);
}

export function unpricedTickers(positions: Position[]) {
  return positions.filter((position) => position.quantity !== 0 && position.price === 0).map((position) => position.ticker).sort();
}

export function positionRows(positions: Position[], nav: number): PositionRow[] {
  return positions.map((position) => {
    const marketValue = position.quantity * position.price;
    return { ...position, marketValue, exposure: nav === 0 ? 0 : marketValue / nav };
  });
}

export function summarizePortfolio(positions: Position[], nav: number, cash: number): PortfolioSummary {
  const values = positions.map((position) => position.quantity * position.price);
  const longMarketValue = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const signedShort = values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  const shortMarketValue = Math.abs(signedShort);
  const grossMarketValue = longMarketValue + shortMarketValue;
  const netMarketValue = longMarketValue - shortMarketValue;
  const ratio = (value: number) => (nav === 0 ? 0 : value / nav);
  return {
    nav,
    longMarketValue,
    shortMarketValue,
    grossMarketValue,
    netMarketValue,
    longExposure: ratio(longMarketValue),
    shortExposure: ratio(shortMarketValue),
    grossExposure: ratio(grossMarketValue),
    netExposure: ratio(netMarketValue),
    grossLeverage: ratio(grossMarketValue),
    cash,
    cashExposure: ratio(cash),
    valuationIncomplete: unpricedTickers(positions).length > 0,
  };
}

export function betaAggregate(positions: Position[], nav: number, benchmark: Benchmark, lookback: LookbackDays): BetaAggregate {
  if (nav === 0) return { value: null, status: "calculated", coverage: { calculated: 0, manual: 0, default: 0 } };
  let value = 0;
  let hasManual = false;
  let hasDefault = false;
  const grossBySource: Record<BetaSource, number> = { calculated: 0, manual: 0, default: 0 };
  let valuedGross = 0;
  for (const position of positions) {
    const marketValue = position.quantity * position.price;
    const reading = position.metrics.beta[benchmark][lookback];
    value += (marketValue / nav) * reading.value;
    if (marketValue !== 0) {
      const absolute = Math.abs(marketValue);
      valuedGross += absolute;
      grossBySource[reading.source] += absolute;
      hasManual ||= reading.source === "manual";
      hasDefault ||= reading.source === "default";
    }
  }
  return {
    value,
    status: hasDefault ? "default-assisted" : hasManual ? "manual-assisted" : "calculated",
    coverage: {
      calculated: valuedGross === 0 ? 0 : grossBySource.calculated / valuedGross,
      manual: valuedGross === 0 ? 0 : grossBySource.manual / valuedGross,
      default: valuedGross === 0 ? 0 : grossBySource.default / valuedGross,
    },
  };
}

export function portfolioBeta(positions: Position[], nav: number, benchmark: Benchmark, lookback: LookbackDays): number | null {
  return betaAggregate(positions, nav, benchmark, lookback).value;
}

export function betaContribution(position: Position, nav: number, benchmark: Benchmark, lookback: LookbackDays): number | null {
  if (nav === 0) return null;
  return ((position.quantity * position.price) / nav) * position.metrics.beta[benchmark][lookback].value;
}

export function applyTrades(portfolio: PortfolioData, trades: Trade[]): PortfolioData {
  const positionMap = new Map(portfolio.positions.map((position) => [position.ticker, { ...position }]));
  let cash = portfolio.cash;
  for (const trade of trades) {
    const position = positionMap.get(trade.ticker);
    if (!position || !Number.isFinite(trade.notional) || trade.notional <= 0 || position.price <= 0) continue;
    const direction = trade.side === "buy" ? 1 : -1;
    position.quantity += direction * (trade.notional / position.price);
    cash -= direction * trade.notional;
  }
  return { ...portfolio, cash, positions: [...positionMap.values()] };
}
