import type { EsploraTx, LabelCategory, RiskBand, EntityLabel } from "./types";
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
  kind: "tx" | "coinbase" | "mixed" | "frontier" | OriginKey;
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

// A frontier sliver below this fraction of the original coin is negligible dust
// — the trace is "done" only once every remaining sliver is under it. Set very
// low (≈0.001%) so coverage genuinely converges instead of stranding value.
const EPS = 1e-5;
// Frontier tips below this share aren't drawn as graph nodes (keeps the canvas
// readable) — independent of EPS, which governs crawling, not display.
const DISPLAY_MIN = 0.004;

function bandFor(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score >= 8) return "low";
  return "clean";
}

/**
 * The sender is itself a known entity — its label IS the origin. Build a trivial
 * "coin ← entity" result so the check still shows the story as a chart, without
 * deep-crawling the entity's (enormous) internal ancestry.
 */
export function knownEntityTaint(
  seedTxid: string,
  label: EntityLabel,
  totalSat: number,
  blockTime?: number
): TaintResult {
  const cat = label.category;
  const clean = label.risk < 0.5;
  const score = Math.round(label.risk * 100);
  return {
    seed: seedTxid,
    totalSat: totalSat || 1,
    coverage: 1,
    nodesVisited: 1,
    frontierSize: 0,
    done: true,
    truncated: false,
    origins: [{ key: cat, name: label.name, fraction: 1, risk: label.risk }],
    badFraction: cat === "hack" || cat === "sanctioned" ? 1 : 0,
    mixedFraction: 0,
    cleanFraction: clean ? 1 : 0,
    unresolvedFraction: 0,
    score,
    band: bandFor(score),
    graph: {
      nodes: [{ txid: seedTxid, contribution: 1, kind: "tx", blockTime }],
      edges: [{ from: `L:${cat}:${label.name}`, to: seedTxid, value: 1 }],
    },
    state: {
      seed: seedTxid,
      totalSat: totalSat || 1,
      frontier: [],
      blockTimes: [],
      visited: [seedTxid],
      origins: [],
      nodes: [],
      edges: [],
      visitedCount: 1,
    },
  };
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
  const minFraction = opts.minFraction ?? EPS;
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
    // Always expand the highest-value frontier tips first, drilling all the way
    // down to EPS-level dust. Stop only when every remaining sliver is negligible
    // (or the budget runs out) — that's what makes "keep crawling" converge.
    const ranked = [...frontier.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0 || ranked[0][1] < minFraction) break;
    const batch = ranked.slice(0, concurrency);

    for (const [txid] of batch) frontier.delete(txid);

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
      const bt = blockTimes.get(txid);
      // A tx reached again via another path (a "diamond" — normal in real
      // ancestry, and never a cycle since tx history is an acyclic DAG) is
      // re-weighted, not re-recorded: count it as a fresh ancestor and push its
      // node + edges only the FIRST time it's expanded.
      const first = !visited.has(txid);
      if (first) {
        visited.add(txid);
        visitedCount += 1;
      }

      if (!tx) {
        addOrigin("unresolved", "Unresolved", contribution);
        if (first) nodes.push({ txid, contribution, kind: "unresolved", blockTime: bt });
        continue;
      }
      if (tx.vin.some((v) => v.is_coinbase)) {
        addOrigin("coinbase", "Coinbase (mined)", contribution);
        if (first) nodes.push({ txid, contribution, kind: "coinbase", blockTime: bt });
        continue;
      }
      const cj = detectCoinjoin(tx);
      if (cj.isCoinjoin && cj.confidence >= 0.6) {
        addOrigin("mixed", "Coinjoin (mixed)", contribution);
        if (first) nodes.push({ txid, contribution, kind: "mixed", blockTime: bt });
        continue;
      }
      const sumIn = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
      if (first) nodes.push({ txid, contribution, kind: "tx", blockTime: bt });
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
          if (first)
            edges.push({ from: `L:${label.category}:${label.name}`, to: txid, value: share });
          continue;
        }
        const childId = vin.txid;
        if (first) edges.push({ from: childId, to: txid, value: share });
        // Re-accumulate onto the frontier instead of discarding a re-encountered
        // ancestor as "unresolved" — this is what stops the trace leaking a third
        // of the value and lets coverage actually converge.
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
    visitedCount,
    minFraction
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
  visitedCount: number,
  minFraction = EPS
): TaintResult {
  // Frontier remainder is the not-yet-traced value — counted as unresolved for
  // THIS snapshot only, never baked into the resumable origins (else continuing
  // would double-count it). "to go" / done only consider MATERIAL entries:
  // sub-threshold dust will never be crawled, so it shouldn't inflate the queue.
  let remaining = 0;
  let materialCount = 0;
  for (const c of frontier.values()) {
    remaining += c;
    if (c >= minFraction) materialCount += 1;
  }

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

  // "done" = no MATERIAL work left to crawl (only immaterial dust may remain).
  const done = materialCount === 0;
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

  // Graph = resolved/traced nodes + the still-to-crawl frontier tips (so the
  // user sees which branches reach a category vs. which need more crawling).
  const graphNodes: TaintNode[] = nodes.slice();
  for (const [txid, c] of frontier) {
    if (c >= DISPLAY_MIN)
      graphNodes.push({
        txid,
        contribution: c,
        kind: "frontier",
        blockTime: blockTimes.get(txid),
      });
  }

  return {
    seed,
    totalSat,
    coverage: Math.max(0, Math.min(1, 1 - unresolvedFraction)),
    nodesVisited: visitedCount,
    frontierSize: materialCount,
    done,
    truncated: !done,
    origins: list,
    badFraction,
    mixedFraction,
    cleanFraction,
    unresolvedFraction,
    score,
    band: bandFor(score),
    graph: { nodes: graphNodes, edges },
    state,
  };
}
