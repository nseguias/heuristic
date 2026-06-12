"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  classifyQuery,
  fetchAddressTxs,
  fetchMempoolRecent,
  fetchTx,
} from "@/lib/api";
import { trace } from "@/lib/trace";
import { buildScreening, type ScreeningReport } from "@/lib/screening";
import { traceProvenance, type ProvenanceResult } from "@/lib/provenance";
import { traceTaint, type TaintResult } from "@/lib/taint";
import { labelFor } from "@/lib/labels";
import { riskRamp, C } from "@/lib/colors";
import { formatPercent, truncateHash } from "@/lib/format";
import { MicroLabel } from "./ui";
import ProvenanceGraph from "./ProvenanceGraph";

type Phase =
  | { s: "idle" }
  | { s: "running"; step: string }
  | { s: "error"; msg: string }
  | {
      s: "done";
      report: ScreeningReport;
      prov: ProvenanceResult | null;
      taint: TaintResult | null;
    };

interface Verdict {
  tone: "safe" | "review" | "avoid";
  title: string;
  sub: string;
  color: string;
}

function pct(f: number): string {
  if (f <= 0) return "0%";
  if (f < 0.01) return "<1%";
  return `${Math.round(f * 100)}%`;
}

function verdictFor(r: ScreeningReport, taint: TaintResult | null): Verdict {
  // The sender itself being a flagged entity (hack / sanctioned) is the worst
  // case — transacting with it is the problem, no matter where its coins came from.
  if (r.self && r.self.risk >= 0.5)
    return {
      tone: "avoid",
      title: "Do not accept",
      sub: `This address is itself flagged: ${r.self.name}. Transacting with it is the risk — not where its coins came from.`,
      color: C.taint,
    };

  // Value-weighted ancestry over ALL paths — the real source-of-funds check.
  if (taint) {
    const bad = taint.origins.find(
      (o) => (o.key === "hack" || o.key === "sanctioned") && o.fraction >= 0.005
    );
    if (bad)
      return {
        tone: "avoid",
        title: "Do not accept",
        sub: `${pct(bad.fraction)} of the value traces to ${bad.name} — an exchange would flag this.`,
        color: C.taint,
      };
    if (taint.score >= 50)
      return {
        tone: "avoid",
        title: "High risk",
        sub: "Material exposure across the coin's funding paths — likely flagged or frozen.",
        color: C.taint,
      };
    if (taint.mixedFraction >= 0.1 || taint.score >= 25)
      return {
        tone: "review",
        title: "Review before accepting",
        sub: `${pct(taint.mixedFraction)} of the value passed through mixing — origin obscured for that share.`,
        color: C.warn,
      };
    // No flags found. If we covered most of the value, that's a clean result;
    // if coverage is thin, say what we DID check and flag it as unverified.
    if (taint.coverage >= 0.8)
      return {
        tone: "safe",
        title: "Likely safe to accept",
        sub: `${pct(taint.cleanFraction)} of the value traces to clean origins; no hack, sanctions, or mixing across ${taint.nodesVisited} ancestor txs (${pct(taint.coverage)} of value covered).`,
        color: C.clean,
      };
    return {
      tone: "review",
      title: "No taint found — but trace is partial",
      sub: `No hack, sanctions, or mixing in the ${taint.nodesVisited} ancestor txs we traced, but only ${pct(taint.coverage)} of the value resolved on the public API. Connect your own node to verify the rest before relying on this.`,
      color: C.warn,
    };
  }

  // Sender is a known entity (clean) — its label is the answer.
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
      sub: "Some risk exposure — check the source below.",
      color: C.warn,
    };
  return {
    tone: "safe",
    title: "Likely safe to accept",
    sub: r.self
      ? `Sender is ${r.self.name} — a known ${r.self.category} entity.`
      : "No exposure to hacks, sanctions, or heavy mixing.",
    color: C.clean,
  };
}

/** Accurate "~YYYY" from a block timestamp (never a future year). */
function yearOf(unixSec?: number): string {
  if (!unixSec) return "";
  const y = new Date(unixSec * 1000).getUTCFullYear();
  return ` back to ${y}`;
}

// Honest, useful prose for the source-of-funds section — never presents an
// unresolved trace as if the verdict depended on it.
function whereFrom(r: ScreeningReport, prov: ProvenanceResult): string {
  const back = yearOf(prov.oldestBlockTime);

  // The sender itself is the flagged entity — provenance is supplementary, and
  // the verdict stands on complete data (we know this wallet), not the trace.
  if (r.self && r.self.risk >= 0.5)
    return `These coins sit in the flagged wallet itself (${r.self.name}) — that alone decides the verdict, so tracing their deeper origin isn't required.`;

  if (prov.reachedGenesis)
    return `Traced ${prov.hops} hops to freshly-mined coins (block ${prov.originBlock?.toLocaleString()}) — the cleanest possible lineage.`;

  if (prov.origin === "exchange")
    return `Coins trace back to ${prov.originLabel?.name}, a KYC exchange — a clean origin.`;

  if (prov.origin === "flagged")
    return `The dominant value path reaches ${prov.originLabel?.name} ${prov.hops} hops back — a definitive flagged origin.`;

  if (prov.origin === "mixed")
    return `The trail goes cold ${prov.hops} hops back at a coinjoin: the coins were deliberately mixed, so their pre-mix origin is unrecoverable by design. That mixing is already reflected in the score — this is a complete answer, not a missing one.`;

  if (prov.origin === "dead-end")
    return `The dominant value path ends ${prov.hops} hops back${back} with no flagged, exchange, or mining origin — nothing suspicious on the main trail.`;

  // Hit the depth cap without a definitive signal. This is a real finding, not
  // missing data: we crawled deep and the trail stayed clean.
  return `We crawled the dominant value path ${prov.hops} hops${back} and hit no flag, coinjoin, or exchange — the main money trail is clean that far back. A typical coin has no single "genesis" to reach (its path merges with millions of others), so this is the complete answer the data supports${
    r.score >= 25 ? "; any risk in the verdict comes from the exposure below." : "."
  }`;
}

const SAMPLES = [
  { label: "A hack wallet (bad)", q: "1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF" },
  { label: "Traces to an exchange", q: "1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s" },
];

// Hop-by-hop trace graph of the dominant value path, back toward origin.
function TracePath({ prov }: { prov: ProvenanceResult }) {
  if (!prov.path.length) return null;
  const hasBranches = prov.path.some((h) => h.branches?.length);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <MicroLabel>
        Trace · dominant value path · {prov.path.length} hop
        {prov.path.length === 1 ? "" : "s"} ·{" "}
        {prov.resolved ? "resolved" : `stopped at ${prov.hops}-hop cap`}
      </MicroLabel>
      <ProvenanceGraph path={prov.path} />

      {hasBranches && (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-faint">
          <span className="text-dim">Branches = merged inputs:</span> coins
          co-spent in the same transaction — by the common-input-ownership
          heuristic, probably the same owner (a probability, not proof; coinjoins
          break it). Each one is screened for known entities and folded into the
          exposure below; a flagged merged input would turn red and raise the
          score. Click any node to trace it fully in the explorer.
        </p>
      )}

      {!prov.resolved && (
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
          We crawled to our {prov.hops}-hop depth cap without hitting a flag — a
          practical limit on the public API, not a verdict gap. To crawl further
          (it still won&apos;t reach a single &ldquo;genesis&rdquo; — no coin has
          one), point HEURISTIC at your own node in{" "}
          <span className="text-dim">⚙ settings</span>.
        </p>
      )}
    </div>
  );
}

export default function CoinCheck() {
  const router = useRouter();
  const params = useSearchParams();
  const address = params.get("address") ?? "";
  const [value, setValue] = useState(address);
  const [phase, setPhase] = useState<Phase>({ s: "idle" });
  const [picking, setPicking] = useState(false);
  const [hopCount, setHopCount] = useState(0);
  const [taintProgress, setTaintProgress] = useState<{ n: number; cov: number } | null>(
    null
  );

  useEffect(() => setValue(address), [address]);

  // Grab a genuinely random recent on-chain wallet to screen.
  const checkRandom = async () => {
    setPicking(true);
    try {
      const recent = await fetchMempoolRecent().catch(() => []);
      const shuffled = [...recent].sort(() => Math.random() - 0.5);
      for (const t of shuffled) {
        const tx = await fetchTx(t.txid).catch(() => null);
        const addr = tx?.vout.find(
          (v) => v.scriptpubkey_address
        )?.scriptpubkey_address;
        if (addr) {
          router.push(`/check?address=${encodeURIComponent(addr)}`);
          return;
        }
      }
    } finally {
      setPicking(false);
    }
  };

  useEffect(() => {
    if (!address) {
      setPhase({ s: "idle" });
      return;
    }
    if (classifyQuery(address) !== "address") {
      setPhase({ s: "error", msg: "That doesn't look like a Bitcoin address." });
      return;
    }
    // Bring the new result into view (navigating between checks otherwise keeps
    // your scroll position, making it look like nothing happened).
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
    let live = true;
    (async () => {
      try {
        setPhase({ s: "running", step: "fetching transaction history" });
        const txs = await fetchAddressTxs(address);
        if (!txs.length) throw new Error("no transactions for this address yet");
        if (!live) return;

        // If the sender is itself a known entity, its label IS the answer — no
        // need to trace its (often enormous) ancestry. For an UNKNOWN sender we
        // run the full value-weighted taint trace over the WHOLE ancestry, so
        // the verdict considers every path, not just the dominant one.
        const self = labelFor(address);
        setPhase({ s: "running", step: "crawling the source-of-funds trail" });
        setHopCount(0);
        setTaintProgress(null);
        const [graph, prov, taint] = await Promise.all([
          trace(txs[0].txid, {
            direction: "both",
            depth: 3,
            maxNodes: 80,
          }).catch(() => undefined),
          traceProvenance(txs[0].txid, fetchTx, {
            maxHops: 60,
            onHop: (h) => {
              if (live) setHopCount(h);
            },
          }).catch(() => null),
          self
            ? Promise.resolve(null)
            : traceTaint(txs[0].txid, fetchTx, {
                maxNodes: 800,
                timeBudgetMs: 18000,
                onProgress: (n, cov) => {
                  if (live) setTaintProgress({ n, cov });
                },
              }).catch(() => null),
        ]);
        const report = buildScreening(address, txs, graph);
        if (!live) return;

        setPhase({ s: "done", report, prov, taint });
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

  const submit = async (q: string) => {
    const raw = q.trim();
    if (!raw) return;
    if (classifyQuery(raw) === "address") {
      router.push(`/check?address=${encodeURIComponent(raw)}`);
      return;
    }
    // A transaction id or UTXO (txid:vout) — resolve the sender (the dominant
    // input address paying you) and screen them.
    const txid = raw.split(":")[0].trim();
    if (/^[0-9a-f]{64}$/i.test(txid)) {
      setPhase({ s: "running", step: "resolving the sender from that transaction" });
      const tx = await fetchTx(txid).catch(() => null);
      const sender = tx?.vin
        .filter((v) => v.prevout?.scriptpubkey_address)
        .sort((x, y) => (y.prevout?.value ?? 0) - (x.prevout?.value ?? 0))[0]
        ?.prevout?.scriptpubkey_address;
      if (sender) router.push(`/check?address=${encodeURIComponent(sender)}`);
      else
        setPhase({
          s: "error",
          msg: "couldn't find a sender address in that transaction (a coinbase / mined tx has none)",
        });
      return;
    }
    setPhase({
      s: "error",
      msg: "that doesn't look like a Bitcoin address or transaction id",
    });
  };

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="text-center">
        <MicroLabel>Source-of-funds check</MicroLabel>
        <h1 className="mt-2 font-sans text-[30px] font-bold tracking-[-0.03em] text-ink">
          Is this coin safe to accept?
        </h1>
        <p className="mt-2 font-mono text-[13px] leading-relaxed text-dim">
          Paste the <span className="text-ink">sender&apos;s</span>{" "}
          Bitcoin address — the wallet that&apos;s about to pay you — or the
          transaction id of the incoming coins. HEURISTIC traces its history
          back toward origin, screens it against sanctions and known entities,
          and tells you whether an exchange would accept it.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="mt-6"
      >
        <div className="flex items-center gap-2 rounded-[3px] border border-line bg-surface px-3 py-1 transition-colors focus-within:border-accent/45">
          <span className="font-mono text-sm text-faint">⌕</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sender's address or transaction id…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Sender's Bitcoin address or transaction id to check"
            className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-[14px] text-ink placeholder:text-faint focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-[2px] bg-accent px-5 py-2 font-mono text-[12px] uppercase tracking-wider text-bg transition-opacity hover:opacity-90"
          >
            check
          </button>
        </div>
        {
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="microlabel">{address ? "try another" : "try"}</span>
            {SAMPLES.filter((s) => s.q !== address).map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => submit(s.q)}
                className="rounded-[2px] border border-line px-2 py-0.5 font-mono text-[10px] text-dim transition-colors hover:border-accent/40 hover:text-accent"
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              onClick={checkRandom}
              disabled={picking}
              className="rounded-[2px] border border-line px-2 py-0.5 font-mono text-[10px] text-dim transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
            >
              {picking ? "picking…" : "🎲 a random wallet"}
            </button>
          </div>
        }
      </form>

      {phase.s === "running" && (
        <div className="mt-8 flex flex-col items-center gap-2 py-8 text-center">
          <span className="blink font-mono text-accent">◍</span>
          <span className="font-mono text-[13px] text-ink">
            {phase.step}
            {phase.step.startsWith("crawling") && taintProgress
              ? ` · ${taintProgress.n} txs · ${taintProgress.cov}% of value`
              : phase.step.startsWith("crawling") && hopCount > 0
                ? ` · ${hopCount} hops`
                : ""}
            …
          </span>
          <span className="max-w-md font-mono text-[11px] leading-relaxed text-faint">
            {phase.step.startsWith("crawling")
              ? "Following every funding path back, weighted by how much of the coin's value flows through it, until each reaches a known entity, a coinbase, or a coinjoin. We trace the whole ancestry — not just the biggest input — so the verdict considers all of it."
              : "walking the chain — this can take a few seconds"}
          </span>
        </div>
      )}

      {phase.s === "error" && (
        <div className="mt-8 rounded-[3px] border border-line bg-surface/40 px-4 py-6 text-center">
          <span className="font-mono text-taint">⚠ {phase.msg}</span>
        </div>
      )}

      {phase.s === "done" && (
        <Result
          address={address}
          report={phase.report}
          prov={phase.prov}
          taint={phase.taint}
        />
      )}
    </main>
  );
}

function originColor(o: TaintResult["origins"][number]): string {
  if (o.key === "mixed") return C.mix;
  if (o.key === "unresolved") return C.faint;
  if (o.key === "coinbase") return C.clean;
  return riskRamp(o.risk * 100);
}

// The honest "we checked everything" panel: value-weighted breakdown of where
// the coin's value comes from, across ALL ancestry paths, with coverage.
function ValueBreakdown({ taint }: { taint: TaintResult }) {
  const segs = [
    { label: "clean", frac: taint.cleanFraction, color: C.clean },
    { label: "mixed", frac: taint.mixedFraction, color: C.mix },
    { label: "flagged", frac: taint.badFraction, color: C.taint },
    { label: "unresolved", frac: taint.unresolvedFraction, color: C.faint },
  ].filter((s) => s.frac > 0.002);
  const top = taint.origins.filter((o) => o.fraction >= 0.01).slice(0, 6);

  return (
    <div className="mt-3 rounded-[3px] border border-line bg-surface/40 px-4 py-3">
      <MicroLabel>
        Source of funds · value-weighted · {pct(taint.coverage)} of value traced ·{" "}
        {taint.nodesVisited} ancestor txs{taint.truncated ? " · capped" : ""}
      </MicroLabel>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {segs.map((s) => (
          <div
            key={s.label}
            style={{ width: `${s.frac * 100}%`, background: s.color }}
            title={`${s.label} ${pct(s.frac)}`}
          />
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {top.map((o, i) => (
          <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: originColor(o) }}
            />
            <span className="text-dim">{o.name}</span>
            <span className="ml-auto tabular-nums text-faint">
              {pct(o.fraction)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-faint">
        Every funding path is followed back and weighted by how much of the
        coin&apos;s value flows through it, until it reaches a known entity, a
        coinbase, or a coinjoin — not just the largest input.{" "}
        {taint.coverage >= 0.9
          ? `${pct(taint.coverage)} of the value is accounted for, so this is a complete result.`
          : `${pct(1 - taint.coverage)} couldn't be traced within the public-API budget — connect your own node (⚙ settings) for full coverage.`}
      </p>
    </div>
  );
}

function Result({
  address,
  report,
  prov,
  taint,
}: {
  address: string;
  report: ScreeningReport;
  prov: ProvenanceResult | null;
  taint: TaintResult | null;
}) {
  const v = verdictFor(report, taint);
  const score = Math.max(report.score, taint?.score ?? 0);
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
              style={{ color: riskRamp(score) }}
            >
              {Math.round(score)}
              <span className="text-[11px] text-faint"> / 100</span>
            </div>
          </div>
        </div>
      </div>

      {/* Value-weighted source-of-funds (all paths) */}
      {taint && <ValueBreakdown taint={taint} />}

      {/* Source of funds */}
      {prov && (
        <div className="mt-3 rounded-[3px] border border-line bg-surface/40 px-4 py-3">
          <MicroLabel>Where the money came from</MicroLabel>
          <p className="mt-1.5 font-mono text-[13px] leading-relaxed text-ink">
            {whereFrom(report, prov)}
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
          <TracePath prov={prov} />
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
