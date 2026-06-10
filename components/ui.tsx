"use client";

import { useState } from "react";

export function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span className="microlabel">{children}</span>;
}

/** Monospace value with copy-on-click; clipboard gets the raw string. */
export function Copyable({
  value,
  display,
  className = "",
}: {
  value: string;
  display?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1100);
        });
      }}
      title={value}
      className={`group inline-flex items-center gap-1.5 font-mono text-ink/90 transition-colors hover:text-accent ${className}`}
    >
      <span>{display ?? value}</span>
      <span
        className="text-[9px] uppercase tracking-wider text-faint group-hover:text-accent"
        aria-hidden
      >
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

export function Stat({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <MicroLabel>{label}</MicroLabel>
      <span
        className="font-mono text-[13px] tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {children}
      </span>
    </div>
  );
}

export function Pill({
  children,
  color = "var(--text-dim)",
  filled = false,
}: {
  children: React.ReactNode;
  color?: string;
  filled?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{
        borderColor: color,
        color: filled ? "#0b0a08" : color,
        background: filled ? color : "transparent",
      }}
    >
      {children}
    </span>
  );
}

export function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
    />
  );
}

/** Confidence as a 5-segment bar — instrument-style, no decimals shouting. */
export function ConfidenceBar({ value }: { value: number }) {
  const lit = Math.round(value * 5);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`confidence ${Math.round(value * 100)} percent`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className="h-2.5 w-1"
          style={{
            background: i < lit ? "var(--accent)" : "var(--line-strong)",
          }}
        />
      ))}
    </span>
  );
}
