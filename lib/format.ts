/**
 * Display formatting per the number-formatting spec: no scientific notation,
 * no ellipsis truncation, `--` for invalid, tabular-nums assumed in CSS.
 * Internal math stays in raw sats (integers) — these are display-only.
 */

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPTS[Number(d)])
    .join("");
}

function invalid(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    typeof v !== "number" ||
    Number.isNaN(v) ||
    !Number.isFinite(v)
  );
}

/** sats → BTC string. Compact for tables/edges, detailed for inspector. */
export function formatBtc(
  sats: number | null | undefined,
  mode: "compact" | "detailed" = "compact"
): string {
  if (invalid(sats)) return "--";
  const s = sats as number;
  if (s === 0) return "0";
  const btc = Math.abs(s) / 1e8;
  const sign = s < 0 ? "−" : "";

  if (mode === "detailed") {
    // Full 8-decimal precision, trailing zeros trimmed to pairs of meaning.
    const str = btc.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    return `${sign}${withGroups(str)}`;
  }

  if (btc >= 1000) return `${sign}${abbreviate(btc)}`;
  if (btc >= 1) return `${sign}${trim(btc.toFixed(4))}`;
  if (btc >= 0.0001) return `${sign}${trim(btc.toFixed(6))}`;

  // ≥3 leading zeros after the decimal → zero-subscript notation.
  const leading = Math.floor(-Math.log10(btc)) - 1;
  if (leading >= 3) {
    const sig = Math.round(btc * 10 ** (leading + 2)) % 100;
    return `${sign}0.0${toSubscript(leading)}${String(sig).padStart(2, "0")}`;
  }
  return `${sign}${trim(btc.toFixed(8))}`;
}

/** Expanded value for aria-labels on zero-subscript renderings and copy. */
export function btcAria(sats: number | null | undefined): string {
  if (invalid(sats)) return "unknown amount";
  return `${((sats as number) / 1e8).toFixed(8)} BTC`;
}

export function formatSats(sats: number | null | undefined): string {
  if (invalid(sats)) return "--";
  return `${withGroups(String(Math.round(sats as number)))} sat`;
}

/** USD value of a sats amount given BTC/USD price. Abbreviates large sums. */
export function formatUsd(
  sats: number | null | undefined,
  btcUsd: number | null | undefined
): string {
  if (invalid(sats) || invalid(btcUsd)) return "--";
  const usd = ((sats as number) / 1e8) * (btcUsd as number);
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd >= 1000) return `$${abbreviate(usd)}`;
  if (usd >= 1) return `$${withGroups(usd.toFixed(2))}`;
  return `$${usd.toFixed(2)}`;
}

/** Fee-rate display: avoids "0–0" by collapsing equal/sub-unit bounds. */
export function formatFeeRange(lo: number, hi: number): string {
  const f = (x: number) =>
    x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x > 0 ? x.toFixed(2) : "0";
  const a = f(lo);
  const b = f(hi);
  return a === b ? a : `${a}–${b}`;
}

export function formatFeeRateValue(x: number): string {
  if (x >= 10) return x.toFixed(0);
  if (x >= 1) return x.toFixed(1);
  if (x > 0) return x.toFixed(2);
  return "0";
}

export function formatPercent(
  v: number | null | undefined,
  decimals = 0
): string {
  if (invalid(v)) return "--";
  const pct = (v as number) * 100;
  if (pct !== 0 && Math.abs(pct) < 0.01) return "<0.01%";
  return `${pct.toFixed(decimals)}%`;
}

export function formatCount(v: number | null | undefined): string {
  if (invalid(v)) return "--";
  const n = v as number;
  if (n >= 1000) return abbreviate(n);
  return String(n);
}

export function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 1) return hash;
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}

export function formatVsize(weight: number | null | undefined): string {
  if (invalid(weight)) return "--";
  return `${withGroups(String(Math.ceil((weight as number) / 4)))} vB`;
}

export function formatFeeRate(
  fee: number | null | undefined,
  weight: number | null | undefined
): string {
  if (invalid(fee) || invalid(weight) || weight === 0) return "--";
  return `${((fee as number) / ((weight as number) / 4)).toFixed(1)} sat/vB`;
}

export function formatTimestamp(unix: number | null | undefined): string {
  if (invalid(unix)) return "UNCONFIRMED";
  return new Date((unix as number) * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16) + " UTC";
}

function abbreviate(n: number): string {
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [div, suffix] of units) {
    if (n >= div) return `${trim((n / div).toFixed(1))}${suffix}`;
  }
  return String(n);
}

function trim(s: string): string {
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function withGroups(s: string): string {
  const [int, frac] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}
