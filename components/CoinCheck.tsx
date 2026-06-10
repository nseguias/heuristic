"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { classifyQuery, fetchAddressTxs, fetchTx } from "@/lib/api";
import { trace } from "@/lib/trace";
import { buildScreening, type ScreeningReport } from "@/lib/screening";
import { traceProvenance, type ProvenanceResult } from "@/lib/provenance";
import { riskRamp, C } from "@/lib/colors";
import { formatPercent, truncateHash } from "@/lib/format";
import { MicroLabel } from "./ui";

type Phase =
  | { s: "idle" }
  | { s: "running"; step: string }
  | { s: "error"; msg: string }
  | { s: "done"; report: ScreeningReport; prov: ProvenanceResult | null };

interface Verdict {
  tone: "safe" | "review" | "avoid";
  title: string;
  sub: string;
  color: string;
}

function verdictFor(r: ScreeningReport, prov: ProvenanceResult | null): Verdict {
  // The sender itself being a flagged entity (hack / sanctioned) is the worst
  // case — transacting with it is the problem, no matter where its coins came from.
  if (r.self && r.self.risk >= 0.5)
    return {
      tone: "avoid",
      title: "Do not accept",
      sub: `This address is itself flagged: ${r.self.name}. Transacting with it is the risk — not where its coins came from.`,
      color: C.taint,
    };
  if (r.sanctioned)
    return {
      tone: "avoid",
      title: "Do not accept",
      sub: "Exposure to a sanctioned or stolen-funds entity — an exchange would freeze this.",
      color: C.taint,
    };
  if (r.score >= 50)
    return {
      tone: "avoid",
      title: "High risk",
      sub: "Likely to be flagged or frozen by a regulated exchange.",
      color: C.taint,
    };
  if (r.score >= 25)
    return {
      tone: "review",
      title: "Review before accepting",
      sub: "Some risk exposure (e.g. mixing) — check where the coins came from below.",
      color: C.warn,
    };
  if (prov?.origin === "exchange")
    return {
      tone: "safe",
      title: "Likely safe to accept",
      sub: `Coins trace back to ${prov.originLabel?.name}, a KYC exchange — a clean origin.`,
      color: C.clean,
    };
  return {
    tone: "safe",
    title: "Likely safe to accept",
    sub: "No exposure to hacks, sanctions, or heavy mixing.",
    color: C.clean,
  };
}

const SAMPLES = [
  { label: "A hack wallet (bad)", q: "1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF" },
  { label: "An exchange (good)", q: "1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s" },
];

export default function CoinCheck() {
  const router = useRouter();
  const params = useSearchParams();
  const address = params.get("address") ?? "";
  const [value, setValue] = useState(address);
  const [phase, setPhase] = useState<Phase>({ s: "idle" });

  useEffect(() => setValue(address), [address]);

  useEffect(() => {
    if (!address) {
      setPhase({ s: "idle" });
      return;
    }
    if (classifyQuery(address) !== "address") {
      setPhase({ s: "error", msg: "That doesn't look like a Bitcoin address." });
      return;
    }
    let live = true;
    (async () => {
      try {
        setPhase({ s: "running", step: "fetching transaction history" });
        const txs = await fetchAddressTxs(address);
        if (!txs.length) throw new Error("no transactions for this address yet");
        if (!live) return;

        setPhase({ s: "running", step: "screening counterparties & exposure" });
        const graph = await trace(txs[0].txid, {
          direction: "both",
          depth: 3,
          maxNodes: 80,
        }).catch(() => undefined);
        const report = buildScreening(address, txs, graph);
        if (!live) return;

        setPhase({ s: "running", step: "tracing source of funds to origin" });
        const prov = await traceProvenance(txs[0].txid, fetchTx, {
          maxHops: 40,
        }).catch(() => null);
        if (!live) return;

        setPhase({ s: "done", report, prov });
      } catch (e) {
        if (live)
          setPhase({
            s: "error",
            msg: e instanceof Error ? e.message : "check failed",
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);

  const submit = (q: string) => {
    const a = q.trim();
    if (classifyQuery(a) === "address")
      router.push(`/check?address=${encodeURIComponent(a)}`);
  };

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="text-center">
        <MicroLabel>Source-of-funds check</MicroLabel>
        <h1 className="mt-2 font-sans text-[30px] font-bold tracking-[-0.03em] text-ink">
          Is this coin safe to accept?
        </h1>
        <p className="mt-2 font-mono text-[13px] leading-relaxed text-dim">
          Paste the Bitcoin address you&apos;re about to receive from. HEURISTIC
          traces its history back toward origin, screens it against sanctions and
          known entities, and tells you whether an exchange would accept it.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="mt-6"
      >
        <div className="flex items-center gap-2 rounded-[3px] border border-line bg-surface px-3 py-1 focus-within:border-accent/60">
          <span className="font-mono text-sm text-faint">⌕</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="bitcoin address…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Bitcoin address to check"
            className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-[14px] text-ink placeholder:text-faint focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-[2px] bg-accent px-5 py-2 font-mono text-[12px] uppercase tracking-wider text-bg transition-opacity hover:opacity-90"
          >
            check
          </button>
        </div>
        {!address && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="microlabel">try</span>
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => submit(s.q)}
                className="rounded-[2px] border border-line px-2 py-0.5 font-mono text-[10px] text-dim transition-colors hover:border-accent/40 hover:text-accent"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </form>

      {phase.s === "running" && (
        <div className="mt-8 flex flex-col items-center gap-2 py-8">
          <span className="blink font-mono text-accent">◍</span>
          <span className="font-mono text-[13px] text-ink">{phase.step}…</span>
          <span className="font-mono text-[11px] text-faint">
            walking the chain — this can take a few seconds
          </span>
        </div>
      )}

      {phase.s === "error" && (
        <div className="mt-8 rounded-[3px] border border-line bg-surface/40 px-4 py-6 text-center">
          <span className="font-mono text-taint">⚠ {phase.msg}</span>
        </div>
      )}

      {phase.s === "done" && (
        <Result address={address} report={phase.report} prov={phase.prov} />
      )}
    </main>
  );
}

function Result({
  address,
  report,
  prov,
}: {
  address: string;
  report: ScreeningReport;
  prov: ProvenanceResult | null;
}) {
  const v = verdictFor(report, prov);
  const icon = v.tone === "safe" ? "✓" : v.tone === "review" ? "⚠" : "✕";

  return (
    <div className="mt-8">
      {/* Verdict */}
      <div
        className="rounded-[4px] border p-5"
        style={{
          borderColor: v.color,
          background: `color-mix(in oklch, ${v.color} 10%, transparent)`,
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[20px]"
            style={{ background: v.color, color: "#0b0a08" }}
          >
            {icon}
          </span>
          <div>
            <div
              className="font-sans text-[22px] font-bold tracking-tight"
              style={{ color: v.color }}
            >
              {v.title}
            </div>
            <div className="font-mono text-[12px] text-dim">{v.sub}</div>
          </div>
          <div className="ml-auto text-right">
            <MicroLabel>Risk</MicroLabel>
            <div
              className="font-mono text-[26px] leading-none tabular-nums"
              style={{ color: riskRamp(report.score) }}
            >
              {Math.round(report.score)}
              <span className="text-[11px] text-faint"> / 100</span>
            </div>
          </div>
        </div>
      </div>

      {/* Source of funds */}
      {prov && (
        <div className="mt-3 rounded-[3px] border border-line bg-surface/40 px-4 py-3">
          <MicroLabel>Where the money came from</MicroLabel>
          <p className="mt-1.5 font-mono text-[13px] leading-relaxed text-ink">
            {prov.reachedGenesis
              ? `Traced back ${prov.hops} hops to freshly-mined coins (block ${prov.originBlock?.toLocaleString()}) — a clean lineage.`
              : prov.origin === "exchange"
                ? `Funds originate from ${prov.originLabel?.name} — a KYC exchange.`
                : prov.origin === "flagged"
                  ? `Lineage hits ${prov.originLabel?.name} ${prov.hops} hops back.`
                  : `Followed the main value path back ${prov.hops} hops; origin not fully resolved.`}
          </p>
          {prov.events.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {prov.events.slice(0, 4).map((e, i) => (
                <li
                  key={i}
                  className="font-mono text-[11px]"
                  style={{
                    color: e.risk >= 50 ? "var(--warn)" : "var(--text-faint)",
                  }}
                >
                  → {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Exposure */}
      {report.exposures.length > 0 && (
        <div className="mt-3 rounded-[3px] border border-line bg-surface/40 px-4 py-3">
          <MicroLabel>Exposure</MicroLabel>
          <div className="mt-2 space-y-1.5">
            {report.exposures.map((e) => (
              <div key={e.category} className="flex items-center gap-2">
                <span className="w-36 shrink-0 font-mono text-[11px] text-dim">
                  {e.name}
                  {!e.direct && <span className="ml-1 text-faint">· indirect</span>}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(3, e.share * 100)}%`,
                      background: riskRamp(e.risk * 100),
                    }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-dim">
                  {e.direct ? formatPercent(e.share, 0) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Link
          href={`/address/${address}`}
          className="font-mono text-[12px] text-dim transition-colors hover:text-accent"
        >
          full investigation · {truncateHash(address, 6)} →
        </Link>
        <a
          href={`/api/screen/${address}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-[2px] border border-line px-2.5 py-1.5 font-mono text-[11px] text-dim transition-colors hover:border-accent/40 hover:text-accent"
        >
          {"{ }"} API
        </a>
      </div>

      <p className="mt-4 font-mono text-[10px] leading-relaxed text-faint">
        Heuristic estimate over an open label set — a screening aid, not legal or
        financial advice. Privacy is legitimate; a high score is not an accusation.
      </p>
    </div>
  );
}
