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
import {
  buildScreening,
  CATEGORY_META,
  type ScreeningReport,
} from "@/lib/screening";
import {
  traceProvenance,
  type ProvenanceHop,
  type ProvenanceResult,
} from "@/lib/provenance";
import { riskRamp, C } from "@/lib/colors";
import { formatBtc, formatPercent, truncateHash } from "@/lib/format";
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
    return `The dominant value path reaches ${prov.originLabel?.name} ${prov.hops} hops back.`;

  // Unresolved (hop limit / dead-end). Frame it as a finding, not a failure.
  if (!prov.taintOnPath)
    return `No exchange, mining, or flagged origin on the dominant value path — and no taint on it — across ${prov.hops} hops${back}. The coins have no labelled origin in our data; the main money trail is clean${
      r.score >= 25 ? ", so any risk in the verdict comes from the exposure below." : "."
    }`;

  return `Traced ${prov.hops} hops${back}: the coins passed through the flagged steps below, but their ultimate origin has no label in our data.`;
}

const SAMPLES = [
  { label: "A hack wallet (bad)", q: "1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF" },
  { label: "Traces to an exchange", q: "1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s" },
];

function hopColor(h: ProvenanceHop): string {
  if (h.kind === "flagged") return C.taint;
  if (h.kind === "exchange" || h.kind === "coinbase") return C.clean;
  if (h.isCoinjoin) return C.mix;
  if (h.category) return riskRamp(CATEGORY_META[h.category].risk * 100);
  return C.dim;
}

function HopRow({
  h,
  last,
}: {
  h: ProvenanceHop;
  last: boolean;
}) {
  const yr = h.blockTime ? new Date(h.blockTime * 1000).getUTCFullYear() : null;
  const color = hopColor(h);
  const marker =
    h.kind === "coinbase"
      ? "⛏ minted"
      : h.kind === "exchange"
        ? "🏦 exchange"
        : h.kind === "flagged"
          ? "⚑ flagged"
          : h.isCoinjoin
            ? "⧓ coinjoin"
            : null;
  return (
    <li className="flex gap-2.5">
      <div className="flex flex-col items-center pt-1">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 5px ${color}` }}
        />
        {!last && <span className="w-px flex-1 bg-line" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-2.5"}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-[11px] tabular-nums text-faint">
            {h.blockHeight ? `#${h.blockHeight.toLocaleString()}` : "mempool"}
            {yr ? ` · ${yr}` : ""}
          </span>
          {marker && (
            <span className="font-mono text-[10px]" style={{ color }}>
              {marker}
            </span>
          )}
          {h.label && (
            <span
              className="rounded-[2px] px-1 font-mono text-[10px]"
              style={{ color, background: `color-mix(in oklch, ${color} 14%, transparent)` }}
            >
              {h.label}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <a
            href={`/explore?q=${h.txid}`}
            className="font-mono text-[11px] text-dim transition-colors hover:text-accent"
          >
            {truncateHash(h.txid, 8)}
          </a>
          {h.valueSat != null && (
            <span className="font-mono text-[11px] tabular-nums text-accent">
              {formatBtc(h.valueSat)} BTC
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

// Vertical hop-by-hop graph of the dominant value path, back toward origin.
function TracePath({ prov }: { prov: ProvenanceResult }) {
  if (!prov.path.length) return null;
  const resolved =
    prov.origin === "coinbase" ||
    prov.origin === "exchange" ||
    prov.origin === "flagged";

  return (
    <div className="mt-3 border-t border-line pt-3">
      <MicroLabel>
        Trace · dominant value path · {prov.path.length} hop
        {prov.path.length === 1 ? "" : "s"}
      </MicroLabel>
      <ol className="mt-2 max-h-72 overflow-y-auto pr-1">
        {prov.path.map((h, i) => (
          <HopRow key={h.txid + i} h={h} last={i === prov.path.length - 1} />
        ))}
      </ol>

      {!resolved && (
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
          The trace stops here at our {prov.hops}-hop depth cap — not at a true
          origin. A typical coin merges with others at almost every hop, so its
          path never converges to a single &ldquo;genesis&rdquo; coinbase: there
          are effectively millions of merged coinbases behind it. We follow the
          single largest input as the dominant money trail. To trace deeper
          without public-API limits, point HEURISTIC at your own node in{" "}
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
          maxHops: 60,
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
