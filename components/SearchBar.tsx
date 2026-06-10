"use client";

import { useState } from "react";
import { classifyQuery } from "@/lib/api";

interface Props {
  initial?: string;
  onSubmit: (query: string) => void;
  busy?: boolean;
  compact?: boolean;
}

const SAMPLES = [
  {
    label: "Pizza tx (2010)",
    q: "a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",
  },
  {
    label: "Silk Road seizure",
    q: "1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX",
  },
  {
    label: "Mt. Gox wallet",
    q: "1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF",
  },
];

export default function SearchBar({
  initial = "",
  onSubmit,
  busy,
  compact,
}: Props) {
  const [value, setValue] = useState(initial);
  const kind = value.trim() ? classifyQuery(value) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (kind && kind !== "invalid") onSubmit(value.trim());
      }}
      className="w-full"
    >
      <div
        className={`flex items-center gap-2 rounded-[2px] border bg-surface px-3 ${
          compact ? "h-10" : "h-14"
        } ${
          kind === "invalid"
            ? "border-taint/50"
            : "border-line focus-within:border-accent/60"
        } transition-colors`}
      >
        <span className="font-mono text-xs text-faint">⌕</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder="txid or bitcoin address…"
          aria-label="Transaction id or Bitcoin address"
          className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-ink placeholder:text-faint focus:outline-none"
        />
        {kind && (
          <span
            className="font-mono text-[9px] uppercase tracking-wider"
            style={{
              color:
                kind === "invalid" ? "var(--taint)" : "var(--text-faint)",
            }}
          >
            {kind === "invalid" ? "unrecognized" : kind}
          </span>
        )}
        <button
          type="submit"
          disabled={!kind || kind === "invalid" || busy}
          className="rounded-[2px] bg-accent px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {busy ? "tracing…" : "trace"}
        </button>
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="microlabel">try</span>
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                setValue(s.q);
                onSubmit(s.q);
              }}
              className="rounded-[2px] border border-line px-2 py-0.5 font-mono text-[10px] text-dim transition-colors hover:border-accent/40 hover:text-accent"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
