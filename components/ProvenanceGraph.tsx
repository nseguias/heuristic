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

interface GNode {
  id: string;
  txid: string;
  isSpine: boolean;
  idx: number; // spine index (or owning spine index for a branch)
  r: number;
  color: string;
  marker?: string | null;
  label?: string;
  valueSat?: number;
  blockHeight?: number;
  blockTime?: number;
  endLabel?: string; // "the coin" / origin name, drawn as a caption
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}
interface GLink {
  source: GNode;
  target: GNode;
  spine: boolean;
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
function rOf(valueSat: number | undefined, isEnd: boolean): number {
  const btc = (valueSat ?? 0) / 1e8;
  const base = Math.max(7, Math.min(15, 6 + 2.4 * Math.sqrt(btc)));
  return isEnd ? base + 3 : base;
}

const SPACING = 60;
const BRANCH_BUDGET = 90;

export default function ProvenanceGraph({ path }: { path: ProvenanceHop[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const panned = useRef(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hoverRef = useRef<GNode | null>(null);
  const [hover, setHover] = useState<{ node: GNode; sx: number; sy: number } | null>(
    null
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || path.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const last = path.length - 1;
    // Spine: the coin (idx 0, newest) on the RIGHT, origin (last, oldest) on the
    // LEFT, so the money flows left→right into the coin you're checking.
    const spine: GNode[] = path.map((h, i) => ({
      id: "s" + i,
      txid: h.txid,
      isSpine: true,
      idx: i,
      r: rOf(h.valueSat, i === last),
      color: colorFor(h),
      marker: markerFor(h),
      label: h.label,
      valueSat: h.valueSat,
      blockHeight: h.blockHeight,
      blockTime: h.blockTime,
      endLabel:
        i === 0
          ? "the coin"
          : i === last
            ? h.kind === "exchange"
              ? h.label ?? "exchange"
              : h.kind === "coinbase"
                ? "minted ⛏"
                : h.kind === "flagged"
                  ? h.label ?? "flagged"
                  : h.kind === "mixed"
                    ? "coinjoin ⧓"
                    : "trace cap"
            : undefined,
    }));

    const branchNodes: GNode[] = [];
    const links: GLink[] = [];
    for (let i = 0; i < spine.length - 1; i++)
      links.push({ source: spine[i + 1], target: spine[i], spine: true });

    let budget = BRANCH_BUDGET;
    for (let i = 0; i < path.length && budget > 0; i++) {
      for (const br of (path[i].branches ?? []).slice(0, 3)) {
        if (budget-- <= 0) break;
        const bn: GNode = {
          id: "b" + i + "_" + br.txid,
          txid: br.txid,
          isSpine: false,
          idx: i,
          r: Math.max(4, Math.min(9, 4 + 1.7 * Math.sqrt(br.valueSat / 1e8))),
          color: br.category
            ? riskRamp(CATEGORY_META[br.category].risk * 100)
            : C.faint,
          label: br.label,
          valueSat: br.valueSat,
        };
        branchNodes.push(bn);
        links.push({ source: bn, target: spine[i], spine: false });
      }
    }
    const nodes = [...spine, ...branchNodes];

    let W = wrap.clientWidth;
    const H = 360;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      W = wrap.clientWidth;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    };
    resize();

    const sim = forceSimulation<GNode, GLink>(nodes)
      .force("charge", forceManyBody().strength(-130))
      .force(
        "link",
        forceLink<GNode, GLink>(links)
          .distance((l) => (l.spine ? 50 : 26))
          .strength((l) => (l.spine ? 0.6 : 0.4))
      )
      .force(
        "x",
        forceX<GNode>((d) => (d.isSpine ? (last - d.idx) * SPACING : 0)).strength(
          (d) => (d.isSpine ? 0.14 : 0)
        )
      )
      .force("y", forceY<GNode>(H / 2).strength(0.04))
      .force("collide", forceCollide<GNode>((d) => d.r + 4))
      .alpha(1)
      .alphaDecay(0.028);
    simRef.current = sim;

    const fit = () => {
      let a = Infinity,
        bx = -Infinity,
        c = Infinity,
        d = -Infinity;
      for (const n of nodes) {
        a = Math.min(a, (n.x ?? 0) - n.r);
        bx = Math.max(bx, (n.x ?? 0) + n.r);
        c = Math.min(c, (n.y ?? 0) - n.r);
        d = Math.max(d, (n.y ?? 0) + n.r);
      }
      const pad = 110; // room for endpoint captions
      const k = Math.min(
        1.1,
        Math.max(0.18, Math.min((W - pad) / (bx - a || 1), (H - pad) / (d - c || 1)))
      );
      view.current.k = k;
      view.current.x = W / 2 - ((a + bx) / 2) * k;
      view.current.y = H / 2 - ((c + d) / 2) * k;
    };

    const arrow = (ax: number, ay: number, b: GNode, color: string) => {
      const bx = b.x ?? 0,
        by = b.y ?? 0;
      const dx = bx - ax,
        dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len,
        uy = dy / len;
      const tipX = bx - ux * (b.r + 1.5),
        tipY = by - uy * (b.r + 1.5);
      const s = 5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - ux * s - uy * s * 0.55, tipY - uy * s + ux * s * 0.55);
      ctx.lineTo(tipX - ux * s + uy * s * 0.55, tipY - uy * s - ux * s * 0.55);
      ctx.closePath();
      ctx.fill();
    };

    const draw = () => {
      const { x: tx, y: ty, k } = view.current;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      ctx.translate(tx, ty);
      ctx.scale(k, k);

      // Edges + flow arrows (money flows source→target, toward the coin).
      for (const l of links) {
        const a = l.source,
          b = l.target;
        const col = l.spine ? "rgba(231,222,202,0.22)" : "rgba(231,222,202,0.10)";
        ctx.strokeStyle = col;
        ctx.lineWidth = (l.spine ? 1.5 : 1) / k;
        ctx.beginPath();
        ctx.moveTo(a.x ?? 0, a.y ?? 0);
        ctx.lineTo(b.x ?? 0, b.y ?? 0);
        ctx.stroke();
        if (l.spine || b.isSpine)
          arrow(a.x ?? 0, a.y ?? 0, b, l.spine ? "rgba(231,222,202,0.4)" : col);
      }

      // Branch nodes (small).
      const hov = hoverRef.current;
      for (const n of branchNodes) {
        const x = n.x ?? 0,
          y = n.y ?? 0;
        const hovered = hov?.id === n.id;
        ctx.beginPath();
        ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = C.surface;
        ctx.fill();
        ctx.lineWidth = (hovered ? 2 : 1.2) / 1;
        ctx.strokeStyle = n.color;
        ctx.globalAlpha = n.label ? 1 : 0.75;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Spine nodes (explore style).
      for (const n of spine) {
        const x = n.x ?? 0,
          y = n.y ?? 0;
        const hovered = hov?.id === n.id;
        ctx.shadowColor = n.color;
        ctx.shadowBlur = hovered ? 16 : n.endLabel ? 12 : 5;
        ctx.beginPath();
        ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = C.surface;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = hovered ? 2.5 : 1.5;
        ctx.strokeStyle = n.color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, n.r * 0.5, 0, Math.PI * 2);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (n.marker) {
          ctx.font = `${Math.max(11, n.r)}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(n.marker, x, y + 0.5);
        }
      }
      ctx.restore();

      // Endpoint captions in screen space (clamped so they never clip).
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.font = "600 11px 'IBM Plex Mono', monospace";
      ctx.textBaseline = "alphabetic";
      for (const n of spine) {
        if (!n.endLabel) continue;
        const sx = (n.x ?? 0) * k + tx;
        const sy = (n.y ?? 0) * k + ty;
        ctx.fillStyle = n.idx === 0 ? C.dim : n.color;
        ctx.textAlign = "center";
        const cx = Math.max(48, Math.min(W - 48, sx));
        ctx.fillText(n.endLabel, cx, sy - n.r * k - 7);
      }
      ctx.restore();
    };

    let raf = 0;
    const tick = () => {
      if (!panned.current && sim.alpha() > 0.04) fit();
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ── interaction ──────────────────────────────────────────────
    const toGraph = (sx: number, sy: number) => ({
      x: (sx - view.current.x) / view.current.k,
      y: (sy - view.current.y) / view.current.k,
    });
    const nodeAt = (sx: number, sy: number): GNode | null => {
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
        if (Math.abs(ddx) + Math.abs(ddy) > 3) {
          drag.current.moved = true;
          panned.current = true;
        }
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
      panned.current = true;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left,
        sy = e.clientY - rect.top;
      const before = toGraph(sx, sy);
      view.current.k = Math.max(
        0.15,
        Math.min(3, view.current.k * (e.deltaY < 0 ? 1.12 : 0.89))
      );
      const after = toGraph(sx, sy);
      view.current.x += (after.x - before.x) * view.current.k;
      view.current.y += (after.y - before.y) * view.current.k;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(() => {
      resize();
      panned.current = false;
    });
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
        aria-label="Source-of-funds money-flow graph"
      />
      <span className="pointer-events-none absolute bottom-1.5 left-2 font-mono text-[10px] text-faint">
        → flows into the coin · branches = other inputs that merged
      </span>
      <span className="pointer-events-none absolute bottom-1.5 right-2 font-mono text-[10px] text-faint">
        drag · zoom · click →
      </span>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-[3px] border border-line-strong bg-surface px-2 py-1.5 font-mono text-[11px] shadow-lg"
          style={{
            left: Math.min(hover.sx + 12, (wrapRef.current?.clientWidth ?? 300) - 160),
            top: Math.min(hover.sy + 12, 300),
          }}
        >
          <div className="text-dim">
            {hover.node.isSpine ? "dominant path" : "merged input"}
            {hover.node.blockHeight
              ? ` · #${hover.node.blockHeight.toLocaleString()}`
              : ""}
          </div>
          <div className="text-faint">{truncateHash(hover.node.txid, 10)}</div>
          {hover.node.valueSat != null && (
            <div className="text-accent">{formatBtc(hover.node.valueSat)} BTC</div>
          )}
          {hover.node.label && (
            <div style={{ color: hover.node.color }}>{hover.node.label}</div>
          )}
        </div>
      )}
    </div>
  );
}
