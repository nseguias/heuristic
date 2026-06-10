"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import GraphCanvas, { type GraphControls } from "./GraphCanvas";
import Inspector from "./Inspector";
import ControlRail from "./ControlRail";
import Legend from "./Legend";
import SearchBar from "./SearchBar";
import ExampleCards from "./ExampleCards";
import { MicroLabel } from "./ui";
import { classifyQuery, fetchAddressTxs } from "@/lib/api";
import { trace, type TraceDirection } from "@/lib/trace";
import { C, riskRamp } from "@/lib/colors";
import { formatBtc, truncateHash } from "@/lib/format";
import type { GraphNode, TraceGraph } from "@/lib/types";

type Status =
  | { phase: "idle" }
  | { phase: "loading"; loaded: number; frontier: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export default function Explorer() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const urlDir = params.get("dir") as TraceDirection | null;
  const urlDepth = params.get("depth");

  const [graph, setGraph] = useState<TraceGraph | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [depth, setDepth] = useState(3);
  const [direction, setDirection] = useState<TraceDirection>("both");
  const [nodeBudget, setNodeBudget] = useState(150);
  const [controlsSheet, setControlsSheet] = useState(false);
  const [inspectorSheet, setInspectorSheet] = useState(false);
  const reqId = useRef(0);
  const graphControls = useRef<GraphControls | null>(null);

  // Adopt direction/depth carried by example links (one-way, on mount/q change).
  useEffect(() => {
    if (urlDir && ["ancestors", "descendants", "both"].includes(urlDir))
      setDirection(urlDir);
    const d = Number(urlDepth);
    if (d >= 1 && d <= 8) setDepth(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const runTrace = useCallback(
    async (
      query: string,
      d: number,
      dir: TraceDirection,
      budget: number
    ) => {
      const id = ++reqId.current;
      setStatus({ phase: "loading", loaded: 0, frontier: 0 });
      setSelected(null);
      try {
        const kind = classifyQuery(query);
        let seedTxid = query;
        if (kind === "address") {
          // Anchor an address trace on its most recent transaction.
          const txs = await fetchAddressTxs(query);
          if (!txs.length) throw new Error("no transactions for this address");
          seedTxid = txs[0].txid;
        } else if (kind === "invalid") {
          throw new Error("not a valid txid or address");
        }

        const g = await trace(seedTxid, {
          depth: d,
          direction: dir,
          maxNodes: budget,
          onProgress: (loaded, frontier) => {
            if (id === reqId.current)
              setStatus({ phase: "loading", loaded, frontier });
          },
        });
        if (id !== reqId.current) return;
        setGraph(g);
        setSelected(g.origin);
        setStatus({ phase: "ready" });
      } catch (e) {
        if (id !== reqId.current) return;
        setStatus({
          phase: "error",
          message: e instanceof Error ? e.message : "trace failed",
        });
      }
    },
    []
  );

  // Run whenever the URL query or trace params change; reset to idle if cleared.
  useEffect(() => {
    if (q) {
      runTrace(q, depth, direction, nodeBudget);
    } else {
      setGraph(null);
      setSelected(null);
      setStatus({ phase: "idle" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, depth, direction, nodeBudget]);

  const submit = (query: string) => {
    router.push(`/explore?q=${encodeURIComponent(query)}`);
  };

  const traceFrom = (txid: string) => {
    router.push(`/explore?q=${txid}`);
  };

  const selectedNode = useMemo(
    () => (graph && selected ? graph.nodes.get(selected) ?? null : null),
    [graph, selected]
  );

  const summary = useMemo(() => {
    if (!graph) return null;
    const nodes = [...graph.nodes.values()];
    return {
      txs: nodes.length,
      coinjoins: nodes.filter((n) => n.analysis.coinjoin.isCoinjoin).length,
      flagged: nodes.filter(
        (n) => n.analysis.riskBand === "high" || n.analysis.riskBand === "critical"
      ).length,
      clusters: new Set(graph.addressCluster.values()).size,
    };
  }, [graph]);

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      {/* Top search strip */}
      <div className="flex items-center gap-3 border-b border-line bg-surface/60 px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            title="Back"
            className="rounded-[2px] border border-line px-2.5 py-2 font-mono text-[13px] text-dim transition-colors hover:border-accent/40 hover:text-accent"
          >
            ←
          </button>
          <Link
            href="/explore"
            title="Browse examples"
            className="rounded-[2px] border border-line px-2.5 py-2 font-mono text-[12px] text-dim transition-colors hover:border-accent/40 hover:text-accent"
          >
            ⋯ <span className="hidden sm:inline">examples</span>
          </Link>
          {/* Mobile-only controls toggle (desktop has the left rail). */}
          <button
            type="button"
            onClick={() => setControlsSheet(true)}
            className="rounded-[2px] border border-line px-2.5 py-2 font-mono text-[12px] text-dim transition-colors hover:border-accent/40 hover:text-accent lg:hidden"
            aria-label="Trace controls"
          >
            ⚙
          </button>
        </div>
        <div className="max-w-xl flex-1">
          <SearchBar
            key={q}
            initial={q}
            onSubmit={submit}
            compact
            busy={status.phase === "loading"}
          />
        </div>
        {summary && (
          <div className="hidden items-center gap-5 md:flex">
            <Metric
              label="Txs"
              value={summary.txs}
              note={summary.txs >= nodeBudget ? "cap" : undefined}
            />
            <Metric label="Clusters" value={summary.clusters} />
            <Metric label="CoinJoins" value={summary.coinjoins} color={C.mix} />
            <Metric
              label="Flagged"
              value={summary.flagged}
              color={summary.flagged ? C.taint : undefined}
            />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left control rail */}
        <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface/40 lg:flex">
          <ControlRail
            depth={depth}
            direction={direction}
            nodeBudget={nodeBudget}
            onDepth={setDepth}
            onDirection={setDirection}
            onNodeBudget={setNodeBudget}
          />
          <div className="mt-auto border-t border-line p-4">
            <MicroLabel>Heuristics active</MicroLabel>
            <ul className="mt-2 space-y-1.5 font-mono text-[12px] text-dim">
              <li>→ common-input clustering</li>
              <li>→ coinjoin fingerprinting</li>
              <li>→ change-output detection</li>
              <li>→ peel-chain / consolidation</li>
              <li>→ ancestry taint propagation</li>
            </ul>
          </div>
        </aside>

        {/* Canvas */}
        <main className="relative min-w-0 flex-1">
          {graph && status.phase !== "loading" && (
            <>
              <GraphCanvas
                graph={graph}
                selected={selected}
                onSelect={setSelected}
                onRecenter={traceFrom}
                controls={graphControls}
              />
              <Legend />
              <GraphControlsOverlay controls={graphControls} />
              {selectedNode && (
                <MobilePeek
                  node={selectedNode}
                  isOrigin={selectedNode.id === graph.origin}
                  onOpen={() => setInspectorSheet(true)}
                />
              )}
            </>
          )}

          {status.phase === "loading" && (
            <LoadingState
              loaded={status.loaded}
              frontier={status.frontier}
            />
          )}
          {status.phase === "idle" && !graph && <IdleState />}
          {status.phase === "error" && (
            <ErrorState
              message={status.message}
              onRetry={() => q && runTrace(q, depth, direction, nodeBudget)}
            />
          )}
        </main>

        {/* Right inspector */}
        <aside className="hidden w-[22rem] shrink-0 border-l border-line bg-surface/40 xl:block">
          {graph ? (
            <Inspector
              graph={graph}
              node={selectedNode}
              onTraceFrom={traceFrom}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="font-mono text-[11px] text-faint">
                Inspector idle. Run a trace to populate.
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Mobile: controls sheet (desktop uses the left rail) */}
      {controlsSheet && (
        <MobileSheet
          title="Trace controls"
          onClose={() => setControlsSheet(false)}
          className="lg:hidden"
        >
          <ControlRail
            depth={depth}
            direction={direction}
            nodeBudget={nodeBudget}
            onDepth={setDepth}
            onDirection={setDirection}
            onNodeBudget={setNodeBudget}
          />
        </MobileSheet>
      )}

      {/* Mobile: inspector sheet (desktop uses the right aside) */}
      {inspectorSheet && graph && selectedNode && (
        <MobileSheet
          title="Inspector"
          onClose={() => setInspectorSheet(false)}
          className="xl:hidden"
        >
          <Inspector graph={graph} node={selectedNode} onTraceFrom={traceFrom} />
        </MobileSheet>
      )}
    </div>
  );
}

function MobilePeek({
  node,
  isOrigin,
  onOpen,
}: {
  node: GraphNode;
  isOrigin: boolean;
  onOpen: () => void;
}) {
  const total = node.tx.vout.reduce((s, v) => s + v.value, 0);
  const color = riskRamp(node.analysis.risk);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-line bg-surface/95 px-3 py-2.5 text-left backdrop-blur-sm xl:hidden"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="min-w-0 font-mono text-[12px] text-ink">
        {truncateHash(node.id, 6)}
        {isOrigin && <span className="ml-1.5 text-[9px] uppercase text-accent">origin</span>}
      </span>
      <span
        className="ml-auto shrink-0 font-mono text-[12px] tabular-nums"
        style={{ color: "var(--accent)" }}
      >
        {formatBtc(total)} BTC
      </span>
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-dim">
        details ▸
      </span>
    </button>
  );
}

function MobileSheet({
  title,
  onClose,
  className = "",
  children,
}: {
  title: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`fixed inset-0 z-50 ${className}`}>
      <div
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fade-up absolute inset-x-0 bottom-0 max-h-[78vh] overflow-hidden rounded-t-[6px] border-t border-line-strong bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <MicroLabel>{title}</MicroLabel>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[2px] border border-line px-2 py-1 font-mono text-[12px] text-dim"
          >
            close
          </button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  color,
  note,
}: {
  label: string;
  value: number;
  color?: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col">
      <MicroLabel>{label}</MicroLabel>
      <span className="flex items-baseline gap-1">
        <span
          className="font-mono text-[17px] tabular-nums"
          style={color ? { color } : undefined}
        >
          {value}
        </span>
        {note && (
          <span
            className="font-mono text-[9px] uppercase tracking-wider text-warn"
            title="Trace hit the node cap — raising depth won't add more. Re-center deeper to continue."
          >
            {note}
          </span>
        )}
      </span>
    </div>
  );
}

function GraphControlsOverlay({
  controls,
}: {
  controls: React.MutableRefObject<GraphControls | null>;
}) {
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-[2px] border border-line bg-surface/80 font-mono text-[14px] text-dim backdrop-blur-sm transition-colors hover:border-accent/40 hover:text-accent";
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        className={btn}
        onClick={() => controls.current?.zoomBy(1.25)}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        className={btn}
        onClick={() => controls.current?.zoomBy(0.8)}
      >
        −
      </button>
      <button
        type="button"
        aria-label="Fit to view"
        title="Fit graph to view"
        className={btn}
        onClick={() => controls.current?.fit()}
      >
        ⊡
      </button>
    </div>
  );
}

function LoadingState({
  loaded,
  frontier,
}: {
  loaded: number;
  frontier: number;
}) {
  return (
    <div className="dotgrid flex h-full flex-col items-center justify-center gap-3">
      <div className="flex items-center gap-2">
        <span className="blink font-mono text-accent">◍</span>
        <span className="font-mono text-sm text-ink">walking the chain</span>
      </div>
      <div className="font-mono text-[11px] tabular-nums text-dim">
        {loaded} transactions resolved · {frontier} on frontier
      </div>
      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.min(100, loaded * 2)}%` }}
        />
      </div>
    </div>
  );
}

function IdleState() {
  return (
    <div className="dotgrid h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-6 py-10">
        <div className="flex items-center gap-2">
          <span className="blink font-mono text-faint">▮</span>
          <MicroLabel>Awaiting target — or start from a case</MicroLabel>
        </div>
        <p className="mt-2 max-w-lg font-mono text-[13px] leading-relaxed text-dim">
          Enter a transaction id or address above, or open one of these curated
          investigations to see the heuristics at work.
        </p>
        <div className="mt-6">
          <ExampleCards />
        </div>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="dotgrid flex h-full flex-col items-center justify-center gap-3">
      <span className="font-mono text-taint">⚠ trace fault</span>
      <p className="max-w-xs text-center font-mono text-[11px] text-dim">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-[2px] border border-line px-3 py-1 font-mono text-[11px] text-dim transition-colors hover:border-accent/40 hover:text-accent"
      >
        retry
      </button>
    </div>
  );
}
