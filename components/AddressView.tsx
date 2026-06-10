"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchAddress,
  fetchAddressTxs,
} from "@/lib/api";
import { fetchTx } from "@/lib/api";
import { trace } from "@/lib/trace";
import { buildScreening, type ScreeningReport } from "@/lib/screening";
import { traceProvenance, type ProvenanceResult } from "@/lib/provenance";
import { addWatch, loadWatchlist } from "@/lib/watchlist";
import { labelFor } from "@/lib/labels";
import {
  btcAria,
  formatBtc,
  formatCount,
  formatPercent,
  formatTimestamp,
  truncateHash,
} from "@/lib/format";
import type { EsploraAddressInfo, EsploraTx } from "@/lib/types";
import { Copyable, MicroLabel, Pill } from "./ui";
import { C, RISK_LABEL, riskRamp } from "@/lib/colors";

interface Props {
  address: string;
}

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; info: EsploraAddressInfo; txs: EsploraTx[] };

export default function AddressView({ address }: Props) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [watched, setWatched] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [screening, setScreening] = useState<ScreeningReport | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceResult | null>(null);
  const label = labelFor(address);

  // Responsive truncation decided after mount to avoid a hydration mismatch.
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    setWatched(loadWatchlist().some((w) => w.address === address));
    setScreening(null);
    setProvenance(null);
    let live = true;
    (async () => {
      try {
        const [info, txs] = await Promise.all([
          fetchAddress(address),
          fetchAddressTxs(address),
        ]);
        if (!live) return;
        setState({ phase: "ready", info, txs });

        // Screening: direct counterparties from txs + indirect exposure from a
        // shallow ancestry/descendant trace of the most recent transaction.
        if (txs.length) {
          const graph = await trace(txs[0].txid, {
            direction: "both",
            depth: 3,
            maxNodes: 80,
          }).catch(() => undefined);
          if (live) setScreening(buildScreening(address, txs, graph));

          // Source-of-funds: walk the most recent tx back toward its origin.
          const prov = await traceProvenance(txs[0].txid, fetchTx, {
            maxHops: 40,
          }).catch(() => null);
          if (live && prov) setProvenance(prov);
        } else if (live) {
          setScreening(buildScreening(address, txs));
        }
      } catch (e) {
        if (live)
          setState({
            phase: "error",
            message: e instanceof Error ? e.message : "lookup failed",
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <MicroLabel>Address</MicroLabel>
          <div className="mt-1 break-all">
            <Copyable
              value={address}
              display={narrow ? truncateHash(address, 10) : address}
              className="text-[15px]"
            />
          </div>
          {label && (
            <div className="mt-2 flex items-center gap-2">
              <Pill color={label.risk > 0.5 ? C.taint : C.clean}>
                ◆ {label.name}
              </Pill>
              {label.note && (
                <span className="font-mono text-[11px] text-dim">
                  {label.note}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => {
              addWatch(address);
              setWatched(true);
            }}
            disabled={watched}
            className="rounded-[2px] border border-line px-3 py-2 font-mono text-[12px] text-dim transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
          >
            {watched ? "✓ watching" : "+ watch"}
          </button>
          <Link
            href={`/explore?q=${address}`}
            className="rounded-[2px] bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-bg transition-opacity hover:opacity-90"
          >
            Trace →
          </Link>
        </div>
      </div>

      {state.phase === "loading" && (
        <div className="flex h-40 items-center justify-center">
          <span className="blink font-mono text-faint">▮ resolving address…</span>
        </div>
      )}

      {state.phase === "error" && (
        <div className="flex h-40 flex-col items-center justify-center gap-2">
          <span className="font-mono text-taint">⚠ {state.message}</span>
          <Link
            href="/explore"
            className="font-mono text-[12px] text-dim hover:text-accent"
          >
            back to explorer
          </Link>
        </div>
      )}

      {state.phase === "ready" && (
        <Ready
          address={address}
          info={state.info}
          txs={state.txs}
          screening={screening}
          provenance={provenance}
        />
      )}
    </main>
  );
}

function Ready({
  address,
  info,
  txs,
  screening,
  provenance,
}: {
  address: string;
  info: EsploraAddressInfo;
  txs: EsploraTx[];
  screening: ScreeningReport | null;
  provenance: ProvenanceResult | null;
}) {
  const cs = info.chain_stats;
  const balance = cs.funded_txo_sum - cs.spent_txo_sum;
  // Esplora returns newest-first; derive first/last seen from confirmed txs.
  const confirmed = txs.filter((t) => t.status.confirmed);
  const last = confirmed[0]?.status.block_time;
  const first = confirmed[confirmed.length - 1]?.status.block_time;

  return (
    <>
      <Screening report={screening} address={address} />
      <Provenance result={provenance} />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Balance" value={formatBtc(balance)} unit="BTC" big />
        <Metric
          label="Received"
          value={formatBtc(cs.funded_txo_sum)}
          unit="BTC"
        />
        <Metric label="Sent" value={formatBtc(cs.spent_txo_sum)} unit="BTC" />
        <Metric label="Transactions" value={formatCount(cs.tx_count)} unit="" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="UTXOs" value={String(cs.funded_txo_count - cs.spent_txo_count)} unit="" small />
        <Metric label="First seen" value={first ? formatTimestamp(first).slice(0, 11) : "—"} unit="" small />
        <Metric label="Last seen" value={last ? formatTimestamp(last).slice(0, 11) : "—"} unit="" small />
      </div>

      {/* Recent transactions */}
      <div className="mt-6">
        <MicroLabel>Recent transactions · showing {txs.length}</MicroLabel>
        <div className="mt-2 overflow-hidden rounded-[3px] border border-line">
          {txs.length === 0 && (
            <div className="flex h-24 items-center justify-center font-mono text-[12px] text-faint">
              no transactions
            </div>
          )}
          {txs.map((tx) => {
            const received = tx.vout
              .filter((v) => v.scriptpubkey_address === address)
              .reduce((s, v) => s + v.value, 0);
            const spent = tx.vin
              .filter((v) => v.prevout?.scriptpubkey_address === address)
              .reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
            const net = received - spent;
            return (
              <Link
                key={tx.txid}
                href={`/explore?q=${tx.txid}`}
                className="flex items-center gap-3 border-b border-line px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-2"
              >
                <span className="font-mono text-[12px] text-dim">
                  {truncateHash(tx.txid, 6)}
                </span>
                <span className="hidden font-mono text-[11px] text-faint sm:inline">
                  {tx.status.block_height
                    ? `#${tx.status.block_height}`
                    : "mempool"}
                </span>
                <span
                  className="ml-auto font-mono text-[12px] tabular-nums"
                  style={{ color: net >= 0 ? "var(--clean)" : "var(--taint)" }}
                  aria-label={btcAria(net)}
                >
                  {net >= 0 ? "+" : "−"}
                  {formatBtc(Math.abs(net))} BTC
                </span>
              </Link>
            );
          })}
        </div>
        <p className="mt-2 font-mono text-[10px] text-faint">
          Clustering and taint are computed in the{" "}
          <Link href={`/explore?q=${address}`} className="text-dim underline hover:text-accent">
            graph explorer
          </Link>
          .
        </p>
      </div>
    </>
  );
}

const ORIGIN_LABEL: Record<ProvenanceResult["origin"], string> = {
  coinbase: "⛏ Coinbase (freshly mined)",
  exchange: "KYC exchange",
  flagged: "Flagged entity",
  "depth-limit": "Unresolved (hop limit)",
  "dead-end": "Unresolved",
};

function Provenance({ result }: { result: ProvenanceResult | null }) {
  if (!result) {
    return (
      <div className="mt-4 rounded-[3px] border border-line bg-surface/40 px-4 py-5">
        <div className="flex items-center gap-2">
          <span className="blink font-mono text-accent">◍</span>
          <MicroLabel>
            Source of funds — tracing back toward origin…
          </MicroLabel>
        </div>
      </div>
    );
  }

  const color = riskRamp(result.score);
  const originColor =
    result.origin === "coinbase" || result.origin === "exchange"
      ? "var(--clean)"
      : result.origin === "flagged"
        ? "var(--taint)"
        : "var(--text-dim)";

  return (
    <div className="mt-4 overflow-hidden rounded-[3px] border border-line bg-surface/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <MicroLabel>Source of funds · provenance</MicroLabel>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="font-mono text-[14px]"
              style={{ color: originColor }}
            >
              {ORIGIN_LABEL[result.origin]}
              {result.origin === "coinbase" && result.originBlock
                ? ` · block ${result.originBlock.toLocaleString()}`
                : ""}
              {result.originLabel ? ` · ${result.originLabel.name}` : ""}
            </span>
          </div>
        </div>
        <div className="text-right">
          <MicroLabel>Path risk</MicroLabel>
          <div className="font-mono text-[18px] tabular-nums" style={{ color }}>
            {Math.round(result.score)}
            <span className="ml-1 text-[10px] text-faint">/ 100</span>
          </div>
        </div>
      </div>
      <div className="px-4 py-2.5 font-mono text-[12px] text-dim">
        Followed the dominant value path back{" "}
        <span className="text-ink">{result.hops} hops</span>
        {result.reachedGenesis
          ? " — reached freshly-mined coins with a clean lineage."
          : result.origin === "exchange"
            ? " — funds originate from a KYC exchange."
            : result.origin === "flagged"
              ? " — lineage hits a flagged entity."
              : " — origin not resolved within the hop limit; re-check on a node for deeper history."}
      </div>
      {result.events.length > 0 && (
        <ul className="space-y-0.5 border-t border-line px-4 py-2.5">
          {result.events.map((e, i) => (
            <li
              key={i}
              className="font-mono text-[11px]"
              style={{ color: e.risk >= 50 ? "var(--warn)" : "var(--text-dim)" }}
            >
              → hop {e.hop}: {e.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  big,
  small,
}: {
  label: string;
  value: string;
  unit: string;
  big?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded-[3px] border border-line bg-surface/40 px-3 py-2.5">
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className={`font-mono tabular-nums ${
            big ? "text-[22px]" : small ? "text-[14px]" : "text-[18px]"
          }`}
          style={unit === "BTC" ? { color: "var(--accent)" } : undefined}
        >
          {value}
        </span>
        {unit && <span className="font-mono text-[11px] text-faint">{unit}</span>}
      </div>
    </div>
  );
}

function Screening({
  report,
  address,
}: {
  report: ScreeningReport | null;
  address: string;
}) {
  if (!report) {
    return (
      <div className="mt-4 rounded-[3px] border border-line bg-surface/40 px-4 py-5">
        <div className="flex items-center gap-2">
          <span className="blink font-mono text-accent">◍</span>
          <MicroLabel>Risk screening — analysing exposure…</MicroLabel>
        </div>
      </div>
    );
  }

  const color = riskRamp(report.score);
  return (
    <div className="mt-4 overflow-hidden rounded-[3px] border border-line-strong bg-surface/50">
      {/* Headline */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <MicroLabel>Risk screening</MicroLabel>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className="font-mono text-[30px] leading-none tabular-nums"
              style={{ color }}
            >
              {Math.round(report.score)}
            </span>
            <span className="font-mono text-[11px] text-faint">/ 100</span>
            <span
              className="ml-1 font-mono text-[12px] uppercase tracking-wider"
              style={{ color }}
            >
              {RISK_LABEL[report.band]}
            </span>
          </div>
        </div>
        <a
          href={`/api/screen/${address}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-[2px] border border-line px-2.5 py-1.5 font-mono text-[11px] text-dim transition-colors hover:border-accent/40 hover:text-accent"
          title="Machine-readable screening result"
        >
          {"{ }"} API
        </a>
      </div>

      {report.sanctioned && (
        <div className="border-b border-line bg-taint/10 px-4 py-2 font-mono text-[12px] text-taint">
          ⚠ Direct exposure to a sanctioned / stolen-funds entity.
        </div>
      )}

      {/* Exposure by category */}
      <div className="border-b border-line px-4 py-3">
        <MicroLabel>Exposure by category</MicroLabel>
        {report.exposures.length === 0 ? (
          <p className="mt-1.5 font-mono text-[12px] text-faint">
            No exposure to labelled entities in the analysed window.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {report.exposures.map((e) => (
              <div key={e.category} className="flex items-center gap-2">
                <span className="w-36 shrink-0 font-mono text-[11px] text-dim">
                  {e.name}
                  {!e.direct && (
                    <span className="ml-1 text-faint">· indirect</span>
                  )}
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
        )}
        <ul className="mt-2 space-y-0.5">
          {report.reasons.map((r, i) => (
            <li key={i} className="font-mono text-[10px] text-faint">
              → {r}
            </li>
          ))}
        </ul>
      </div>

      {/* Labelled counterparties */}
      {report.counterparties.length > 0 && (
        <div className="px-4 py-3">
          <MicroLabel>Labelled counterparties</MicroLabel>
          <div className="mt-2 space-y-1">
            {report.counterparties.map((c) => (
              <a
                key={`${c.address}:${c.direction}`}
                href={`/address/${c.address}`}
                className="flex items-center gap-2 font-mono text-[11px] hover:underline"
              >
                <span
                  className="shrink-0 text-[9px] uppercase tracking-wide"
                  style={{ color: c.risk > 0.5 ? C.taint : C.clean }}
                >
                  ◆ {c.name}
                </span>
                <span className="text-faint">
                  {c.direction === "received" ? "→ received from" : "← sent to"}
                </span>
                <span
                  className="ml-auto tabular-nums"
                  style={{ color: "var(--accent)" }}
                >
                  {formatBtc(c.value)} BTC
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
