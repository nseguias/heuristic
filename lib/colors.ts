import type { RiskBand, TxAnalysis } from "./types";

/** Single source of truth for semantic colors, mirroring globals.css tokens. */
export const C = {
  bg: "#0b0a08",
  surface: "#12110e",
  line: "rgba(231, 222, 202, 0.08)",
  text: "#e7deca",
  dim: "#8a8472",
  faint: "#55503f",
  accent: "#f5a623",
  clean: "#7fb069",
  warn: "#e0a458",
  taint: "#e4572e",
  mix: "#4ecdc4",
} as const;

export const RISK_COLOR: Record<RiskBand, string> = {
  clean: C.clean,
  low: C.clean,
  medium: C.warn,
  high: C.taint,
  critical: C.taint,
};

export const RISK_LABEL: Record<RiskBand, string> = {
  clean: "CLEAN",
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  critical: "CRITICAL",
};

/** A node's dominant color: coinjoins read cyan; otherwise risk band. */
export function nodeColor(a: TxAnalysis): string {
  if (a.coinjoin.isCoinjoin) return C.mix;
  return RISK_COLOR[a.riskBand];
}

/**
 * Deterministic, well-spread colour for a cluster (entity). Same cluster root →
 * same colour everywhere, so co-owned addresses/transactions are visually
 * groupable. Uses the golden angle so adjacent clusters get distinct hues.
 */
export function clusterColor(root: string): string {
  let h = 0;
  for (let i = 0; i < root.length; i++) h = (h * 31 + root.charCodeAt(i)) >>> 0;
  const hue = (h * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 60%, 62%)`;
}

/** Interpolate clean→warn→taint for a 0..100 score (continuous risk ramp). */
export function riskRamp(score: number): string {
  const stops = [
    [0, [127, 176, 105]],
    [50, [224, 164, 88]],
    [100, [228, 87, 46]],
  ] as const;
  const s = Math.max(0, Math.min(100, score));
  for (let i = 1; i < stops.length; i++) {
    const [hi, c1] = stops[i];
    const [lo, c0] = stops[i - 1];
    if (s <= hi) {
      const t = (s - lo) / (hi - lo);
      const ch = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
    }
  }
  return C.taint;
}
