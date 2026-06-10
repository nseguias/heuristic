"use client";

import { C, clusterColor, RISK_LABEL, riskRamp } from "@/lib/colors";
import {
  btcAria,
  formatBtc,
  formatFeeRate,
  formatTimestamp,
  formatVsize,
  truncateHash,
} from "@/lib/format";
import { AddressClusters } from "@/lib/cluster";
import { labelFor } from "@/lib/labels";
import type { GraphNode, TraceGraph } from "@/lib/types";
import {
  ConfidenceBar,
  Copyable,
  Dot,
  MicroLabel,
  Pill,
  Stat,
} from "./ui";

interface Props {
  graph: TraceGraph;
  node: GraphNode | null;
  onTraceFrom: (txid: string) => void;
}

const KIND_NAME: Record<string, string> = {
  whirlpool: "Whirlpool",
  wasabi: "Wasabi 1",
  wasabi2: "Wasabi 2 (WabiSabi)",
  joinmarket: "JoinMarket",
  generic: "Generic CoinJoin",
};

export default function Inspector({ graph, node, onTraceFrom }: Props) {
  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="blink font-mono text-sm text-faint">▮</span>
        <MicroLabel>Awaiting selection</MicroLabel>
        <p className="max-w-[200px] font-mono text-[11px] leading-relaxed text-dim">
          Select a node on the canvas to inspect its structure, heuristics, and
          taint lineage.
        </p>
      </div>
    );
  }

  const { tx, analysis } = node;
  const totalOut = tx.vout.reduce((s, v) => s + v.value, 0);
  const totalIn = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
  const risk = analysis.risk;
  const riskColor = riskRamp(risk);

  // Reconstruct a clusters helper to print cluster tags for addresses.
  const clusters = new AddressClusters();
  for (const [addr, root] of graph.addressCluster) clusters.union(addr, root);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <MicroLabel>Transaction</MicroLabel>
          {node.id === graph.origin && (
            <Pill color={C.accent} filled>
              origin
            </Pill>
          )}
        </div>
        <div className="mt-1">
          <Copyable
            value={tx.txid}
            display={truncateHash(tx.txid, 10)}
            className="text-[13px]"
          />
        </div>
        <div className="mt-1 font-mono text-[11px] text-dim">
          {formatTimestamp(tx.status.block_time)}
          {tx.status.block_height ? ` · #${tx.status.block_height}` : ""}
        </div>
      </div>

      {/* Risk meter */}
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <MicroLabel>Exchange-acceptance risk</MicroLabel>
          <span
            className="font-mono text-[11px] uppercase tracking-wider"
            style={{ color: riskColor }}
          >
            {RISK_LABEL[analysis.riskBand]}
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span
            className="font-mono text-[28px] leading-none tabular-nums"
            style={{ color: riskColor }}
          >
            {Math.round(risk)}
          </span>
          <span className="font-mono text-[11px] text-faint">/ 100</span>
        </div>
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
          Higher = less likely a regulated exchange accepts these coins / more
          likely to be flagged or frozen.
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${risk}%`, background: riskColor }}
          />
        </div>
        {analysis.riskReasons.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {analysis.riskReasons.map((r, i) => (
              <li key={i} className="font-mono text-[11px] text-dim">
                → {r}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Flags */}
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3">
        {analysis.coinjoin.isCoinjoin && (
          <Pill color={C.mix}>
            <Dot color={C.mix} />
            {KIND_NAME[analysis.coinjoin.kind ?? "generic"]}
          </Pill>
        )}
        {analysis.isPeelChain && <Pill color={C.warn}>peel chain</Pill>}
        {analysis.isConsolidation && <Pill color={C.dim}>consolidation</Pill>}
        {tx.vin.some((v) => v.is_coinbase) && (
          <Pill color={C.clean}>⛏ coinbase</Pill>
        )}
        {analysis.signals.map((s) => (
          <span key={s.key} title={s.detail}>
            <Pill color={C.dim}>{s.label}</Pill>
          </span>
        ))}
        {!analysis.coinjoin.isCoinjoin &&
          !analysis.isPeelChain &&
          !analysis.isConsolidation &&
          analysis.signals.length === 0 && (
            <span className="font-mono text-[11px] text-faint">
              no structural flags
            </span>
          )}
      </div>

      {/* CoinJoin detail */}
      {analysis.coinjoin.isCoinjoin && (
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <MicroLabel>CoinJoin analysis</MicroLabel>
            <ConfidenceBar value={analysis.coinjoin.confidence} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Stat label="Equal outs" accent={C.mix}>
              {analysis.coinjoin.equalOutputCount}
            </Stat>
            <Stat label="Denomination" accent={C.mix}>
              {formatBtc(analysis.coinjoin.denomination)}
            </Stat>
          </div>
          <ul className="mt-2 space-y-0.5">
            {analysis.coinjoin.reasons.map((r, i) => (
              <li key={i} className="font-mono text-[11px] text-dim">
                → {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Money flow — BTC amounts in brand orange per the colour convention */}
      <div className="grid grid-cols-3 gap-3 border-b border-line px-4 py-3">
        <Stat label="In" accent={C.accent}>
          {formatBtc(totalIn)}
        </Stat>
        <Stat label="Out" accent={C.accent}>
          {formatBtc(totalOut)}
        </Stat>
        <Stat label="Fee" accent={C.warn}>
          {formatFeeRate(tx.fee, tx.weight)}
        </Stat>
        <Stat label="Inputs">{tx.vin.length}</Stat>
        <Stat label="Outputs">{tx.vout.length}</Stat>
        <Stat label="Size">{formatVsize(tx.weight)}</Stat>
      </div>

      {/* Change detection */}
      {tx.vout.length === 2 && analysis.change.changeIndex !== null && (
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <MicroLabel>Change detection</MicroLabel>
            <ConfidenceBar value={analysis.change.confidence} />
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-ink">
            output #{analysis.change.changeIndex} is likely change
          </p>
          {analysis.change.reasons.map((r, i) => (
            <p key={i} className="font-mono text-[11px] text-dim">
              → {r}
            </p>
          ))}
        </div>
      )}

      {/* Inputs / outputs ledger */}
      <div className="border-b border-line px-4 py-3">
        <MicroLabel>Inputs · {tx.vin.length}</MicroLabel>
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
          ·TAG = entity cluster (addresses co-spent here are inferred co-owned).
          Matching colour = same cluster.
        </p>
        <div className="mt-1.5 space-y-1">
          {tx.vin.slice(0, 8).map((v, i) => (
            <Row
              key={i}
              addr={v.prevout?.scriptpubkey_address}
              value={v.prevout?.value}
              tag={
                v.is_coinbase
                  ? "COINBASE"
                  : v.prevout?.scriptpubkey_address
                    ? clusters.clusterTag(v.prevout.scriptpubkey_address)
                    : undefined
              }
              tagColor={
                v.prevout?.scriptpubkey_address
                  ? clusterColor(clusters.clusterId(v.prevout.scriptpubkey_address))
                  : undefined
              }
            />
          ))}
          {tx.vin.length > 8 && (
            <p className="font-mono text-[11px] text-faint">
              +{tx.vin.length - 8} more inputs
            </p>
          )}
        </div>
        <div className="mt-3">
          <MicroLabel>Outputs · {tx.vout.length}</MicroLabel>
        </div>
        <div className="mt-1.5 space-y-1">
          {tx.vout.slice(0, 8).map((v, i) => (
            <Row
              key={i}
              addr={v.scriptpubkey_address}
              value={v.value}
              isChange={analysis.change.changeIndex === i}
              tag={
                v.scriptpubkey_address
                  ? clusters.clusterTag(v.scriptpubkey_address)
                  : v.scriptpubkey_type.toUpperCase()
              }
              tagColor={
                v.scriptpubkey_address
                  ? clusterColor(clusters.clusterId(v.scriptpubkey_address))
                  : undefined
              }
            />
          ))}
          {tx.vout.length > 8 && (
            <p className="font-mono text-[11px] text-faint">
              +{tx.vout.length - 8} more outputs
            </p>
          )}
        </div>
      </div>

      {/* Action */}
      <div className="mt-auto border-t border-line p-3">
        <button
          type="button"
          onClick={() => onTraceFrom(tx.txid)}
          className="w-full rounded-[2px] border border-accent/40 bg-accent-dim py-2 font-mono text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent hover:text-bg"
        >
          ⟲ Re-center trace here
        </button>
      </div>
    </div>
  );
}

function Row({
  addr,
  value,
  tag,
  tagColor,
  isChange,
}: {
  addr?: string;
  value?: number;
  tag?: string;
  tagColor?: string;
  isChange?: boolean;
}) {
  const label = addr ? labelFor(addr) : undefined;
  return (
    <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
      <div className="flex min-w-0 items-center gap-1.5">
        {label ? (
          <a
            href={`/address/${addr}`}
            className="shrink-0 text-[9px] uppercase tracking-wide hover:underline"
            style={{ color: label.risk > 0.5 ? C.taint : C.clean }}
            title={label.note}
          >
            ◆ {label.name}
          </a>
        ) : addr ? (
          <a
            href={`/address/${addr}`}
            className="truncate text-dim hover:text-accent hover:underline"
            title={addr}
          >
            {truncateHash(addr, 6)}
          </a>
        ) : (
          <span className="truncate text-dim">non-standard</span>
        )}
        {tag && (
          <span
            className="shrink-0 text-[9px]"
            style={{ color: tagColor ?? "var(--text-faint)" }}
            title="entity cluster tag"
          >
            ·{tag}
          </span>
        )}
        {isChange && (
          <span className="shrink-0 text-[9px] uppercase text-warn">chg</span>
        )}
      </div>
      <span
        className="shrink-0 tabular-nums"
        style={{ color: "var(--accent)" }}
        aria-label={btcAria(value)}
      >
        {formatBtc(value)}
      </span>
    </div>
  );
}
