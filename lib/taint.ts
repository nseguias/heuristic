import type { EsploraTx, LabelCategory, RiskBand } from "./types";
import { detectCoinjoin } from "./heuristics";
import { labelFor } from "./labels";
import { CATEGORY_META } from "./screening";

/**
 * Value-weighted ancestry taint — the honest "check everything" engine.
 *
 * Instead of following the single dominant input (which can miss taint hiding in
 * a side branch → a false "clean", the worst failure), this propagates the
 * coin's value backward across the WHOLE ancestor DAG ("haircut" taint): a UTXO
 * of value v from a tx is attributed to that tx's inputs in proportion to their
 * value. Every ancestor's input addresses are screened against the label set. A
 * branch stops only when it reaches a definitive origin — a labelled entity
 * (exchange / hack / sanctioned / …), a coinbase (mined), or a coinjoin (mixed,
 * origin obscured) — or when its value share becomes immaterial.
 *
 * Because value concentrates, the materially-relevant ancestry is finite and
 * tractable: we expand the highest-value frontier first, in parallel, until we
 * have accounted for ~all of the coin's value or hit a node budget — and we
 * report COVERAGE so the result is never silently partial.
 */

export type OriginKey =
  | LabelCategory
  | "coinbase"
  | "mixed"
  | "unresolved";

export interface TaintOrigin {
  key: OriginKey;
  name: string;
  fraction: number; // 0..1 of the coin's value
  risk: number; // 0..1
}

export interface TaintNode {
  txid: string;
  contribution: number; // fraction of the coin's value flowing through it
  kind: "tx" | "coinbase" | "mixed" | OriginKey;
  category?: LabelCategory;
  label?: string;
  blockTime?: number;
}
export interface TaintEdge {
  from: string; // child (older)
  to: string; // parent tx (newer)
  value: number; // fraction of coin value on this edge
}

export interface TaintResult {
  seed: string;
  totalSat: number;
  coverage: number; // fraction of value resolved to a definitive bucket
  nodesVisited: number;
  truncated: boolean; // stopped on the node budget
  origins: TaintOrigin[];
  badFraction: number; // hack + sanctioned
  mixedFraction: number;
  cleanFraction: number; // exchange + mining + coinbase + seizure + historic
  unresolvedFraction: number;
  score: number;
  band: RiskBand;
  graph: { nodes: TaintNode[]; edges: TaintEdge[] };
}

const CLEAN_CATS: LabelCategory[] = [
  "exchange",
  "mining",
  "seizure",
  "historic",
];

function bandFor(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score >= 8) return "low";
  return "clean";
}

interface Opts {
  maxNodes?: number;
  minFraction?: number; // prune branches below this share of the coin
  concurrency?: number;
  timeBudgetMs?: number; // hard wall-clock cap — best-effort within it
  onProgress?: (nodes: number, coveragePct: number) => void;
}

export async function traceTaint(
  seedTxid: string,
  fetchTx: (id: string) => Promise<EsploraTx>,
  opts: Opts = {}
): Promise<TaintResult> {
  const maxNodes = opts.maxNodes ?? 800;
  const minFraction = opts.minFraction ?? 0.001;
  const concurrency = opts.concurrency ?? 16;
  const timeBudgetMs = opts.timeBudgetMs ?? 18000;
  const startMs = Date.now();

  const seed = await fetchTx(seedTxid).catch(() => null);
  const origins = new Map<string, { cat: OriginKey; name: string; value: number }>();
  const nodes: TaintNode[] = [];
  const edges: TaintEdge[] = [];

  const addOrigin = (cat: OriginKey, name: string, value: number) => {
    const k = cat === "unresolved" || cat === "coinbase" || cat === "mixed" ? cat : `${cat}:${name}`;
    const e = origins.get(k);
    if (e) e.value += value;
    else origins.set(k, { cat, name, value });
  };

  if (!seed) {
    addOrigin("unresolved", "Unresolved", 1);
    return finish(seedTxid, 0, origins, nodes, edges, true, 0);
  }
  const totalSat = seed.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0) || 1;

  // frontier: txid -> { contribution (fraction of coin value), blockTime }
  const frontier = new Map<string, number>();
  const blockTimes = new Map<string, number>();
  const visited = new Set<string>();
  frontier.set(seedTxid, 1);
  blockTimes.set(seedTxid, seed.status.block_time ?? 0);
  const txCache = new Map<string, EsploraTx>([[seedTxid, seed]]);

  let visitedCount = 0;
  let truncated = false;

  while (
    frontier.size > 0 &&
    visitedCount < maxNodes &&
    Date.now() - startMs < timeBudgetMs
  ) {
    // Highest-contribution frontier items first, above the materiality floor.
    const batch = [...frontier.entries()]
      .filter(([, c]) => c >= minFraction)
      .sort((a, b) => b[1] - a[1])
      .slice(0, concurrency);
    if (batch.length === 0) break; // only immaterial dust remains

    for (const [txid] of batch) {
      frontier.delete(txid);
      visited.add(txid);
    }

    const fetched = await Promise.all(
      batch.map(async ([txid]) => {
        if (txCache.has(txid)) return txCache.get(txid)!;
        const t = await fetchTx(txid).catch(() => null);
        if (t) txCache.set(txid, t);
        return t;
      })
    );

    for (let i = 0; i < batch.length; i++) {
      const [txid, contribution] = batch[i];
      const tx = fetched[i];
      visitedCount += 1;
      const bt = blockTimes.get(txid);

      if (!tx) {
        addOrigin("unresolved", "Unresolved", contribution);
        nodes.push({ txid, contribution, kind: "unresolved", blockTime: bt });
        continue;
      }

      // Coinbase — freshly minted, cleanest origin.
      if (tx.vin.some((v) => v.is_coinbase)) {
        addOrigin("coinbase", "Coinbase (mined)", contribution);
        nodes.push({ txid, contribution, kind: "coinbase", blockTime: bt });
        continue;
      }

      // Coinjoin — the trail is severed by design; this value is mixed. Require
      // real confidence so exchange batch-withdrawals (coincidental equal
      // outputs) aren't misread as mixing.
      const cj = detectCoinjoin(tx);
      if (cj.isCoinjoin && cj.confidence >= 0.6) {
        addOrigin("mixed", "Coinjoin (mixed)", contribution);
        nodes.push({ txid, contribution, kind: "mixed", blockTime: bt });
        continue;
      }

      const sumIn = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
      nodes.push({ txid, contribution, kind: "tx", blockTime: bt });
      if (sumIn <= 0) {
        addOrigin("unresolved", "Unresolved", contribution);
        continue;
      }

      for (const vin of tx.vin) {
        const v = vin.prevout?.value ?? 0;
        if (v <= 0) continue;
        const share = contribution * (v / sumIn);
        const addr = vin.prevout?.scriptpubkey_address;
        const label = addr ? labelFor(addr) : undefined;

        if (label) {
          // Reached a known entity — attribute this share and stop the branch.
          addOrigin(label.category, label.name, share);
          edges.push({ from: `L:${label.category}:${label.name}`, to: txid, value: share });
          continue;
        }

        const childId = vin.txid;
        edges.push({ from: childId, to: txid, value: share });
        if (visited.has(childId)) {
          // Already expanded elsewhere (a merge/loop) — its taint is counted
          // there; the duplicated share is immaterial. Park it as unresolved.
          addOrigin("unresolved", "Unresolved", share);
          continue;
        }
        frontier.set(childId, (frontier.get(childId) ?? 0) + share);
        if (!blockTimes.has(childId))
          blockTimes.set(childId, (bt ?? 0) - 1);
      }
    }

    let fsum = 0;
    for (const c of frontier.values()) fsum += c;
    opts.onProgress?.(visitedCount, Math.round(Math.max(0, 1 - fsum) * 100));
  }

  // Anything still in the frontier (budget hit or pruned dust) is unresolved.
  let remaining = 0;
  for (const c of frontier.values()) remaining += c;
  if (frontier.size > 0 && (visitedCount >= maxNodes || Date.now() - startMs >= timeBudgetMs))
    truncated = true;
  if (remaining > 0) addOrigin("unresolved", "Unresolved", remaining);

  return finish(seedTxid, totalSat, origins, nodes, edges, truncated, visitedCount);
}

function finish(
  seed: string,
  totalSat: number,
  originsMap: Map<string, { cat: OriginKey; name: string; value: number }>,
  nodes: TaintNode[],
  edges: TaintEdge[],
  truncated: boolean,
  nodesVisited: number
): TaintResult {
  const origins: TaintOrigin[] = [...originsMap.values()]
    .map((o) => ({
      key: o.cat,
      name: o.name,
      fraction: o.value,
      risk:
        o.cat === "coinbase"
          ? 0
          : o.cat === "mixed"
            ? 0.35
            : o.cat === "unresolved"
              ? 0
              : CATEGORY_META[o.cat as LabelCategory].risk,
    }))
    .sort((a, b) => b.fraction - a.fraction);

  const fracBy = (pred: (o: TaintOrigin) => boolean) =>
    origins.filter(pred).reduce((s, o) => s + o.fraction, 0);

  const sanctioned = fracBy((o) => o.key === "sanctioned");
  const hack = fracBy((o) => o.key === "hack");
  const service = fracBy((o) => o.key === "service");
  const mixedFraction = fracBy((o) => o.key === "mixed");
  const unresolvedFraction = fracBy((o) => o.key === "unresolved");
  const cleanFraction = fracBy(
    (o) => o.key === "coinbase" || CLEAN_CATS.includes(o.key as LabelCategory)
  );
  const badFraction = sanctioned + hack;
  const coverage = Math.max(0, Math.min(1, 1 - unresolvedFraction));

  // Exchange-acceptance risk, value-weighted over ALL paths.
  let score = 0;
  if (sanctioned > 0) score = Math.max(score, Math.min(100, 78 + sanctioned * 220));
  if (hack > 0) score = Math.max(score, Math.min(96, 30 + hack * 220));
  if (service > 0.05) score = Math.max(score, Math.min(45, 18 + service * 60));
  if (mixedFraction > 0.02) score = Math.max(score, Math.min(58, 24 + mixedFraction * 55));

  return {
    seed,
    totalSat,
    coverage,
    nodesVisited,
    truncated,
    origins,
    badFraction,
    mixedFraction,
    cleanFraction,
    unresolvedFraction,
    score,
    band: bandFor(score),
    graph: { nodes, edges },
  };
}
