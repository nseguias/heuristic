"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchAddressTxs,
  fetchBlockTxids,
  fetchBtcUsd,
  fetchMempoolRecent,
  fetchMempoolSeed,
  fetchMempoolStats,
  fetchTipHash,
  fetchTipHeight,
  type MempoolRecent,
  type MempoolStats,
} from "@/lib/api";
import MempoolRain from "./MempoolRain";
import { flagRecent, feeRateOf } from "@/lib/mempoolHeuristics";
import {
  addWatch,
  loadWatchlist,
  removeWatch,
  type Alert,
  type WatchEntry,
} from "@/lib/watchlist";
import { classifyQuery } from "@/lib/api";
import {
  formatBtc,
  formatCount,
  formatFeeRange,
  formatFeeRateValue,
  formatUsd,
  truncateHash,
} from "@/lib/format";
import { useDataSource } from "./SettingsModal";
import { MicroLabel } from "./ui";

const FEED_MAX = 400; // accumulate a browsable buffer
const PAGE_SIZE = 12;
const POLL_STATS = 6000;

type SortKey = "time" | "value" | "fee" | "size";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "time", label: "Time" },
  { key: "value", label: "Value" },
  { key: "fee", label: "Fee rate" },
  { key: "size", label: "Size" },
];
const POLL_WATCH = 20000;
const RATE_OPTIONS = [
  { ms: 1000, label: "1s" },
  { ms: 2000, label: "2s" },
  { ms: 4000, label: "4s" },
];

interface FeedTx extends MempoolRecent {
  seenAt: number;
  fresh: boolean;
}

export default function MempoolLive() {
  const router = useRouter();
  const source = useDataSource();
  const [stats, setStats] = useState<MempoolStats | null>(null);
  const [feed, setFeed] = useState<FeedTx[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [watch, setWatch] = useState<WatchEntry[]>([]);
  const [live, setLive] = useState(true);
  const [feedMs, setFeedMs] = useState(2000);
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [batch, setBatch] = useState<MempoolRecent[]>([]);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [blockFlash, setBlockFlash] = useState<{
    height: number;
    removed: number;
    total: number;
  } | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const seenTx = useRef<Set<string>>(new Set());
  const watchSeen = useRef<Map<string, Set<string>>>(new Map());
  const lastHeight = useRef<number | null>(null);

  // Auto-dismiss the "block mined" flash after a few seconds.
  useEffect(() => {
    if (!blockFlash) return;
    const t = setTimeout(() => setBlockFlash(null), 7000);
    return () => clearTimeout(t);
  }, [blockFlash]);

  useEffect(() => setWatch(loadWatchlist()), []);
  useEffect(() => {
    const onWatch = (e: Event) =>
      setWatch((e as CustomEvent<WatchEntry[]>).detail);
    window.addEventListener("heuristic:watchlist", onWatch);
    return () => window.removeEventListener("heuristic:watchlist", onWatch);
  }, []);

  const pushAlert = useCallback((a: Alert) => {
    setAlerts((prev) => [a, ...prev].slice(0, 40));
  }, []);

  // ── Live transaction feed ──────────────────────────────────────
  const pollFeed = useCallback(async () => {
    try {
      const recent = await fetchMempoolRecent();
      const fresh = recent.filter((t) => !seenTx.current.has(t.txid));
      if (!fresh.length) return;
      for (const t of fresh) seenTx.current.add(t.txid);
      // Cap the dedupe set so it can't grow unbounded.
      if (seenTx.current.size > 4000) {
        seenTx.current = new Set(
          [...seenTx.current].slice(-2000)
        );
      }
      const now = Date.now();
      const incoming: FeedTx[] = fresh.map((t) => ({
        ...t,
        seenAt: now,
        fresh: true,
      }));
      setFeed((prev) =>
        [...incoming, ...prev.map((p) => ({ ...p, fresh: false }))].slice(
          0,
          FEED_MAX
        )
      );
      // Feed the rain (cap the batch so a big poll can't flood it).
      setBatch(fresh.slice(0, 24));

      // Whale / high-fee alerts from the feed.
      for (const t of fresh) {
        const flags = flagRecent(t);
        if (flags.some((f) => f.kind === "whale"))
          pushAlert({
            id: `${t.txid}-whale`,
            kind: "whale",
            txid: t.txid,
            value: t.value,
            message: `Whale move · ${formatBtc(t.value)}`,
            at: now,
          });
        else if (flags.some((f) => f.kind === "highfee"))
          pushAlert({
            id: `${t.txid}-fee`,
            kind: "high-fee",
            txid: t.txid,
            message: `High fee · ${feeRateOf(t).toFixed(0)} sat/vB`,
            at: now,
          });
      }
    } catch {
      /* transient — next tick retries */
    }
  }, [pushAlert]);

  const pollStats = useCallback(async () => {
    try {
      setStats(await fetchMempoolStats());
    } catch {
      /* ignore */
    }
    const p = await fetchBtcUsd(Date.now());
    if (p) setPrice(p);

    // New block? Drop the transactions it confirmed — they've left the mempool.
    try {
      const h = await fetchTipHeight();
      if (lastHeight.current !== null && h > lastHeight.current) {
        const hash = await fetchTipHash();
        const txids = await fetchBlockTxids(hash);
        const set = new Set(txids);
        let removed = 0;
        setFeed((prev) => {
          const next = prev.filter((t) => !set.has(t.txid));
          removed = prev.length - next.length;
          return next;
        });
        setConfirmed(txids); // rain fades these out
        for (const id of txids) seenTx.current.add(id); // don't re-add them
        setBlockFlash({ height: h, removed, total: txids.length });
        pushAlert({
          id: `block-${h}`,
          kind: "watch-hit",
          txid: txids[0] ?? "",
          message: `Block ${h} mined — ${removed} of our txs confirmed`,
          at: Date.now(),
        });
      }
      lastHeight.current = h;
    } catch {
      /* ignore */
    }
  }, [pushAlert]);

  // ── Watchlist polling → alerts ─────────────────────────────────
  const pollWatch = useCallback(async () => {
    const list = loadWatchlist();
    for (const w of list) {
      try {
        const txs = await fetchAddressTxs(w.address);
        const seen = watchSeen.current.get(w.address);
        const ids = new Set(txs.map((t) => t.txid));
        if (!seen) {
          // First sight — seed the baseline, don't alert on history.
          watchSeen.current.set(w.address, ids);
          continue;
        }
        for (const t of txs) {
          if (!seen.has(t.txid)) {
            pushAlert({
              id: `${t.txid}-watch`,
              kind: "watch-hit",
              txid: t.txid,
              address: w.address,
              message: `Watched address active${w.note ? ` · ${w.note}` : ""}`,
              at: Date.now(),
            });
          }
        }
        watchSeen.current.set(w.address, ids);
      } catch {
        /* ignore */
      }
    }
  }, [pushAlert]);

  // Bulk seed once on mount: grab ~70 current mempool txs, streamed in batches
  // so the rain starts falling immediately and fills steadily (rather than a
  // few-then-one-big-chunk).
  useEffect(() => {
    let live = true;
    (async () => {
      await fetchMempoolSeed(70, (batch) => {
        if (!live || !batch.length) return;
        for (const t of batch) seenTx.current.add(t.txid);
        const now = Date.now();
        setFeed((prev) => {
          const have = new Set(prev.map((p) => p.txid));
          const add = batch
            .filter((t) => !have.has(t.txid))
            .map((t) => ({ ...t, seenAt: now, fresh: false }));
          return [...add, ...prev].slice(0, FEED_MAX);
        });
        setBatch(batch);
      });
    })();
    return () => {
      live = false;
    };
  }, []);

  // Polling lifecycle — pauses when tab hidden or paused by user.
  useEffect(() => {
    if (!live) return;
    pollFeed();
    pollStats();
    pollWatch();
    const f = setInterval(() => {
      if (!document.hidden) pollFeed();
    }, feedMs);
    const s = setInterval(() => {
      if (!document.hidden) pollStats();
    }, POLL_STATS);
    const w = setInterval(() => {
      if (!document.hidden) pollWatch();
    }, POLL_WATCH);
    return () => {
      clearInterval(f);
      clearInterval(s);
      clearInterval(w);
    };
    // Re-init when the data source or rate changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, feedMs, source.mode, source.customBase, pollFeed, pollStats, pollWatch]);

  const projected = useMemo(
    () => (stats ? projectBlocks(stats) : []),
    [stats]
  );

  // Stable so the rain's physics loop isn't torn down on every re-render.
  const open = useCallback(
    (txid: string) => router.push(`/explore?q=${txid}`),
    [router]
  );

  // Sorted + paginated view over the accumulated buffer.
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const key = (t: FeedTx) =>
      sortKey === "value"
        ? t.value
        : sortKey === "fee"
          ? feeRateOf(t)
          : sortKey === "size"
            ? t.vsize
            : t.seenAt;
    return [...feed].sort((a, b) => (key(a) - key(b)) * dir);
  }, [feed, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      {/* Header row */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: live ? "var(--clean)" : "var(--text-faint)",
                boxShadow: live ? "0 0 8px var(--clean)" : "none",
              }}
            />
            <h1 className="font-sans text-[22px] font-bold tracking-[-0.02em] text-ink">
              Live mempool
            </h1>
          </div>
          <p className="mt-1 font-mono text-[12px] text-dim">
            Unconfirmed transactions streaming from{" "}
            {source.mode === "custom" ? "your instance" : "mempool.space"}, each
            scored on the fly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh-rate controller */}
          <div className="flex items-center gap-1">
            <span className="microlabel mr-0.5 hidden sm:inline">refresh</span>
            <div className="flex overflow-hidden rounded-[2px] border border-line">
              {RATE_OPTIONS.map((o) => (
                <button
                  key={o.ms}
                  type="button"
                  onClick={() => setFeedMs(o.ms)}
                  className={`px-2.5 py-2 font-mono text-[12px] tabular-nums transition-colors ${
                    feedMs === o.ms
                      ? "bg-accent-dim text-accent"
                      : "text-dim hover:text-ink"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className="rounded-[2px] border border-line px-3 py-2 font-mono text-[12px] uppercase tracking-wider text-dim transition-colors hover:border-accent/40 hover:text-accent"
          >
            {live ? "▮▮ pause" : "▶ resume"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox
          label="In mempool"
          value={stats ? formatCount(stats.count) : "--"}
          unit="txs"
        />
        <StatBox
          label="Pending size"
          value={stats ? (stats.vsize / 1e6).toFixed(1) : "--"}
          unit="MvB"
        />
        <StatBox
          label="Projected blocks"
          value={projected.length ? String(projected.length) : "--"}
          unit="blocks"
          accent="var(--accent)"
        />
        <StatBox
          label="Total fees"
          value={stats ? formatBtc(stats.total_fee) : "--"}
          unit="BTC"
          accent="var(--accent)"
        />
      </div>

      {/* Block-mined flash — confirmed txs leave the mempool (faded + dropped). */}
      {blockFlash && (
        <div className="fade-up mt-4 flex items-center gap-3 rounded-[3px] border border-accent/40 bg-accent-dim px-4 py-2.5">
          <span className="text-[15px]">⛏</span>
          <span className="font-mono text-[13px] text-accent">
            Block {blockFlash.height.toLocaleString()} mined
          </span>
          <span className="font-mono text-[12px] text-dim">
            {blockFlash.total.toLocaleString()} txs confirmed ·{" "}
            {blockFlash.removed} cleared from this view
          </span>
        </div>
      )}

      {/* Live transaction rain */}
      <div className="mt-5">
        <MempoolRain
          batch={batch}
          confirmed={confirmed}
          price={price}
          onPick={open}
        />
      </div>

      {/* Projected blocks */}
      <div className="mt-5">
        <MicroLabel>Projected blocks · by fee rate (sat/vB)</MicroLabel>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
          {projected.length === 0 && (
            <div className="h-20 w-full animate-pulse rounded-[3px] border border-line bg-surface/40" />
          )}
          {projected.map((b, i) => (
            <div
              key={i}
              className="flex h-20 w-28 shrink-0 flex-col justify-between rounded-[3px] border p-2"
              style={{
                borderColor: b.color,
                background: `color-mix(in oklch, ${b.color} 12%, transparent)`,
              }}
            >
              <span className="font-mono text-[11px] font-medium tabular-nums text-ink">
                ~{formatFeeRateValue(b.medianFee)}
                <span className="ml-1 text-ink">sat/vB</span>
              </span>
              <div>
                <div className="font-mono text-[10px] text-dim">
                  {formatFeeRange(b.feeLow, b.feeHigh)} range
                </div>
                <div className="font-mono text-[10px] text-faint">
                  {formatCount(b.nTx)} txs
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Feed + alerts */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* Browsable transaction table */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MicroLabel>Mempool transactions · {sorted.length} buffered</MicroLabel>
            <div className="flex items-center gap-1">
              <span className="microlabel mr-0.5">sort</span>
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSort(s.key)}
                  className={`rounded-[2px] border px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                    sortKey === s.key
                      ? "border-accent/60 bg-accent-dim text-accent"
                      : "border-line text-dim hover:border-line-strong hover:text-ink"
                  }`}
                >
                  {s.label}
                  {sortKey === s.key && (sortDir === "asc" ? " ↑" : " ↓")}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 divide-y divide-line overflow-hidden rounded-[3px] border border-line">
            {sorted.length === 0 && (
              <div className="flex h-32 items-center justify-center font-mono text-[12px] text-faint">
                <span className="blink">▮</span>
                <span className="ml-2">listening…</span>
              </div>
            )}
            {pageRows.map((t) => {
              const flags = flagRecent(t);
              return (
                <button
                  key={t.txid}
                  type="button"
                  onClick={() => open(t.txid)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="font-mono text-[12px] text-dim">
                    {truncateHash(t.txid, 6)}
                  </span>
                  <span className="hidden font-mono text-[11px] tabular-nums text-faint sm:inline">
                    {new Date(t.seenAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {flags.map((f) => (
                      <span
                        key={f.kind}
                        className="hidden rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider sm:inline"
                        style={{
                          color: f.color,
                          background: `color-mix(in oklch, ${f.color} 14%, transparent)`,
                        }}
                      >
                        {f.label}
                      </span>
                    ))}
                  </span>
                  <span
                    className="w-24 text-right font-mono text-[12px] tabular-nums"
                    style={{ color: "var(--accent)" }}
                  >
                    {formatBtc(t.value)}
                  </span>
                  <span
                    className="hidden w-20 text-right font-mono text-[11px] tabular-nums sm:inline"
                    style={{ color: price ? "var(--clean)" : "var(--text-faint)" }}
                  >
                    {price ? formatUsd(t.value, price) : "—"}
                  </span>
                  <span className="w-16 text-right font-mono text-[11px] tabular-nums text-faint">
                    {formatFeeRateValue(feeRateOf(t))} s/vB
                  </span>
                </button>
              );
            })}
          </div>
          {/* Pagination */}
          {pageCount > 1 && (
            <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-dim">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="rounded-[2px] border border-line px-2.5 py-1 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-30"
              >
                ← prev
              </button>
              <span className="tabular-nums text-faint">
                page {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="rounded-[2px] border border-line px-2.5 py-1 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-30"
              >
                next →
              </button>
            </div>
          )}
        </section>

        {/* Watchlist + alerts */}
        <section className="space-y-5">
          <Watchlist watch={watch} />
          <div>
            <div className="flex items-center justify-between">
              <MicroLabel>Alerts</MicroLabel>
              {alerts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAlerts([])}
                  className="font-mono text-[10px] text-faint hover:text-dim"
                >
                  clear
                </button>
              )}
            </div>
            <div className="mt-2 space-y-1.5">
              {alerts.length === 0 && (
                <p className="rounded-[3px] border border-line bg-surface/40 px-3 py-4 text-center font-mono text-[11px] text-faint">
                  No alerts yet. Whale moves, high-fee spikes, and watched
                  addresses will surface here.
                </p>
              )}
              {alerts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => open(a.txid)}
                  className="fade-up flex w-full items-center gap-2 rounded-[2px] border border-line bg-surface/50 px-3 py-2 text-left transition-colors hover:border-accent/40"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: alertColor(a.kind) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] text-ink">
                      {a.message}
                    </span>
                    <span className="font-mono text-[10px] text-faint">
                      {truncateHash(a.txid, 6)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Watchlist({ watch }: { watch: WatchEntry[] }) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const valid = value.trim() && classifyQuery(value) === "address";

  return (
    <div>
      <MicroLabel>Watchlist · {watch.length}</MicroLabel>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          addWatch(value.trim(), note.trim());
          setValue("");
          setNote("");
        }}
        className="mt-2 space-y-1.5"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="bitcoin address to watch…"
          spellCheck={false}
          autoComplete="off"
          aria-label="Address to watch"
          className="w-full rounded-[2px] border border-line bg-bg px-2.5 py-2 font-mono text-[12px] text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
        />
        <div className="flex gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="label (optional)"
            className="min-w-0 flex-1 rounded-[2px] border border-line bg-bg px-2.5 py-2 font-mono text-[12px] text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!valid}
            className="rounded-[2px] bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            watch
          </button>
        </div>
      </form>
      <div className="mt-2 space-y-1">
        {watch.map((w) => (
          <div
            key={w.address}
            className="flex items-center gap-2 rounded-[2px] border border-line bg-surface/40 px-2.5 py-1.5"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clean" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">
              {w.note || truncateHash(w.address, 7)}
            </span>
            <button
              type="button"
              onClick={() => removeWatch(w.address)}
              aria-label={`Stop watching ${w.address}`}
              className="font-mono text-[12px] text-faint hover:text-taint"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: string;
}) {
  return (
    <div className="rounded-[3px] border border-line bg-surface/40 px-3 py-2.5">
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="font-mono text-[20px] tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </span>
        <span className="font-mono text-[11px] text-faint">{unit}</span>
      </div>
    </div>
  );
}

interface ProjBlock {
  nTx: number;
  medianFee: number;
  feeLow: number;
  feeHigh: number;
  color: string;
}

/** Bucket the fee histogram into ~1 MvB projected blocks. */
function projectBlocks(stats: MempoolStats): ProjBlock[] {
  const BLOCK_VSIZE = 1_000_000;
  const blocks: ProjBlock[] = [];
  let acc = 0;
  let fees: number[] = [];
  let nTx = 0;
  // Histogram is [feeRate, vsize] descending by fee rate.
  for (const [feeRate, vsize] of stats.fee_histogram) {
    acc += vsize;
    fees.push(feeRate);
    nTx += Math.max(1, Math.round(vsize / 250)); // rough tx estimate
    if (acc >= BLOCK_VSIZE) {
      blocks.push(makeBlock(fees, nTx));
      acc = 0;
      fees = [];
      nTx = 0;
      if (blocks.length >= 8) break;
    }
  }
  if (acc > 0 && blocks.length < 8 && fees.length)
    blocks.push(makeBlock(fees, nTx));
  return blocks;
}

function makeBlock(fees: number[], nTx: number): ProjBlock {
  const feeHigh = Math.max(...fees);
  const feeLow = Math.min(...fees);
  const medianFee = fees[Math.floor(fees.length / 2)] ?? feeLow;
  return { nTx, medianFee, feeLow, feeHigh, color: feeColor(medianFee) };
}

function feeColor(feeRate: number): string {
  if (feeRate >= 100) return "var(--taint)";
  if (feeRate >= 30) return "var(--accent)";
  if (feeRate >= 8) return "var(--warn)";
  return "var(--clean)";
}

function alertColor(kind: Alert["kind"]): string {
  if (kind === "whale") return "var(--accent)";
  if (kind === "high-fee") return "var(--taint)";
  return "var(--clean)";
}
