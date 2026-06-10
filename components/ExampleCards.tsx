"use client";

import Link from "next/link";
import { EXAMPLES, exampleHref } from "@/lib/examples";
import { MicroLabel } from "./ui";

export default function ExampleCards({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      className={`grid gap-3 ${
        compact ? "grid-cols-1 sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"
      }`}
    >
      {EXAMPLES.map((e) => (
        <Link
          key={e.id}
          href={exampleHref(e)}
          className="group flex flex-col rounded-[3px] border border-line bg-surface/50 p-4 transition-colors hover:border-accent/40 hover:bg-surface"
        >
          <div className="flex items-center justify-between">
            <span
              className="rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              style={{ borderColor: e.tagColor, color: e.tagColor }}
            >
              {e.tag}
            </span>
            <span className="font-mono text-[12px] text-faint transition-colors group-hover:text-accent">
              trace →
            </span>
          </div>
          <h3 className="mt-3 font-sans text-[16px] font-medium tracking-tight text-ink">
            {e.title}
          </h3>
          <p className="mt-1.5 font-mono text-[12px] leading-relaxed text-dim">
            {e.blurb}
          </p>
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5">
            <MicroLabel>{e.direction}</MicroLabel>
            <span className="font-mono text-[10px] text-faint">
              · depth {e.depth}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
