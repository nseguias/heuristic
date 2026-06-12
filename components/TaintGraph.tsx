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
import type { TaintResult } from "@/lib/taint";

interface GN {
  id: string;
  txid: string;
  kind: string;
  category?: string;
  label?: string;
  contribution: number;
  blockTime?: number;
  isSeed?: boolean;
  isTerminal?: boolean;
  r: number;
  color: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}
interface GL {
  source: GN;
  target: GN;
  value: number;
}

function catColor(cat?: string): string {
  if (!cat) return C.dim;
  if (cat === "mixed") return C.mix;
  if (cat === "coinbase") return C.clean;
  if (cat === "unresolved") return C.faint;
  if (cat === "frontier") return C.accent;
  const meta = CATEGORY_META[cat as keyof typeof CATEGORY_META];
  return meta ? riskRamp(meta.risk * 100) : C.dim;
}

export default function TaintGraph({ taint }: { taint: TaintResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<GN, GL> | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const panned = useRef(false);
  // Remember node positions across crawls so the tree GROWS (new ancestors slot
  // in on the input side) instead of re-shuffling on every update.
  const posCache = useRef<{ seed: string; pos: Map<string, { x: number; y: number }> }>({
    seed: "",
    pos: new Map(),
  });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hoverRef = useRef<GN | null>(null);
  const [hover, setHover] = useState<{ n: GN; sx: number; sy: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── build nodes/edges from the taint graph ───────────────────
    const byId = new Map<string, GN>();
    const ensure = (
      id: string,
      base: Partial<GN> & { contribution: number }
    ): GN => {
      let n = byId.get(id);
      if (!n) {
        const kind = base.kind ?? "tx";
        const cat =
          base.category ??
          (kind === "coinbase" || kind === "mixed" || kind === "unresolved" || kind === "frontier"
            ? kind
            : undefined);
        n = {
          id,
          txid: base.txid ?? id,
          kind,
          category: cat,
          label: base.label,
          contribution: base.contribution,
          blockTime: base.blockTime,
          isTerminal: base.isTerminal,
          r: 0,
          color: catColor(cat),
        };
        byId.set(id, n);
      }
      return n;
    };

    for (const tn of taint.graph.nodes)
      ensure(tn.txid, {
        txid: tn.txid,
        kind: tn.kind,
        category: tn.category,
        label: tn.label,
        contribution: tn.contribution,
        blockTime: tn.blockTime,
      });

    for (const e of taint.graph.edges) {
      // Label terminals appear only as edge sources (id "L:cat:name").
      if (e.from.startsWith("L:")) {
        const parts = e.from.split(":");
        const cat = parts[1];
        const name = parts.slice(2).join(":");
        const n = ensure(e.from, {
          txid: e.from,
          kind: cat,
          category: cat,
          label: name,
          contribution: 0,
          isTerminal: true,
        });
        n.contribution += e.value;
      }
    }
    const seedNode = byId.get(taint.seed);
    if (seedNode) seedNode.isSeed = true;

    // Cap for legibility: keep the most material nodes + all terminals/frontier.
    const all = [...byId.values()];
    all.forEach((n) => {
      n.isTerminal =
        n.kind === "coinbase" ||
        n.kind === "mixed" ||
        n.kind === "unresolved" ||
        (n.category != null && n.kind !== "tx" && n.kind !== "frontier") ||
        n.id.startsWith("L:");
    });
    const keep = new Set<string>();
    all.forEach((n) => {
      if (n.isSeed || n.isTerminal) keep.add(n.id);
    });
    // Frontier tips are "more to crawl" — show only the most material few so they
    // don't bury the resolved structure in a blob.
    all
      .filter((n) => n.kind === "frontier")
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 40)
      .forEach((n) => keep.add(n.id));
    // Fill remaining budget with the highest-value intermediate tx nodes.
    all
      .filter((n) => n.kind === "tx" && !n.isSeed && !n.isTerminal)
      .sort((a, b) => b.contribution - a.contribution)
      .forEach((n) => {
        if (keep.size < 240) keep.add(n.id);
      });

    const nodes = all.filter((n) => keep.has(n.id));
    // New seed → fresh layout; otherwise reuse remembered positions so existing
    // nodes stay put and only the newly-crawled ancestors animate in.
    if (posCache.current.seed !== taint.seed)
      posCache.current = { seed: taint.seed, pos: new Map() };
    const cache = posCache.current.pos;
    const hadCache = cache.size > 0;
    for (const n of nodes) {
      const btc = n.contribution * (taint.totalSat / 1e8);
      n.r = n.isSeed
        ? 13
        : Math.max(4.5, Math.min(15, 4.5 + 2.3 * Math.sqrt(Math.max(0, btc))));
      const c = cache.get(n.id);
      if (c) {
        n.x = c.x;
        n.y = c.y;
      }
    }
    const links: GL[] = [];
    for (const e of taint.graph.edges) {
      const s = byId.get(e.from);
      const t = byId.get(e.to);
      if (s && t && keep.has(s.id) && keep.has(t.id))
        links.push({ source: s, target: t, value: e.value });
    }

    // Temporal x: oldest (origins) left, the coin (newest) right.
    let minT = Infinity,
      maxT = -Infinity;
    for (const n of nodes)
      if (n.blockTime) {
        minT = Math.min(minT, n.blockTime);
        maxT = Math.max(maxT, n.blockTime);
      }
    if (!isFinite(minT)) {
      minT = 0;
      maxT = 1;
    }
    const span = maxT - minT || 1;
    const SPREAD = 620;
    const xFor = (n: GN) =>
      n.blockTime ? ((n.blockTime - minT) / span) * SPREAD : -40; // label/origin nodes far left

    let W = wrap.clientWidth;
    const H = 380;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      W = wrap.clientWidth;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    };
    resize();

    const sim = forceSimulation<GN, GL>(nodes)
      .force("charge", forceManyBody().strength(-90))
      .force(
        "link",
        forceLink<GN, GL>(links)
          .distance(34)
          .strength(0.45)
      )
      .force("x", forceX<GN>((d) => xFor(d)).strength(0.5))
      .force("y", forceY<GN>(H / 2).strength(0.05))
      .force("collide", forceCollide<GN>((d) => d.r + 3))
      .alpha(hadCache ? 0.5 : 1) // gentler re-settle when growing an existing tree
      .alphaDecay(0.03);
    simRef.current = sim;

    const fit = () => {
      let a = Infinity,
        b = -Infinity,
        c = Infinity,
        d = -Infinity;
      for (const n of nodes) {
        a = Math.min(a, (n.x ?? 0) - n.r);
        b = Math.max(b, (n.x ?? 0) + n.r);
        c = Math.min(c, (n.y ?? 0) - n.r);
        d = Math.max(d, (n.y ?? 0) + n.r);
      }
      const pad = 110;
      const k = Math.min(
        1.1,
        Math.max(0.16, Math.min((W - pad) / (b - a || 1), (H - pad) / (d - c || 1)))
      );
      view.current.k = k;
      view.current.x = W / 2 - ((a + b) / 2) * k;
      view.current.y = H / 2 - ((c + d) / 2) * k;
    };

    const arrowTo = (ax: number, ay: number, t: GN) => {
      const bx = t.x ?? 0,
        by = t.y ?? 0;
      const dx = bx - ax,
        dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len,
        uy = dy / len;
      const tx = bx - ux * (t.r + 1.5),
        ty = by - uy * (t.r + 1.5);
      const s = 4.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ux * s - uy * s * 0.55, ty - uy * s + ux * s * 0.55);
      ctx.lineTo(tx - ux * s + uy * s * 0.55, ty - uy * s - ux * s * 0.55);
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

      ctx.lineWidth = 1 / k;
      for (const l of links) {
        ctx.strokeStyle = "rgba(231,222,202,0.13)";
        ctx.beginPath();
        ctx.moveTo(l.source.x ?? 0, l.source.y ?? 0);
        ctx.lineTo(l.target.x ?? 0, l.target.y ?? 0);
        ctx.stroke();
        ctx.fillStyle = "rgba(231,222,202,0.28)";
        arrowTo(l.source.x ?? 0, l.source.y ?? 0, l.target);
      }

      const hov = hoverRef.current;
      for (const n of nodes) {
        const x = n.x ?? 0,
          y = n.y ?? 0;
        const hovered = hov?.id === n.id;
        ctx.shadowColor = n.color;
        ctx.shadowBlur = hovered ? 16 : n.isTerminal || n.isSeed ? 11 : 4;
        ctx.beginPath();
        ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = C.surface;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = hovered ? 2.4 : n.isTerminal || n.isSeed ? 1.8 : 1.2;
        // Frontier tips are dashed (not yet traced).
        if (n.kind === "frontier") ctx.setLineDash([3, 2]);
        ctx.strokeStyle = n.color;
        ctx.stroke();
        ctx.setLineDash([]);
        if (n.isTerminal || n.isSeed) {
          ctx.beginPath();
          ctx.arc(x, y, n.r * 0.45, 0, Math.PI * 2);
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = n.color;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();

      // Captions for the coin + named terminals, in clamped screen space.
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.font = "600 10px 'IBM Plex Mono', monospace";
      for (const n of nodes) {
        const cap = n.isSeed
          ? "the coin"
          : n.label
            ? n.label
            : n.kind === "coinbase"
              ? "⛏ mined"
              : n.kind === "frontier"
                ? null
                : null;
        if (!cap) continue;
        const sx = (n.x ?? 0) * k + tx;
        const sy = (n.y ?? 0) * k + ty;
        ctx.fillStyle = n.isSeed ? C.dim : n.color;
        ctx.textAlign = "center";
        ctx.fillText(cap, Math.max(46, Math.min(W - 46, sx)), sy - n.r * k - 6);
      }
      ctx.restore();
    };

    let raf = 0;
    const tick = () => {
      // Auto-fit only the first build; on growth keep the user's view stable.
      if (!hadCache && !panned.current && sim.alpha() > 0.05) fit();
      for (const n of nodes) cache.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ── interaction ──────────────────────────────────────────────
    const toG = (sx: number, sy: number) => ({
      x: (sx - view.current.x) / view.current.k,
      y: (sy - view.current.y) / view.current.k,
    });
    const nodeAt = (sx: number, sy: number) => {
      const p = toG(sx, sy);
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
        const ddx = e.clientX - drag.current.x,
          ddy = e.clientY - drag.current.y;
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
      setHover(n ? { n, sx, sy } : null);
    };
    const onUp = (e: PointerEvent) => {
      const moved = drag.current?.moved;
      drag.current = null;
      if (moved) return;
      const rect = canvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (n && !n.id.startsWith("L:"))
        window.open(`/explore?q=${n.txid}`, "_blank", "noopener");
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      panned.current = true;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left,
        sy = e.clientY - rect.top;
      const before = toG(sx, sy);
      view.current.k = Math.max(0.12, Math.min(3, view.current.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      const after = toG(sx, sy);
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
  }, [taint]);

  return (
    <div ref={wrapRef} className="relative mt-2">
      <canvas
        ref={canvasRef}
        className="dotgrid w-full touch-none rounded-[3px] border border-line bg-bg"
        aria-label="Source-of-funds taint graph"
      />
      <span className="pointer-events-none absolute bottom-1.5 left-2 font-mono text-[10px] text-faint">
        → flows into the coin · ◌ dashed = still to crawl
      </span>
      <span className="pointer-events-none absolute bottom-1.5 right-2 font-mono text-[10px] text-faint">
        drag · zoom · click →
      </span>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-[3px] border border-line-strong bg-surface px-2 py-1.5 font-mono text-[11px] shadow-lg"
          style={{
            left: Math.min(hover.sx + 12, (wrapRef.current?.clientWidth ?? 300) - 170),
            top: Math.min(hover.sy + 12, 320),
          }}
        >
          <div className="text-dim">
            {hover.n.kind === "frontier"
              ? "queued — keep crawling"
              : hover.n.label
                ? hover.n.label
                : hover.n.kind === "coinbase"
                  ? "⛏ coinbase (mined)"
                  : hover.n.kind === "mixed"
                    ? "⧓ coinjoin (mixed)"
                    : hover.n.isSeed
                      ? "the coin"
                      : "ancestor tx"}
          </div>
          {!hover.n.id.startsWith("L:") && (
            <div className="text-faint">{truncateHash(hover.n.txid, 10)}</div>
          )}
          <div className="text-accent">
            {formatBtc(hover.n.contribution * taint.totalSat)} BTC ·{" "}
            {(hover.n.contribution * 100).toFixed(hover.n.contribution < 0.01 ? 2 : 0)}%
          </div>
        </div>
      )}
    </div>
  );
}
