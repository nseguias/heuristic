"use client";

import { C } from "@/lib/colors";

const RISK = [
  { color: C.clean, label: "low risk" },
  { color: C.warn, label: "medium risk" },
  { color: C.taint, label: "high risk" },
];

const KINDS = [
  { color: C.mix, label: "coinjoin", ring: true, dashed: true },
  { color: C.accent, label: "selected", ring: true },
  { color: C.clean, label: "⛏ coinbase" },
];

export default function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden max-w-[94%] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-[3px] border border-line bg-surface/80 px-3.5 py-2 backdrop-blur-sm md:flex">
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
        taint
      </span>
      {RISK.map((it) => (
        <Item key={it.label} color={it.color} label={it.label} />
      ))}
      <span className="mx-0.5 h-3 w-px bg-line" />
      {KINDS.map((it) => (
        <Item
          key={it.label}
          color={it.color}
          label={it.label}
          ring={it.ring}
          dashed={it.dashed}
        />
      ))}
      <span className="mx-0.5 h-3 w-px bg-line" />
      {/* What the connecting lines mean. */}
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-px w-4"
          style={{ background: "rgba(120,170,190,0.8)" }}
        />
        <span className="font-mono text-[10px] text-dim">
          spend — BTC flowing between txs
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-px w-4"
          style={{ borderTop: "1.5px dashed var(--warn)" }}
        />
        <span className="font-mono text-[10px] text-dim">change</span>
      </span>
    </div>
  );
}

function Item({
  color,
  label,
  ring,
  dashed,
}: {
  color: string;
  label: string;
  ring?: boolean;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{
          background: ring ? "transparent" : color,
          border: ring
            ? `1.5px ${dashed ? "dashed" : "solid"} ${color}`
            : "none",
          boxShadow: ring ? "none" : `0 0 5px ${color}`,
        }}
      />
      <span className="font-mono text-[10px] text-dim">{label}</span>
    </span>
  );
}
