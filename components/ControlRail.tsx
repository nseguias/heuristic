"use client";

import type { TraceDirection } from "@/lib/trace";
import { MicroLabel } from "./ui";

interface Props {
  depth: number;
  direction: TraceDirection;
  nodeBudget: number;
  onDepth: (d: number) => void;
  onDirection: (d: TraceDirection) => void;
  onNodeBudget: (n: number) => void;
}

const DIRECTIONS: { key: TraceDirection; label: string; glyph: string }[] = [
  { key: "ancestors", label: "Source", glyph: "←" },
  { key: "both", label: "Both", glyph: "↔" },
  { key: "descendants", label: "Spend", glyph: "→" },
];

const BUDGETS: { value: number; label: string }[] = [
  { value: 150, label: "150" },
  { value: 300, label: "300" },
  { value: 600, label: "600" },
];

export default function ControlRail({
  depth,
  direction,
  nodeBudget,
  onDepth,
  onDirection,
  onNodeBudget,
}: Props) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <MicroLabel>Direction</MicroLabel>
        <div className="mt-1.5 grid grid-cols-3 gap-1">
          {DIRECTIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => onDirection(d.key)}
              className={`rounded-[2px] border px-1 py-2 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                direction === d.key
                  ? "border-accent/60 bg-accent-dim text-accent"
                  : "border-line text-dim hover:border-line-strong hover:text-ink"
              }`}
            >
              <span className="block text-sm">{d.glyph}</span>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <MicroLabel>Ancestry depth</MicroLabel>
          <span className="font-mono text-[13px] tabular-nums text-accent">
            {depth}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={8}
          value={depth}
          onChange={(e) => onDepth(Number(e.target.value))}
          aria-label="Trace depth in hops"
          className="mt-2 w-full accent-[var(--accent)]"
        />
        <div className="mt-0.5 flex justify-between font-mono text-[9px] text-faint">
          <span>1 hop</span>
          <span>8 hops</span>
        </div>
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-faint">
          Each tx expands its top 10 highest-value flows — wide sweeps are
          summarized so depth stays readable.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <MicroLabel>Node budget</MicroLabel>
          <span className="font-mono text-[13px] tabular-nums text-accent">
            {nodeBudget}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1">
          {BUDGETS.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => onNodeBudget(b.value)}
              className={`rounded-[2px] border px-1 py-1.5 font-mono text-[11px] tabular-nums transition-colors ${
                nodeBudget === b.value
                  ? "border-accent/60 bg-accent-dim text-accent"
                  : "border-line text-dim hover:border-line-strong hover:text-ink"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-faint">
          Max transactions loaded per trace. Hit the cap? Double-click any node
          to re-center and keep expanding from there. Higher = slower.
        </p>
      </div>
    </div>
  );
}
