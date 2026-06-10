"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { C, nodeColor, RISK_LABEL } from "@/lib/colors";
import { formatBtc, truncateHash } from "@/lib/format";
import { AddressClusters } from "@/lib/cluster";
import type { GraphEdge, GraphNode, TraceGraph } from "@/lib/types";

interface SimNode extends GraphNode {
  r: number;
}
interface SimEdge {
  source: SimNode;
  target: SimNode;
  raw: GraphEdge;
}

export interface GraphControls {
  fit: () => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
}

interface HoverInfo {
  node: SimNode;
  screenX: number;
  screenY: number;
  canvasW: number;
  canvasH: number;
}

interface Props {
  graph: TraceGraph;
  selected: string | null;
  onSelect: (txid: string | null) => void;
  onRecenter: (txid: string) => void;
  controls?: React.MutableRefObject<GraphControls | null>;
}

const RADIUS_MIN = 5;
const RADIUS_MAX = 22;

export default function GraphCanvas({
  graph,
  selected,
  onSelect,
  onRecenter,
  controls,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<SimNode | null>(null);
  const selectedRef = useRef<string | null>(selected);
  const dprRef = useRef(1);
  const needsFit = useRef(true);
  const fitTick = useRef(0);
  const clustersRef = useRef<AddressClusters>(new AddressClusters());

  const [hover, setHover] = useState<HoverInfo | null>(null);

  selectedRef.current = selected;

  // Rebuild the clusters helper (used for the inspector's coloured ·TAGs).
  useEffect(() => {
    const c = new AddressClusters();
    for (const [addr, root] of graph.addressCluster) c.union(addr, root);
    clustersRef.current = c;
  }, [graph]);

  const rebuild = useCallback(() => {
    const values = [...graph.nodes.values()].map((n) =>
      n.tx.vout.reduce((s, v) => s + v.value, 0)
    );
    const maxV = Math.max(1, ...values);
    const nodes: SimNode[] = [...graph.nodes.values()].map((n) => {
      const total = n.tx.vout.reduce((s, v) => s + v.value, 0);
      const r = RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * Math.sqrt(total / maxV);
      const existing = nodesRef.current.find((p) => p.id === n.id);
      return Object.assign(n, {
        r,
        x: existing?.x ?? n.depth * 140 + Math.sin(n.id.charCodeAt(0)) * 40,
        y: existing?.y ?? (n.id.charCodeAt(1) % 20) * 18 - 180,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
      }) as SimNode;
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: SimEdge[] = [...graph.edges.values()]
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({
        source: byId.get(e.source)!,
        target: byId.get(e.target)!,
        raw: e,
      }));
    nodesRef.current = nodes;
    edgesRef.current = edges;
    return { nodes, edges };
  }, [graph]);

  // ── Fit-to-view: frame all nodes with padding ──────────────────
  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    const nodes = nodesRef.current;
    if (!canvas || !nodes.length) return;
    const rect = canvas.getBoundingClientRect();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      minX = Math.min(minX, x - n.r - 40); // allow for side labels
      minY = Math.min(minY, y - n.r);
      maxX = Math.max(maxX, x + n.r + 40);
      maxY = Math.max(maxY, y + n.r + 22); // labels hang below the node
    }
    const pad = 56;
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const k = Math.max(
      0.2,
      Math.min(2, Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h))
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    view.current.k = k;
    view.current.x = rect.width / 2 - cx * k;
    view.current.y = rect.height / 2 - cy * k;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { nodes, edges } = rebuild();
    // New graph → schedule an auto-fit once the layout spreads out.
    needsFit.current = true;
    fitTick.current = 0;

    const sim = forceSimulation<SimNode>(nodes)
      .force("charge", forceManyBody<SimNode>().strength(-360).distanceMax(640))
      .force(
        "link",
        forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance(130)
          .strength(0.35)
      )
      // Extra collision radius reserves room for each node's label.
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 26))
      .force("x", forceX<SimNode>((d) => d.depth * 230).strength(0.32))
      .force("y", forceY<SimNode>(0).strength(0.05))
      .alpha(0.95)
      .alphaDecay(0.022);

    simRef.current = sim;
    sim.on("tick", () => {
      if (needsFit.current) {
        fitTick.current += 1;
        // Frame early for responsiveness, then refit once the layout has
        // actually settled (low alpha) — fitting too early was why edge nodes
        // ended up clipped after the layout kept expanding.
        if (fitTick.current === 18) fitView();
        if (sim.alpha() < 0.045) {
          fitView();
          needsFit.current = false;
        }
      }
      draw();
    });
    sim.on("end", () => {
      if (needsFit.current) {
        needsFit.current = false;
        fitView();
      }
    });

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuild, fitView]);

  // ── Rendering ──────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = dprRef.current;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(view.current.x, view.current.y);
    ctx.scale(view.current.k, view.current.k);

    const edges = edgesRef.current;
    const nodes = nodesRef.current;
    const sel = selectedRef.current;
    const hov = hoverRef.current;

    // Hover spotlight: when a node is hovered, everything not directly connected
    // to it dims, so its actual participants stand out from nearby/overlapping
    // nodes that aren't involved.
    const focus = new Set<string>();
    if (hov) {
      focus.add(hov);
      for (const e of edges) {
        if (e.source.id === hov) focus.add(e.target.id);
        else if (e.target.id === hov) focus.add(e.source.id);
      }
    }
    const DIM = 0.1;
    const edgeAlpha = (e: SimEdge) =>
      !hov || e.source.id === hov || e.target.id === hov ? 1 : DIM;
    const nodeAlpha = (id: string) => (!hov || focus.has(id) ? 1 : DIM);

    for (const e of edges) {
      const sx = e.source.x ?? 0;
      const sy = e.source.y ?? 0;
      const tx = e.target.x ?? 0;
      const ty = e.target.y ?? 0;
      const active =
        sel === e.source.id ||
        sel === e.target.id ||
        hov === e.source.id ||
        hov === e.target.id;

      // An edge is a "change" flow when the funding tx's change heuristic points
      // at exactly the output this edge spends.
      const ch = e.source.analysis.change;
      const isChange =
        e.source.tx.vout.length === 2 &&
        ch.changeIndex === e.raw.voutIndex &&
        ch.confidence >= 0.5;

      ctx.globalAlpha = edgeAlpha(e);
      // Uniform thin lines — bubble sizes already convey the amounts.
      const width = active ? 1.6 : 1.1;
      ctx.beginPath();
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2 - Math.abs(tx - sx) * 0.08;
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, tx, ty);
      ctx.lineWidth = width;
      if (active) {
        // Cool blue-grey for highlighted flow so the orange BTC labels stand
        // out against the lines instead of blending into them.
        ctx.strokeStyle = "rgba(120,170,190,0.55)";
        ctx.shadowColor = "rgba(120,170,190,0.8)";
        ctx.shadowBlur = 7;
      } else if (isChange) {
        // Dashed amber = likely self-change, not a payment to a third party.
        ctx.strokeStyle = "rgba(224,164,88,0.45)";
        ctx.setLineDash([4, 3]);
      } else {
        ctx.strokeStyle = "rgba(150,165,180,0.16)";
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);

      const ang = Math.atan2(ty - my, tx - mx);
      const ax = tx - Math.cos(ang) * (e.target.r + 3);
      const ay = ty - Math.sin(ang) * (e.target.r + 3);
      ctx.beginPath();
      ctx.fillStyle = active
        ? "rgba(120,170,190,0.8)"
        : "rgba(150,165,180,0.28)";
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - Math.cos(ang - 0.4) * 6, ay - Math.sin(ang - 0.4) * 6);
      ctx.lineTo(ax - Math.cos(ang + 0.4) * 6, ay - Math.sin(ang + 0.4) * 6);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const n of nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const color = nodeColor(n.analysis);
      const isSel = sel === n.id;
      const isHover = hov === n.id;
      const isOrigin = n.id === graph.origin;
      const na = nodeAlpha(n.id);
      ctx.globalAlpha = na;

      if (isSel || isOrigin || n.analysis.riskBand === "critical") {
        ctx.beginPath();
        ctx.arc(x, y, n.r + 7, 0, Math.PI * 2);
        ctx.fillStyle = isSel
          ? "rgba(245,166,35,0.16)"
          : n.analysis.riskBand === "critical"
            ? "rgba(228,87,46,0.16)"
            : "rgba(245,166,35,0.10)";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = C.surface;
      ctx.fill();
      ctx.lineWidth = isSel || isHover ? 2.5 : 1.5;
      ctx.strokeStyle = color;
      if (isSel || isHover) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(x, y, n.r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = na * 0.5;
      ctx.fill();
      ctx.globalAlpha = na;

      if (n.analysis.coinjoin.isCoinjoin) {
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.arc(x, y, n.r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = C.mix;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Origin marker ring.
      if (isOrigin) {
        ctx.beginPath();
        ctx.arc(x, y, n.r + 9, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(245,166,35,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Selected node: an unmistakable bright accent ring so it's obvious which
      // transaction is in focus.
      if (isSel) {
        ctx.beginPath();
        ctx.arc(x, y, n.r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }


      // Coinbase = newly mined; there is nothing behind it. Mark it as a
      // terminal root with a solid green base wedge + pick glyph.
      if (n.tx.vin.some((v) => v.is_coinbase)) {
        ctx.beginPath();
        ctx.arc(x, y, n.r + 3, Math.PI * 0.15, Math.PI * 0.85);
        ctx.strokeStyle = C.clean;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = C.clean;
        ctx.font = "bold 9px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText("⛏", x, y - n.r - 6);
      }

      ctx.globalAlpha = 1;
    }

    // Label pass — drawn AFTER all nodes/edges so labels are always on top
    // (never covered by a bubble) and sit on a dark plate so they read over the
    // orange flow lines instead of blending into them.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "500 8px 'IBM Plex Mono', monospace";
    for (const n of nodes) {
      const isSel = sel === n.id;
      const isHover = hov === n.id;
      // While hovering, only label the spotlighted nodes.
      if (hov && !focus.has(n.id)) continue;
      if (!(isSel || isHover || view.current.k > 1.4)) continue;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const entity = n.analysis.labels[0];
      const total = n.tx.vout.reduce((s, v) => s + v.value, 0);
      const text = entity
        ? entity.name.length > 30
          ? entity.name.slice(0, 29) + "…"
          : entity.name
        : `${formatBtc(total)} BTC`;
      const color = entity
        ? entity.risk > 0.5
          ? C.taint
          : C.clean
        : C.accent;
      const ly = y + n.r + 12;
      const tw = ctx.measureText(text).width;
      // Backing plate.
      ctx.fillStyle = "rgba(9,8,6,0.82)";
      ctx.beginPath();
      ctx.roundRect(x - tw / 2 - 5, ly - 7, tw + 10, 14, 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(text, x, ly);
    }
    ctx.textBaseline = "alphabetic";

    ctx.restore();
  }, [graph.origin]);

  // Expose imperative controls to the parent.
  useEffect(() => {
    if (!controls) return;
    controls.current = {
      fit: () => fitView(),
      zoomBy: (factor: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const k = Math.max(0.2, Math.min(5, view.current.k * factor));
        view.current.x = cx - (cx - view.current.x) * (k / view.current.k);
        view.current.y = cy - (cy - view.current.y) * (k / view.current.k);
        view.current.k = k;
        draw();
      },
      reset: () => fitView(),
    };
    return () => {
      if (controls) controls.current = null;
    };
  }, [controls, fitView, draw]);

  // ── Canvas sizing ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dprRef.current = dpr;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fitView();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [fitView]);

  // ── Interaction ────────────────────────────────────────────────
  const screenToWorld = (sx: number, sy: number) => ({
    x: (sx - view.current.x) / view.current.k,
    y: (sy - view.current.y) / view.current.k,
  });

  const hitTest = (sx: number, sy: number): SimNode | null => {
    const p = screenToWorld(sx, sy);
    let hit: SimNode | null = null;
    for (const n of nodesRef.current) {
      const dx = (n.x ?? 0) - p.x;
      const dy = (n.y ?? 0) - p.y;
      if (dx * dx + dy * dy <= (n.r + 5) ** 2) hit = n;
    }
    return hit;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let panning = false;
    let last = { x: 0, y: 0 };
    let moved = false;

    const rel = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: MouseEvent) => {
      const p = rel(e);
      const node = hitTest(p.x, p.y);
      moved = false;
      if (node) {
        dragRef.current = node;
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.2).restart();
      } else {
        panning = true;
        last = p;
      }
    };

    const onMove = (e: MouseEvent) => {
      const p = rel(e);
      if (dragRef.current) {
        const w = screenToWorld(p.x, p.y);
        dragRef.current.fx = w.x;
        dragRef.current.fy = w.y;
        moved = true;
        return;
      }
      if (panning) {
        view.current.x += p.x - last.x;
        view.current.y += p.y - last.y;
        last = p;
        moved = true;
        setHover(null);
        draw();
        return;
      }
      const node = hitTest(p.x, p.y);
      const id = node?.id ?? null;
      const r = canvas.getBoundingClientRect();
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        canvas.style.cursor = id ? "pointer" : "grab";
        setHover(
          node
            ? { node, screenX: p.x, screenY: p.y, canvasW: r.width, canvasH: r.height }
            : null
        );
        draw();
      } else if (node) {
        // Same node — just reposition the tooltip.
        setHover({ node, screenX: p.x, screenY: p.y, canvasW: r.width, canvasH: r.height });
      }
    };

    // Single click locks the selection (persists in the inspector even as the
    // mouse moves away); double-click re-centres the trace on the node.
    const pick = (node: SimNode | null) => onSelect(node?.id ?? null);

    const onUp = (e: MouseEvent) => {
      if (dragRef.current) {
        const n = dragRef.current;
        n.fx = null;
        n.fy = null;
        dragRef.current = null;
        simRef.current?.alphaTarget(0);
        if (!moved) pick(n);
      } else if (panning && !moved) {
        const p = rel(e);
        pick(hitTest(p.x, p.y));
      }
      panning = false;
    };

    const onDblClick = (e: MouseEvent) => {
      const p = rel(e);
      const node = hitTest(p.x, p.y);
      if (node && node.id !== graph.origin) onRecenter(node.id);
    };

    const onLeave = () => {
      hoverRef.current = null;
      setHover(null);
      draw();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = rel(e);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const k = Math.max(0.2, Math.min(5, view.current.k * factor));
      view.current.x = p.x - (p.x - view.current.x) * (k / view.current.k);
      view.current.y = p.y - (p.y - view.current.y) * (k / view.current.k);
      view.current.k = k;
      setHover(null);
      draw();
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [draw, onSelect, onRecenter, graph.origin]);

  useEffect(() => {
    draw();
  }, [selected, draw]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="dotgrid h-full w-full cursor-grab touch-none"
        aria-label="Transaction flow graph"
      />
      {hover && <HoverCard info={hover} clusters={clustersRef.current} origin={graph.origin} />}
    </>
  );
}

function HoverCard({
  info,
  clusters,
  origin,
}: {
  info: HoverInfo;
  clusters: AddressClusters;
  origin: string;
}) {
  const { node } = info;
  const { tx, analysis } = node;
  const totalOut = tx.vout.reduce((s, v) => s + v.value, 0);
  const totalIn = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
  const color = nodeColor(analysis);
  const firstAddr =
    tx.vin[0]?.prevout?.scriptpubkey_address ??
    tx.vout[0]?.scriptpubkey_address;
  const clusterTag = firstAddr ? clusters.clusterTag(firstAddr) : null;
  const isCoinbase = tx.vin.some((v) => v.is_coinbase);

  // Pinned to a fixed corner (never follows the cursor) so it can't cover the
  // node being inspected or its neighbours. The spotlight does the highlighting.
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 w-60 rounded-[3px] border border-line-strong bg-surface/95 p-3 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: color, boxShadow: `0 0 6px ${color}` }}
          />
          <span className="font-mono text-[12px] text-ink">
            {truncateHash(node.id, 6)}
          </span>
        </span>
        {node.id === origin ? (
          <span className="font-mono text-[9px] uppercase tracking-wider text-accent">
            origin
          </span>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wider text-faint">
            hop {node.depth > 0 ? `+${node.depth}` : node.depth}
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px]">
        <Cell label="risk">
          <span style={{ color }}>
            {Math.round(analysis.risk)} · {RISK_LABEL[analysis.riskBand]}
          </span>
        </Cell>
        <Cell label="cluster">{clusterTag ? `·${clusterTag}` : "—"}</Cell>
        <Cell label="value out">
          <span style={{ color: "var(--accent)" }}>{formatBtc(totalOut)}</span>
        </Cell>
        <Cell label="value in">
          <span style={{ color: "var(--accent)" }}>{formatBtc(totalIn)}</span>
        </Cell>
        <Cell label="inputs">{tx.vin.length}</Cell>
        <Cell label="outputs">{tx.vout.length}</Cell>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {isCoinbase && <Tag color={C.clean}>⛏ coinbase</Tag>}
        {analysis.coinjoin.isCoinjoin && <Tag color={C.mix}>coinjoin</Tag>}
        {analysis.isPeelChain && <Tag color={C.warn}>peel</Tag>}
        {analysis.isConsolidation && <Tag color={C.dim}>consolidation</Tag>}
        {analysis.labels.map((l) => (
          <Tag key={l.name} color={l.risk > 0.5 ? C.taint : C.clean}>
            {l.name}
          </Tag>
        ))}
      </div>

      <div className="mt-2 border-t border-line pt-1.5 font-mono text-[10px] text-faint">
        {isCoinbase
          ? "newly mined — no ancestry behind this"
          : "click to lock · double-click to re-center"}
      </div>
    </div>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-[9px] uppercase tracking-wider text-faint">
        {label}
      </span>
      <span className="text-ink/90">{children}</span>
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
      style={{
        color,
        background: `color-mix(in oklch, ${color} 16%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
