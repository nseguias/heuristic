"use client";

import { useEffect, useRef, useState } from "react";
import type { MempoolRecent } from "@/lib/api";
import { flagRecent, feeRateOf } from "@/lib/mempoolHeuristics";
import { formatBtc, formatUsd, truncateHash } from "@/lib/format";
import { C } from "@/lib/colors";

/**
 * Live "transaction rain": each new mempool tx drops in, sized by BTC value and
 * coloured by fee rate, and piles up with real circle collisions. The pile is
 * area-capped so it always fits — which keeps the constraint solver satisfiable,
 * so bubbles settle to rest (no infinite jitter) and never overlap. Retired
 * bubbles fade out from the bottom so the rain keeps flowing.
 *
 * Physics params verified by headless convergence test (zero overlap, sub-pixel
 * residual motion across desktop and mobile widths).
 */

interface Particle {
  txid: string;
  value: number;
  feeRate: number;
  baseR: number;
  r: number;
  color: string;
  whale: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  dying: boolean;
  bornAt: number; // ms when we first saw it (for "seen Xs ago")
}

const GRAVITY = 0.3;
const GROUND_FRICTION = 0.7;
const AIR = 0.995;
const GAP = 5; // guaranteed pixels between bubble rims
const SLOP = 0.3;
const ITERATIONS = 8;
const FLOOR_PAD = 6;
// 0.34 keeps full separation (zero overlap) while still fitting ~100 bubbles on
// a wide canvas — comfortably more than the 50-bubble starting pile.
const FILL = 0.34; // max fraction of the area the live pile may claim
const FADE_FRAMES = 14;
const HARD_MAX = 200; // safety backstop
const MAX_R = 40;
const SPAWN_EVERY = 48; // staggered fall so the pile builds steadily

// Discrete size tiers by BTC value — clearer than a continuous curve. Each
// jump is a 10× step in value; 100+ BTC is the dominant size.
const SIZE_BINS: { max: number; r: number }[] = [
  { max: 0.001, r: 6 },
  { max: 0.01, r: 8 },
  { max: 0.1, r: 11 },
  { max: 1, r: 16 },
  { max: 10, r: 23 },
  { max: 100, r: 31 },
  { max: Infinity, r: 40 },
];

interface Props {
  batch: MempoolRecent[];
  confirmed: string[]; // txids confirmed by a new block — fade these out
  price: number | null;
  onPick: (txid: string) => void;
}

function radius(value: number): number {
  const btc = value / 1e8;
  for (const b of SIZE_BINS) if (btc < b.max) return b.r;
  return MAX_R;
}

function colorFor(feeRate: number, whale: boolean): string {
  if (whale) return C.accent;
  if (feeRate >= 100) return C.taint;
  if (feeRate >= 30) return C.warn;
  if (feeRate >= 8) return C.mix;
  return C.clean;
}


function toParticle(t: MempoolRecent, x: number, y: number): Particle {
  const flags = flagRecent(t);
  const whale = flags.some((f) => f.kind === "whale");
  const fr = feeRateOf(t);
  const r = radius(t.value);
  return {
    txid: t.txid,
    value: t.value,
    feeRate: fr,
    baseR: r,
    r,
    color: colorFor(fr, whale),
    whale,
    x,
    y,
    vx: 0,
    vy: 0,
    life: 1,
    dying: false,
    bornAt: Date.now(),
  };
}

const FEE_BANDS: { color: string; label: string }[] = [
  { color: C.clean, label: "<8" },
  { color: C.mix, label: "8–30" },
  { color: C.warn, label: "30–100" },
  { color: C.taint, label: "100+" },
  { color: C.accent, label: "whale ≥50₿" },
];

export default function MempoolRain({
  batch,
  confirmed,
  price,
  onPick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const pending = useRef<MempoolRecent[]>([]);
  const hoverRef = useRef<Particle | null>(null);
  const priceRef = useRef<number | null>(price);
  const [count, setCount] = useState(0);

  priceRef.current = price;

  useEffect(() => {
    if (!batch.length) return;
    // Everything — the initial ~70-tx seed and live polls — goes through the
    // staggered spawn queue, so bubbles fall in steadily instead of appearing
    // in one chunk. Cap the backlog so a flood can't queue forever.
    pending.current.push(...batch);
    if (pending.current.length > 160)
      pending.current = pending.current.slice(-160);
  }, [batch]);

  // A block confirmed these txs — they've left the mempool, so fade them out.
  useEffect(() => {
    if (!confirmed.length) return;
    const set = new Set(confirmed);
    for (const p of particles.current) {
      if (set.has(p.txid)) p.dying = true;
    }
    // Also drop any still-queued ones that just got mined.
    pending.current = pending.current.filter((t) => !set.has(t.txid));
  }, [confirmed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let lastSpawn = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const liveArea = () => {
      let a = 0;
      for (const p of particles.current) {
        if (p.dying) continue;
        const rr = p.r + GAP / 2;
        a += Math.PI * rr * rr;
      }
      return a;
    };

    // Retire the oldest live bubbles (they fade out) until the live pile fits.
    const trim = (w: number, h: number) => {
      const maxArea = FILL * w * h;
      let guard = 0;
      while (liveArea() > maxArea && guard++ < 60) {
        const oldest = particles.current.find((p) => !p.dying);
        if (!oldest) break;
        oldest.dying = true;
      }
      if (particles.current.length > HARD_MAX)
        particles.current.splice(0, particles.current.length - HARD_MAX);
    };

    const spawn = (w: number, h: number, ts: number) => {
      if (!pending.current.length || ts - lastSpawn < SPAWN_EVERY) return;
      lastSpawn = ts;
      const t = pending.current.shift()!;
      const r = radius(t.value);
      // Random entry x across the full width (so consecutive drops never line up).
      const x = r + Math.random() * (w - r * 2);
      particles.current.push(
        reduce ? toParticle(t, x, h - FLOOR_PAD - r) : toParticle(t, x, -r)
      );
      setCount((c) => c + 1);
    };

    const step = (w: number, h: number) => {
      const ps = particles.current;
      const floor = h - FLOOR_PAD;

      // Fade + remove retiring bubbles (shrinking frees space for neighbours).
      for (let k = ps.length - 1; k >= 0; k--) {
        const p = ps[k];
        if (p.dying) {
          p.life -= 1 / FADE_FRAMES;
          p.r = p.baseR * Math.max(0, p.life);
          if (p.life <= 0) ps.splice(k, 1);
        }
      }

      // Integrate gravity, walls, floor.
      for (const p of ps) {
        if (!reduce) {
          p.vy += GRAVITY;
          p.vx *= AIR;
          p.x += p.vx;
          p.y += p.vy;
        }
        if (p.x < p.r) {
          p.x = p.r;
          p.vx = Math.abs(p.vx) * 0.2;
        } else if (p.x > w - p.r) {
          p.x = w - p.r;
          p.vx = -Math.abs(p.vx) * 0.2;
        }
        if (p.y > floor - p.r) {
          p.y = floor - p.r;
          if (p.vy > 0) p.vy = 0;
          p.vx *= GROUND_FRICTION;
        }
      }

      // Inelastic circle collisions with a guaranteed GAP. Equal mass; the
      // approaching velocity is cancelled (restitution 0) so the pile damps to
      // rest instead of bouncing forever.
      for (let it = 0; it < ITERATIONS; it++) {
        for (let i = 0; i < ps.length; i++) {
          for (let j = i + 1; j < ps.length; j++) {
            const a = ps[i];
            const b = ps[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            const min = a.r + b.r + GAP;
            let d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            if (d2 < 1e-4) {
              dx = i % 2 ? 0.6 : -0.6;
              dy = 0.5;
              d2 = 0.61;
            }
            const d = Math.sqrt(d2);
            const overlap = min - d;
            if (overlap < SLOP) continue;
            const nx = dx / d;
            const ny = dy / d;
            const c = (overlap - SLOP) * 0.5;
            a.x -= nx * c;
            a.y -= ny * c;
            b.x += nx * c;
            b.y += ny * c;
            const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rvn < 0) {
              const jimp = -rvn / 2;
              a.vx -= jimp * nx;
              a.vy -= jimp * ny;
              b.vx += jimp * nx;
              b.vy += jimp * ny;
            }
          }
        }
      }

      for (const p of ps) {
        if (p.x < p.r) p.x = p.r;
        else if (p.x > w - p.r) p.x = w - p.r;
        if (p.y > floor - p.r) p.y = floor - p.r;
      }
    };

    const draw = (w: number, h: number) => {
      ctx.clearRect(0, 0, w, h);
      const hov = hoverRef.current;
      for (const p of particles.current) {
        const hovered = hov?.txid === p.txid;
        const a = p.dying ? Math.max(0, p.life) : 1;
        ctx.globalAlpha = a;

        // Match the explorer's node style: dark surface fill, coloured ring,
        // inner half-alpha disc — consistent visual language across both views.
        ctx.shadowColor = p.color;
        ctx.shadowBlur = hovered ? 16 : p.whale ? 12 : 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = C.surface;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.lineWidth = hovered ? 2.5 : 1.5;
        ctx.strokeStyle = p.color;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a * 0.5;
        ctx.fill();
        ctx.globalAlpha = a;

        // USD label (cream for legibility on any bubble colour).
        if (p.r >= 14 && priceRef.current) {
          ctx.font = "600 9px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center";
          ctx.shadowColor = "rgba(0,0,0,0.85)";
          ctx.shadowBlur = 4;
          ctx.fillStyle = C.text;
          ctx.fillText(formatUsd(p.value, priceRef.current), p.x, p.y + 3);
          ctx.shadowBlur = 0;
        }
      }
      ctx.globalAlpha = 1;
    };

    const frame = (ts: number) => {
      const rect = canvas.getBoundingClientRect();
      spawn(rect.width, rect.height, ts);
      trim(rect.width, rect.height);
      step(rect.width, rect.height);
      draw(rect.width, rect.height);
      raf = requestAnimationFrame(frame);
    };

    resize();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const rel = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hit = (mx: number, my: number) => {
      let found: Particle | null = null;
      for (const p of particles.current) {
        if (p.dying) continue;
        const dx = p.x - mx;
        const dy = p.y - my;
        if (dx * dx + dy * dy <= p.r * p.r) found = p;
      }
      return found;
    };
    const onMove = (e: MouseEvent) => {
      const { x, y } = rel(e);
      const p = hit(x, y);
      hoverRef.current = p;
      canvas.style.cursor = p ? "pointer" : "default";
    };
    const onClick = (e: MouseEvent) => {
      const { x, y } = rel(e);
      const p = hit(x, y);
      if (p) onPick(p.txid);
    };
    const onLeave = () => {
      hoverRef.current = null;
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mouseleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [onPick]);

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-y-1">
        <span className="microlabel">
          transaction rain · click a bubble to trace
        </span>
        <span className="font-mono text-[11px] tabular-nums text-faint">
          {count} dropped
        </span>
      </div>
      {/* Two independent encodings: colour = fee rate, size = amount moved. */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="microlabel">colour = fee rate</span>
        {FEE_BANDS.map((band) => (
          <span key={band.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: band.color, boxShadow: `0 0 5px ${band.color}` }}
            />
            <span className="font-mono text-[10px] text-dim">{band.label}</span>
          </span>
        ))}
        <span className="font-mono text-[10px] text-faint">
          sat/vB · size = BTC amount
        </span>
      </div>
      <div className="relative h-56 overflow-hidden rounded-[6px] border border-line bg-bg">
        <canvas
          ref={canvasRef}
          className="dotgrid h-full w-full"
          aria-label="Falling live transactions"
        />
        <HoverLabel hoverRef={hoverRef} price={price} />
      </div>
    </div>
  );
}

function HoverLabel({
  hoverRef,
  price,
}: {
  hoverRef: React.MutableRefObject<Particle | null>;
  price: number | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((t) => t + 1), 110);
    return () => clearInterval(i);
  }, []);
  const p = hoverRef.current;
  if (!p) return null;
  const secs = Math.max(0, Math.round((Date.now() - p.bornAt) / 1000));
  const seen = secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  return (
    <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-[2px] border border-line-strong bg-surface/95 px-2.5 py-1.5 font-mono text-[11px] backdrop-blur-sm">
      <span className="text-ink">{truncateHash(p.txid, 6)}</span>
      <span className="mx-1.5 text-faint">·</span>
      <span style={{ color: "var(--accent)" }}>{formatBtc(p.value)} BTC</span>
      {price && (
        <>
          <span className="mx-1.5 text-faint">·</span>
          <span style={{ color: "var(--clean)" }}>
            {formatUsd(p.value, price)}
          </span>
        </>
      )}
      <span className="mx-1.5 text-faint">·</span>
      <span className="text-faint">seen {seen}</span>
    </div>
  );
}
