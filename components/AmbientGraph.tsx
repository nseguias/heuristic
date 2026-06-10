"use client";

import { useEffect, useRef } from "react";

/**
 * Decorative, self-running constellation behind the hero. Pure ambience — not
 * real chain data — so it stays cheap and never blocks. Respects reduced motion.
 */
export default function AmbientGraph() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const COLORS = ["#7fb069", "#e0a458", "#e4572e", "#4ecdc4"];
    type P = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      c: string;
    };
    let nodes: P[] = [];
    let raf = 0;
    let dpr = 1;

    const seed = (w: number, h: number) => {
      const count = Math.min(46, Math.floor((w * h) / 26000));
      nodes = Array.from({ length: count }, (_, i) => ({
        // Deterministic-ish spread without Math.random dependence on first paint.
        x: ((i * 97) % w),
        y: ((i * 53) % h),
        vx: (Math.sin(i * 1.3) * 0.12),
        vy: (Math.cos(i * 0.7) * 0.12),
        r: 1.5 + (i % 4),
        c: COLORS[i % COLORS.length],
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed(rect.width, rect.height);
    };

    const frame = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      // Edges between near neighbours.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(231,222,202,${0.06 * (1 - dist / 130)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        if (!reduce) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > w) n.vx *= -1;
          if (n.y < 0 || n.y > h) n.vy *= -1;
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.c;
        ctx.globalAlpha = 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (!reduce) raf = requestAnimationFrame(frame);
    };

    resize();
    frame();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 h-full w-full opacity-70"
      aria-hidden
    />
  );
}
