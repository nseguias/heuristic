import type { EsploraTx, LabelCategory, RiskBand } from "./types";
import { detectCoinjoin } from "./heuristics";
import { labelFor } from "./labels";
import { CATEGORY_META } from "./screening";

/**
 * Value-weighted ancestry taint — the honest "check everything" engine.
 *
 * Propagates the coin's value backward across the WHOLE ancestor DAG ("haircut"
 * taint): a UTXO of value v from a tx is attributed to that tx's inputs in
 * proportion to their value. Every ancestor's input addresses are screened. A
 * branch stops only at a definitive origin — a labelled entity, a coinbase, or a
 * coinjoin — or when its value share is immaterial.
 *
 * The only limit on completeness is data-fetch throughput (each ancestor tx is a
 * network round-trip on a rate-limited public API), NOT compute. So the trace is
 * RESUMABLE: it expands the highest-value frontier within a time/node budget,
 * returns its state, and a "keep crawling" can pick up exactly where it left off
 * and push coverage higher until the frontier is empty (fully resolved).
 */

export type OriginKey = LabelCategory | "coinbase" | "mixed" | "unresolved";

export interface TaintOrigin {
  key: OriginKey;
  name: string;
  fraction: number;
  risk: number;
}
export interface TaintNode {
  txid: string;
  contribution: number;
  kind: "tx" | "coinbase" | "mixed" | OriginKey;
  category?: LabelCategory;
  label?: string;
  blockTime?: number;
}
export interface TaintEdge {
  from: string;
  to: string;
  value: number;
}

interface OriginAcc {
  cat: OriginKey;
  name: string;
  value: number;
}

/** Serializable working state — lets the crawl pause and continue. */
export interface TaintState {
  seed: string;
  totalSat: number;
  frontier: [string, number][];
  blockTimes: [string, number][];
  visited: string[];
  origins: [string, OriginAcc][];
  nodes: TaintNode[];
  edges: TaintEdge[];
  visitedCount: number;
}

export interface TaintResult {
  seed: string;
  totalSat: number;
  coverage: number;
  nodesVisited: number;
  frontierSize: number; // ancestors still queued — > 0 means more to crawl
  done: boolean; // frontier empty → fully resolved
  truncated: boolean; // stopped on a budget (more remains)
  origins: TaintOrigin[];
  badFraction: number;
  mixedFraction: number;
  cleanFraction: number;
  unresolvedFraction: number;
  score: number;
  band: RiskBand;
  graph: { nodes: TaintNode[]; edges: TaintEdge[] };
  state: TaintState; // pass back to traceTaint to keep crawling
}

const CLEAN_CATS: LabelCategory[] = ["exchange", "mining", "seizure", "historic"];

function bandFor(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score >= 8) return "low";
  return "clean";
}

interface Opts {
  maxNodesPerCall?: number;
  minFraction?: number;
  concurrency?: number;
  timeBudgetMs?: number;
  onProgress?: (nodes: number, coveragePct: number) => void;
}

export async function traceTaint(
  seedTxid: string,
  fetchTx: (id: string) => Promise<EsploraTx>,
  opts: Opts = {},
  resume?: TaintState
): Promise<TaintResult> {
  const maxNodesPerCall = opts.maxNodesPerCall ?? 1200;
  const minFraction = opts.minFraction ?? 0.0008;
  const concurrency = opts.concurrency ?? 16;
  const timeBudgetMs = opts.timeBudgetMs ?? 16000;
  const startMs = Date.now();

  const origins = new Map<string, OriginAcc>();
  const frontier = new Map<string, number>();
  const blockTimes = new Map<string, number>();
  const visited = new Set<string>();
  const txCache = new Map<string, EsploraTx>();
  let nodes: TaintNode[];
  let edges: TaintEdge[];
  let totalSat: number;
  let visitedCount: number;

  const addOrigin = (cat: OriginKey, name: string, value: number) => {
    const k =
      cat === "unresolved" || cat === "coinbase" || cat === "mixed"
        ? cat
        : `${cat}:${name}`;
    const e = origins.get(k);
    if (e) e.value += value;
    else origins.set(k, { cat, name, value });
  };

  if (resume) {
    totalSat = resume.totalSat;
    for (const [k, v] of resume.origins) origins.set(k, { ...v });
    for (const [k, v] of resume.frontier) frontier.set(k, v);
    for (const [k, v] of resume.blockTimes) blockTimes.set(k, v);
    for (const t of resume.visited) visited.add(t);
    nodes = resume.nodes.slice();
    edges = resume.edges.slice();
    visitedCount = resume.visitedCount;
  } else {
    nodes = [];
    edges = [];
    visitedCount = 0;
    const seed = await fetchTx(seedTxid).catch(() => null);
    if (!seed) {
      addOrigin("unresolved", "Unresolved", 1);
      return snapshot(seedTxid, 0, origins, frontier, blockTimes, visited, nodes, edges, 0);
    }
    totalSat = seed.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0) || 1;
    frontier.set(seedTxid, 1);
    blockTimes.set(seedTxid, seed.status.block_time ?? 0);
    txCache.set(seedTxid, seed);
  }

  const startCount = visitedCount;
  while (
    frontier.size > 0 &&
    visitedCount - startCount < maxNodesPerCall &&
    Date.now() - startMs < timeBudgetMs
  ) {
    const batch = [...frontier.entries()]
      .filter(([, c]) => c >= minFraction)
      .sort((a, b) => b[1] - a[1])
      .slice(0, concurrency);
    if (batch.length === 0) break;

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
      if (tx.vin.some((v) => v.is_coinbase)) {
        addOrigin("coinbase", "Coinbase (mined)", contribution);
        nodes.push({ txid, contribution, kind: "coinbase", blockTime: bt });
        continue;
      }
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
          addOrigin(label.category, label.name, share);
          edges.push({ from: `L:${label.category}:${label.name}`, to: txid, value: share });
          continue;
        }
        const childId = vin.txid;
        edges.push({ from: childId, to: txid, value: share });
        if (visited.has(childId)) {
          addOrigin("unresolved", "Unresolved", share);
          continue;
        }
        frontier.set(childId, (frontier.get(childId) ?? 0) + share);
        if (!blockTimes.has(childId)) blockTimes.set(childId, (bt ?? 0) - 1);
      }
    }

    let fsum = 0;
    for (const c of frontier.values()) fsum += c;
    opts.onProgress?.(visitedCount, Math.round(Math.max(0, 1 - fsum) * 100));
  }

  return snapshot(
    resume?.seed ?? seedTxid,
    totalSat,
    origins,
    frontier,
    blockTimes,
    visited,
    nodes,
    edges,
    visitedCount
  );
}

function snapshot(
  seed: string,
  totalSat: number,
  origins: Map<string, OriginAcc>,
  frontier: Map<string, number>,
  blockTimes: Map<string, number>,
  visited: Set<string>,
  nodes: TaintNode[],
  edges: TaintEdge[],
  visitedCount: number
): TaintResult {
  // Frontier remainder is the not-yet-traced value — counted as unresolved for
  // THIS snapshot only, never baked into the resumable origins (else continuing
  // would double-count it).
  let remaining = 0;
  for (const c of frontier.values()) remaining += c;

  const display = new Map<string, OriginAcc>();
  for (const [k, v] of origins) display.set(k, { ...v });
  if (remaining > 0) {
    const u = display.get("unresolved");
    if (u) u.value += remaining;
    else display.set("unresolved", { cat: "unresolved", name: "Unresolved", value: remaining });
  }

  const list: TaintOrigin[] = [...display.values()]
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
    list.filter(pred).reduce((s, o) => s + o.fraction, 0);
  const sanctioned = fracBy((o) => o.key === "sanctioned");
  const hack = fracBy((o) => o.key === "hack");
  const service = fracBy((o) => o.key === "service");
  const mixedFraction = fracBy((o) => o.key === "mixed");
  const unresolvedFraction = fracBy((o) => o.key === "unresolved");
  const cleanFraction = fracBy(
    (o) => o.key === "coinbase" || CLEAN_CATS.includes(o.key as LabelCategory)
  );
  const badFraction = sanctioned + hack;

  let score = 0;
  if (sanctioned > 0) score = Math.max(score, Math.min(100, 78 + sanctioned * 220));
  if (hack > 0) score = Math.max(score, Math.min(96, 30 + hack * 220));
  if (service > 0.05) score = Math.max(score, Math.min(45, 18 + service * 60));
  if (mixedFraction > 0.02) score = Math.max(score, Math.min(58, 24 + mixedFraction * 55));

  const done = frontier.size === 0;
  const state: TaintState = {
    seed,
    totalSat,
    frontier: [...frontier.entries()],
    blockTimes: [...blockTimes.entries()],
    visited: [...visited],
    origins: [...origins.entries()],
    nodes,
    edges,
    visitedCount,
  };

  return {
    seed,
    totalSat,
    coverage: Math.max(0, Math.min(1, 1 - unresolvedFraction)),
    nodesVisited: visitedCount,
    frontierSize: frontier.size,
    done,
    truncated: !done,
    origins: list,
    badFraction,
    mixedFraction,
    cleanFraction,
    unresolvedFraction,
    score,
    band: bandFor(score),
    graph: { nodes, edges },
    state,
  };
}
