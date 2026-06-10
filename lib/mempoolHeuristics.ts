import type { MempoolRecent } from "./api";

/**
 * Lightweight classification for the live feed. The /mempool/recent buffer only
 * carries txid/fee/vsize/value — not full inputs/outputs — so these are coarse
 * "worth a look" flags, not the full structural heuristics used on a trace.
 */

export type FeedFlagKind = "whale" | "highfee" | "dust" | "consolidation";

export interface FeedFlag {
  kind: FeedFlagKind;
  label: string;
  color: string;
}

const WHALE_SATS = 50 * 1e8; // ≥ 50 BTC moved
const HIGH_FEERATE = 50; // sat/vB
const DUST_SATS = 1000;
const BIG_VSIZE = 5000; // many inputs/outputs → large tx

export function flagRecent(tx: MempoolRecent): FeedFlag[] {
  const flags: FeedFlag[] = [];
  const feeRate = tx.vsize > 0 ? tx.fee / tx.vsize : 0;

  if (tx.value >= WHALE_SATS)
    flags.push({ kind: "whale", label: "WHALE", color: "var(--accent)" });
  if (feeRate >= HIGH_FEERATE)
    flags.push({ kind: "highfee", label: "HIGH FEE", color: "var(--taint)" });
  if (tx.value > 0 && tx.value <= DUST_SATS)
    flags.push({ kind: "dust", label: "DUST", color: "var(--text-faint)" });
  if (tx.vsize >= BIG_VSIZE)
    flags.push({
      kind: "consolidation",
      label: "LARGE",
      color: "var(--mix)",
    });

  return flags;
}

export function feeRateOf(tx: MempoolRecent): number {
  return tx.vsize > 0 ? tx.fee / tx.vsize : 0;
}
