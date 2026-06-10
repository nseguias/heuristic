import { fetchOutspends, fetchTx } from "./api";
import { analyzeTx, mixingRiskFor } from "./heuristics";
import { AddressClusters } from "./cluster";
import { labelFor } from "./labels";
import type {
  EsploraTx,
  GraphEdge,
  GraphNode,
  TraceGraph,
} from "./types";

export type TraceDirection = "ancestors" | "descendants" | "both";

export interface TraceOptions {
  depth: number;
  direction: TraceDirection;
  /** Stop expanding a branch once it touches a labelled origin. */
  stopAtLabels?: boolean;
  /** Cap on total nodes to keep the graph (and API usage) bounded. */
  maxNodes?: number;
  /** Max inputs/outputs expanded per transaction (highest-value first). */
  fanout?: number;
  onProgress?: (loaded: number, frontier: number) => void;
}

const DEFAULTS = { stopAtLabels: true, maxNodes: 140, fanout: 10 };

/**
 * Breadth-first ancestry/descendant walk from a seed transaction. Ancestors are
 * followed input→prevout (where did this money come from); descendants are
 * followed output→spend (where did it go). Taint propagates downstream from
 * labelled ancestors during the walk.
 */
export async function trace(
  seedTxid: string,
  opts: TraceOptions
): Promise<TraceGraph> {
  const { depth, direction, stopAtLabels, maxNodes, fanout, onProgress } = {
    ...DEFAULTS,
    ...opts,
  };

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const clusters = new AddressClusters();
  const inheritedRisk = new Map<string, number>();

  const seed = await fetchTx(seedTxid);
  clusters.ingest(seed);
  addNode(nodes, seed, 0, inheritedRisk);

  // When tracing both directions, reserve roughly half the node budget for
  // ancestors so descendants still get shown (otherwise a large ancestor tree
  // consumes the whole budget and "both" looks like "source only").
  const ancestorCap =
    direction === "both" ? Math.ceil(maxNodes * 0.5) : maxNodes;

  if (direction === "ancestors" || direction === "both") {
    await walkAncestors(seed, depth, {
      nodes,
      edges,
      clusters,
      inheritedRisk,
      stopAtLabels,
      maxNodes: ancestorCap,
      fanout,
      onProgress,
    });
  }
  if (direction === "descendants" || direction === "both") {
    await walkDescendants(seed, depth, {
      nodes,
      edges,
      clusters,
      inheritedRisk,
      maxNodes,
      fanout,
      onProgress,
    });
  }

  // Cumulative mixing count: how many coinjoins the coins reaching each tx have
  // passed through. Edges run funder→spender, so we relax the count downstream
  // until it converges (graph depth is small).
  const mixCount = new Map<string, number>();
  for (let pass = 0; pass < 9; pass++) {
    let changed = false;
    for (const e of edges.values()) {
      const src = nodes.get(e.source);
      if (!src) continue;
      const through =
        (mixCount.get(e.source) ?? 0) +
        (src.analysis.coinjoin.isCoinjoin ? 1 : 0);
      if (through > (mixCount.get(e.target) ?? 0)) {
        mixCount.set(e.target, through);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Final pass: combine label taint with cumulative mixing exposure.
  for (const [txid, node] of nodes) {
    const inh = inheritedRisk.get(txid) ?? 0;
    const selfMix = node.analysis.coinjoin.isCoinjoin ? 1 : 0;
    const mixExposure = mixingRiskFor((mixCount.get(txid) ?? 0) + selfMix);
    if (inh > 0 || mixExposure > 0)
      node.analysis = analyzeTx(node.tx, inh, mixExposure);
  }

  return {
    nodes,
    edges,
    origin: seedTxid,
    addressCluster: clusters.snapshot(),
  };
}

interface WalkCtx {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  clusters: AddressClusters;
  inheritedRisk: Map<string, number>;
  stopAtLabels?: boolean;
  maxNodes?: number;
  fanout: number;
  onProgress?: (loaded: number, frontier: number) => void;
}

function addNode(
  nodes: Map<string, GraphNode>,
  tx: EsploraTx,
  depth: number,
  inheritedRisk: Map<string, number>
) {
  if (nodes.has(tx.txid)) return nodes.get(tx.txid)!;
  const node: GraphNode = {
    id: tx.txid,
    tx,
    analysis: analyzeTx(tx, inheritedRisk.get(tx.txid) ?? 0),
    depth,
    expandedUp: false,
    expandedDown: false,
  };
  nodes.set(tx.txid, node);
  return node;
}

async function walkAncestors(seed: EsploraTx, depth: number, ctx: WalkCtx) {
  let frontier: Array<{ tx: EsploraTx; d: number }> = [{ tx: seed, d: 0 }];

  while (frontier.length && Math.abs(frontier[0].d) < depth) {
    const next: Array<{ tx: EsploraTx; d: number }> = [];

    for (const { tx, d } of frontier) {
      if (ctx.maxNodes && ctx.nodes.size >= ctx.maxNodes) break;

      // Expand the highest-value inputs first and cap fan-out per tx, so a
      // single wide transaction (e.g. a 131-input sweep) can't saturate the
      // graph and depth stays meaningful. Lower-value inputs are elided.
      const parents = tx.vin
        .filter((vin) => !vin.is_coinbase && vin.prevout)
        .map((vin) => ({
          txid: vin.txid,
          prevout: vin.prevout!,
          voutIndex: vin.vout,
        }))
        .sort((a, b) => b.prevout.value - a.prevout.value)
        .slice(0, ctx.fanout);

      const fetched = await Promise.all(
        parents.map(async (p) => ({
          parent: await fetchTx(p.txid).catch(() => null),
          prevout: p.prevout,
          voutIndex: p.voutIndex,
        }))
      );

      for (const { parent, prevout, voutIndex } of fetched) {
        if (!parent) continue;
        ctx.clusters.ingest(parent);

        // Propagate taint downstream: a labelled parent taints this child.
        const label = labelFor(prevout.scriptpubkey_address);
        if (label && label.risk > 0) {
          const carried = label.risk * 100;
          bump(ctx.inheritedRisk, tx.txid, carried);
        }
        // Carry already-known inherited risk one more hop down.
        const parentInherited = ctx.inheritedRisk.get(parent.txid) ?? 0;
        if (parentInherited > 0)
          bump(ctx.inheritedRisk, tx.txid, parentInherited * 0.95);

        const child = addNode(ctx.nodes, parent, d - 1, ctx.inheritedRisk);
        const edge: GraphEdge = {
          id: `${parent.txid}:${voutIndex}>${tx.txid}`,
          source: parent.txid,
          target: tx.txid,
          value: prevout.value,
          address: prevout.scriptpubkey_address,
          voutIndex,
        };
        ctx.edges.set(edge.id, edge);

        const stop = ctx.stopAtLabels && label;
        if (!stop) next.push({ tx: parent, d: d - 1 });
        else child.expandedUp = true;
      }
      ctx.nodes.get(tx.txid)!.expandedUp = true;
      ctx.onProgress?.(ctx.nodes.size, next.length);
    }

    if (ctx.maxNodes && ctx.nodes.size >= ctx.maxNodes) break;
    frontier = next;
  }
  // Final combined re-analysis (label taint + cumulative mixing) happens once
  // in trace() after both directions are walked.
}

async function walkDescendants(seed: EsploraTx, depth: number, ctx: WalkCtx) {
  let frontier: Array<{ tx: EsploraTx; d: number }> = [{ tx: seed, d: 0 }];

  while (frontier.length && frontier[0].d < depth) {
    const next: Array<{ tx: EsploraTx; d: number }> = [];

    for (const { tx, d } of frontier) {
      if (ctx.maxNodes && ctx.nodes.size >= ctx.maxNodes) break;

      const spends = await fetchOutspends(tx.txid).catch(() => []);
      // Follow the highest-value spent outputs first, capped at fanout.
      const targets = spends
        .map((s, voutIndex) => ({
          s,
          voutIndex,
          value: tx.vout[voutIndex]?.value ?? 0,
          address: tx.vout[voutIndex]?.scriptpubkey_address,
        }))
        .filter((t) => t.s.spent && t.s.txid)
        .sort((a, b) => b.value - a.value)
        .slice(0, ctx.fanout);

      const fetched = await Promise.all(
        targets.map(async (t) => ({
          child: await fetchTx(t.s.txid!).catch(() => null),
          voutIndex: t.voutIndex,
          value: t.value,
          address: t.address,
        }))
      );

      for (const item of fetched) {
        if (!item || !item.child) continue;
        ctx.clusters.ingest(item.child);
        // Carry label taint forward to whatever spends this tx's outputs.
        const parentInherited = ctx.inheritedRisk.get(tx.txid) ?? 0;
        if (parentInherited > 0)
          bump(ctx.inheritedRisk, item.child.txid, parentInherited * 0.95);
        addNode(ctx.nodes, item.child, d + 1, ctx.inheritedRisk);
        const edge: GraphEdge = {
          id: `${tx.txid}:${item.voutIndex}>${item.child.txid}`,
          source: tx.txid,
          target: item.child.txid,
          value: item.value,
          address: item.address,
          voutIndex: item.voutIndex,
        };
        ctx.edges.set(edge.id, edge);
        next.push({ tx: item.child, d: d + 1 });
      }
      ctx.nodes.get(tx.txid)!.expandedDown = true;
      ctx.onProgress?.(ctx.nodes.size, next.length);
    }

    if (ctx.maxNodes && ctx.nodes.size >= ctx.maxNodes) break;
    frontier = next;
  }
}

function bump(map: Map<string, number>, key: string, value: number) {
  map.set(key, Math.max(map.get(key) ?? 0, value));
}
