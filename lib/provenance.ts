import type { EsploraTx, EntityLabel, RiskBand, LabelCategory } from "./types";
import { detectCoinjoin, inputAddresses, mixingRiskFor } from "./heuristics";
import { labelFor } from "./labels";

/**
 * Source-of-funds / provenance check — "before you accept this coin, where did
 * it come from?". Walks BACKWARD along the dominant (highest-value) input each
 * hop until it reaches an origin: a coinbase (freshly mined — genesis side), a
 * known entity (exchange/hack/sanctioned), or the hop limit. Accumulates the
 * worst risk encountered along the path into a single acceptance score.
 *
 * It follows one path (the main value flow), not the whole branching graph, so
 * "trace back to genesis" stays tractable.
 */

export type ProvenanceOrigin =
  | "coinbase"
  | "exchange"
  | "flagged"
  | "mixed" // trail ends at a coinjoin — origin obscured by mixing
  | "depth-limit"
  | "dead-end";

export interface ProvenanceEvent {
  txid: string;
  hop: number;
  label?: string;
  reason: string;
  risk: number;
}

/** One step on the dominant value path, for the hop-by-hop trace graph. */
export interface ProvenanceHop {
  hop: number;
  txid: string;
  blockHeight?: number;
  blockTime?: number;
  valueSat?: number; // value carried into this tx by the followed input
  label?: string;
  category?: LabelCategory;
  isCoinjoin?: boolean;
  kind: "tx" | "coinbase" | "exchange" | "flagged" | "mixed";
}

export interface ProvenanceResult {
  seed: string;
  hops: number;
  origin: ProvenanceOrigin;
  originLabel?: EntityLabel;
  originBlock?: number;
  oldestBlock?: number; // deepest (oldest) block reached on the path
  oldestBlockTime?: number; // its block timestamp (unix seconds) — accurate date
  taintOnPath: boolean; // did the dominant path itself touch any risk?
  resolved: boolean; // trail ended at a definitive signal (not the depth cap)
  reachedGenesis: boolean;
  score: number; // 0..100 acceptance risk along the path
  band: RiskBand;
  events: ProvenanceEvent[]; // notable risk events encountered
  path: ProvenanceHop[]; // the full dominant value path, hop by hop
}

function bandFor(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score >= 8) return "low";
  return "clean";
}

export async function traceProvenance(
  seedTxid: string,
  fetchTx: (id: string) => Promise<EsploraTx>,
  opts: { maxHops?: number; onHop?: (hop: number) => void } = {}
): Promise<ProvenanceResult> {
  // Crawl deep. The trail almost always terminates early at a definitive signal
  // (a flag, a coinjoin, an exchange, or a coinbase); the cap is just the
  // practical backstop for an otherwise-clean coin, since no typical coin has a
  // single reachable "genesis".
  const maxHops = opts.maxHops ?? 200;
  const events: ProvenanceEvent[] = [];
  let score = 0;
  let origin: ProvenanceOrigin = "depth-limit";
  let originLabel: EntityLabel | undefined;
  let originBlock: number | undefined;
  let oldestBlock: number | undefined;
  let oldestBlockTime: number | undefined;

  let current: EsploraTx | null = await fetchTx(seedTxid).catch(() => null);
  let hop = 0;
  let coinjoinCount = 0;
  const path: ProvenanceHop[] = [];

  for (; current && hop < maxHops; hop++) {
    opts.onHop?.(hop);
    // Each hop is strictly older — track how far back the path reaches.
    if (current.status.block_height != null)
      oldestBlock = current.status.block_height;
    if (current.status.block_time != null)
      oldestBlockTime = current.status.block_time;

    const isCoinbase = current.vin.some((v) => v.is_coinbase);
    const cj = !isCoinbase && detectCoinjoin(current).isCoinjoin;

    // Strongest label on this hop's input addresses.
    let hopLabel: EntityLabel | undefined;
    if (!isCoinbase)
      for (const a of inputAddresses(current)) {
        const l = labelFor(a);
        if (l && (!hopLabel || l.risk > hopLabel.risk)) hopLabel = l;
      }

    const node: ProvenanceHop = {
      hop,
      txid: current.txid,
      blockHeight: current.status.block_height ?? undefined,
      blockTime: current.status.block_time ?? undefined,
      label: hopLabel?.name,
      category: hopLabel?.category,
      isCoinjoin: cj || undefined,
      kind: "tx",
    };

    // Coinbase reached — the coins were minted here.
    if (isCoinbase) {
      node.kind = "coinbase";
      origin = "coinbase";
      originBlock = current.status.block_height;
      path.push(node);
      break;
    }

    // Coinjoin reached — the trail goes cold here. A mix deliberately severs the
    // input→output link, so following a "dominant input" past it is meaningless.
    // This is a definitive, honest stopping point, not incomplete data.
    if (cj) {
      coinjoinCount += 1;
      const mixRisk = mixingRiskFor(coinjoinCount);
      score = Math.max(score, mixRisk);
      events.push({
        txid: current.txid,
        hop,
        reason: "trail ends at a coinjoin — origin obscured by mixing",
        risk: mixRisk,
      });
      node.kind = "mixed";
      origin = "mixed";
      path.push(node);
      break;
    }

    if (hopLabel) {
      const r = hopLabel.risk * 100;
      score = Math.max(score, r);
      if (hopLabel.risk >= 0.5 || hopLabel.category === "exchange")
        events.push({
          txid: current.txid,
          hop,
          label: hopLabel.name,
          reason:
            hopLabel.category === "exchange"
              ? `funds sourced from ${hopLabel.name} (KYC exchange)`
              : `passed through ${hopLabel.name}`,
          risk: r,
        });
      // A KYC exchange or a strong criminal origin establishes provenance — stop.
      if (hopLabel.category === "exchange") {
        node.kind = "exchange";
        origin = "exchange";
        originLabel = hopLabel;
        path.push(node);
        break;
      }
      if (hopLabel.risk >= 0.9) {
        node.kind = "flagged";
        origin = "flagged";
        originLabel = hopLabel;
        path.push(node);
        break;
      }
    }

    // Follow the dominant (highest-value) input backward.
    const parents = current.vin
      .filter((v) => !v.is_coinbase && v.prevout)
      .sort((a, b) => (b.prevout?.value ?? 0) - (a.prevout?.value ?? 0));
    if (!parents.length) {
      origin = "dead-end";
      path.push(node);
      break;
    }
    node.valueSat = parents[0].prevout?.value;
    path.push(node);
    current = await fetchTx(parents[0].txid).catch(() => null);
  }

  // A clean coinbase origin with no risk events is the cleanest possible result.
  if (origin === "coinbase" && score < 8) score = 0;

  return {
    seed: seedTxid,
    hops: hop,
    origin,
    originLabel,
    originBlock,
    oldestBlock,
    oldestBlockTime,
    taintOnPath: events.length > 0,
    resolved:
      origin === "coinbase" ||
      origin === "exchange" ||
      origin === "flagged" ||
      origin === "mixed",
    reachedGenesis: origin === "coinbase",
    score: Math.max(0, Math.min(100, score)),
    band: bandFor(score),
    events: events.slice(0, 8),
    path,
  };
}
