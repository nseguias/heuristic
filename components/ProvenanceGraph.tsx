"use client";

import { useEffect, useRef, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { CATEGORY_META } from "@/lib/screening";
import { riskRamp, C } from "@/lib/colors";
import { formatBtc, truncateHash } from "@/lib/format";
import type { ProvenanceHop } from "@/lib/provenance";

interface SimNode extends ProvenanceHop {
  id: string;
  idx: number;
  r: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}
interface SimLink {
  source: SimNode;
  target: SimNode;
}

function colorFor(h: ProvenanceHop): string {
  if (h.kind === "flagged") return C.taint;
  if (h.kind === "exchange" || h.kind === "coinbase") return C.clean;
  if (h.kind === "mixed" || h.isCoinjoin) return C.mix;
  if (h.category) return riskRamp(CATEGORY_META[h.category].risk * 100);
  return C.dim;
}

function markerFor(h: ProvenanceHop): string | null {
  if (h.kind === "coinbase") return "⛏";
  if (h.kind === "exchange") return "🏦";
  if (h.kind === "flagged") return "⚑";
  if (h.kind === "mixed" || h.isCoinjoin) return "⧓";
  return null;
}

function radiusFor(h: ProvenanceHop, isEnd: boolean): number {
  const btc = (h.valueSat ?? 0) / 1e8;
  const base = Math.max(7, Math.min(15, 6 + 2.4 * Math.sqrt(btc)));
  return isEnd ? base + 3 : base;
}

export default function ProvenanceGraph({ path }: { path: ProvenanceHop[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hoverRef = useRef<SimNode | null>(null);
  const [hover, setHover] = useState<{
    node: SimNode;
    sx: number;
    sy: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || path.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes: SimNode[] = path.map((h, i) => ({
      ...h,
      id: h.txid + i,
      idx: i,
      r: radiusFor(h, i === path.length - 1),
    }));
    const links: SimLink[] = [];
    for (let i = 0; i < nodes.length - 1; i++)
      links.push({ source: nodes[i], target: nodes[i + 1] });

    let W = wrap.clientWidth;
    let H = 340;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      W = wrap.clientWidth;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    };
    resize();

    // Organic, explore-like 2D layout: charge + collision spread the chain so it
    // folds into the available space (a long path becomes a navigable coil, not
    // a microscopic straight line). A weak x-by-index force keeps a gentle
    // left→right drift from the coin toward its origin.
    const spacing = 30;
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("charge", forceManyBody().strength(-160))
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .distance(46)
          .strength(0.5)
      )
      .force("x", forceX<SimNode>((d) => d.idx * spacing).strength(0.06))
      .force("y", forceY<SimNode>(H / 2).strength(0.05))
      .force("collide", forceCollide<SimNode>((d) => d.r + 5))
      .alpha(1)
      .alphaDecay(0.03);
    simRef.current = sim;

    const fit = () => {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, (n.x ?? 0) - n.r);
        maxX = Math.max(maxX, (n.x ?? 0) + n.r);
        minY = Math.min(minY, (n.y ?? 0) - n.r);
        maxY = Math.max(maxY, (n.y ?? 0) + n.r);
      }
      const pad = 96; // room for endpoint labels that extend past node bounds
      const k = Math.min(
        1.1,
        Math.max(
          0.22,
          Math.min((W - pad) / (maxX - minX || 1), (H - pad) / (maxY - minY || 1))
        )
      );
      view.current.k = k;
      view.current.x = W / 2 - ((minX + maxX) / 2) * k;
      view.current.y = H / 2 - ((minY + maxY) / 2) * k;
    };

    let fitted = false;
    const draw = () => {
      const { x: tx, y: ty, k } = view.current;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      ctx.translate(tx, ty);
      ctx.scale(k, k);

      // Edges.
      ctx.lineWidth = 1.4 / k;
      for (const l of links) {
        const a = l.source,
          b = l.target;
        ctx.strokeStyle = "rgba(231,222,202,0.16)";
        ctx.beginPath();
        ctx.moveTo(a.x ?? 0, a.y ?? 0);
        ctx.lineTo(b.x ?? 0, b.y ?? 0);
        ctx.stroke();
      }

      // Nodes.
      const hov = hoverRef.current;
      for (const n of nodes) {
        const color = colorFor(n);
        const hovered = hov?.id === n.id;
        const x = n.x ?? 0,
          y = n.y ?? 0;
        ctx.shadowColor = color;
        ctx.shadowBlur = hovered ? 16 : n.kind !== "tx" ? 12 : 5;
        ctx.beginPath();
        ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = C.surface;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = (hovered ? 2.5 : 1.5) / 1;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, n.r * 0.5, 0, Math.PI * 2);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;

        const m = markerFor(n);
        if (m) {
          ctx.font = `${Math.max(11, n.r) / 1}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(m, x, y + 0.5);
        }
      }

      // Endpoint labels (the coin & the origin).
      ctx.font = "600 11px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = C.dim;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      ctx.fillText("the coin", first.x ?? 0, (first.y ?? 0) - first.r - 8);
      const originLabel =
        last.kind === "exchange"
          ? last.label ?? "exchange"
          : last.kind === "coinbase"
            ? "minted"
            : last.kind === "flagged"
              ? last.label ?? "flagged"
              : last.kind === "mixed"
                ? "coinjoin"
                : "trace cap";
      ctx.fillStyle = colorFor(last);
      ctx.fillText(originLabel, last.x ?? 0, (last.y ?? 0) - last.r - 8);

      ctx.restore();
    };

    let raf = 0;
    const tick = () => {
      if (!fitted && sim.alpha() < 0.6) {
        fit();
        fitted = true;
      }
      draw();
      raf = requestAnimationFrame(tick);
    };
    sim.on("tick", () => {});
    raf = requestAnimationFrame(tick);

    // ── interaction ──────────────────────────────────────────────
    const toGraph = (sx: number, sy: number) => ({
      x: (sx - view.current.x) / view.current.k,
      y: (sy - view.current.y) / view.current.k,
    });
    const nodeAt = (sx: number, sy: number): SimNode | null => {
      const p = toGraph(sx, sy);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = (n.x ?? 0) - p.x,
          dy = (n.y ?? 0) - p.y;
        if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left,
        sy = e.clientY - rect.top;
      if (drag.current) {
        const ddx = e.clientX - drag.current.x;
        const ddy = e.clientY - drag.current.y;
        if (Math.abs(ddx) + Math.abs(ddy) > 3) drag.current.moved = true;
        view.current.x += ddx;
        view.current.y += ddy;
        drag.current.x = e.clientX;
        drag.current.y = e.clientY;
        return;
      }
      const n = nodeAt(sx, sy);
      hoverRef.current = n;
      canvas.style.cursor = n ? "pointer" : "grab";
      setHover(n ? { node: n, sx, sy } : null);
    };
    const onUp = (e: PointerEvent) => {
      const wasDrag = drag.current?.moved;
      drag.current = null;
      if (wasDrag) return;
      const rect = canvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (n) window.open(`/explore?q=${n.txid}`, "_blank", "noopener");
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left,
        sy = e.clientY - rect.top;
      const before = toGraph(sx, sy);
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      view.current.k = Math.max(0.2, Math.min(3, view.current.k * factor));
      const after = toGraph(sx, sy);
      view.current.x += (after.x - before.x) * view.current.k;
      view.current.y += (after.y - before.y) * view.current.k;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      sim.stop();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [path]);

  return (
    <div ref={wrapRef} className="relative mt-2">
      <canvas
        ref={canvasRef}
        className="dotgrid w-full touch-none rounded-[3px] border border-line bg-bg"
        aria-label="Source-of-funds trace graph"
      />
      <span className="pointer-events-none absolute bottom-1.5 right-2 font-mono text-[10px] text-faint">
        drag · scroll to zoom · click a node →
      </span>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-[3px] border border-line-strong bg-surface px-2 py-1.5 font-mono text-[11px] shadow-lg"
          style={{
            left: Math.min(hover.sx + 12, (wrapRef.current?.clientWidth ?? 300) - 150),
            top: hover.sy + 12,
          }}
        >
          <div className="text-dim">
            {hover.node.blockHeight
              ? `#${hover.node.blockHeight.toLocaleString()}`
              : "mempool"}
            {hover.node.blockTime
              ? ` · ${new Date(hover.node.blockTime * 1000).getUTCFullYear()}`
              : ""}
          </div>
          <div className="text-faint">{truncateHash(hover.node.txid, 10)}</div>
          {hover.node.valueSat != null && (
            <div className="text-accent">{formatBtc(hover.node.valueSat)} BTC</div>
          )}
          {hover.node.label && (
            <div style={{ color: colorFor(hover.node) }}>{hover.node.label}</div>
          )}
        </div>
      )}
    </div>
  );
}
