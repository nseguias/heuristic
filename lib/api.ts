import type {
  EsploraAddressInfo,
  EsploraOutspend,
  EsploraTx,
} from "./types";
import { loadSource, restUrl } from "./datasource";

/**
 * Esplora fetchers. In public mode requests go through our /api/btc proxy; in
 * custom mode they go straight from the browser to the user's own instance
 * (see datasource.ts for the privacy rationale).
 */

const cache = new Map<string, unknown>();

async function get<T>(path: string): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T;
  const url = restUrl(path, loadSource());
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  const data = (await res.json()) as T;
  // Volatile endpoints aren't memoized.
  if (!path.startsWith("blocks/tip") && !path.startsWith("mempool"))
    cache.set(path, data);
  return data;
}

export const fetchTx = (txid: string) => get<EsploraTx>(`tx/${txid}`);

export const fetchOutspends = (txid: string) =>
  get<EsploraOutspend[]>(`tx/${txid}/outspends`);

export const fetchAddress = (address: string) =>
  get<EsploraAddressInfo>(`address/${address}`);

export const fetchAddressTxs = (address: string) =>
  get<EsploraTx[]>(`address/${address}/txs`);

export const fetchTipHeight = () => get<number>(`blocks/tip/height`);
export const fetchBlockTxids = (hash: string) =>
  get<string[]>(`block/${hash}/txids`);

// tip/hash returns a bare hex string, not JSON — fetch as text.
export async function fetchTipHash(): Promise<string> {
  const res = await fetch(restUrl("blocks/tip/hash", loadSource()));
  if (!res.ok) throw new Error("tip hash request failed");
  return (await res.text()).trim();
}

/** Rolling buffer of recent mempool transactions (txid, fee, vsize, value). */
export interface MempoolRecent {
  txid: string;
  fee: number;
  vsize: number;
  value: number;
}
export const fetchMempoolRecent = () =>
  get<MempoolRecent[]>(`mempool/recent`);

/**
 * Bulk seed: grab a sample of current mempool txids (sliced server-side) and
 * resolve each to value/fee/vsize, so the rain starts full instead of trickling
 * in 10 at a time. Fetched in small concurrent batches to stay under rate limits.
 */
export async function fetchMempoolSeed(
  count: number,
  onBatch?: (txs: MempoolRecent[]) => void
): Promise<MempoolRecent[]> {
  const txids = await get<string[]>(`mempool/txids`).catch(() => []);
  const pick = txids.slice(0, count);
  const out: MempoolRecent[] = [];
  const BATCH = 8;
  for (let i = 0; i < pick.length; i += BATCH) {
    const chunk = pick.slice(i, i + BATCH);
    const txs = await Promise.all(chunk.map((id) => fetchTx(id).catch(() => null)));
    const batch: MempoolRecent[] = [];
    for (const tx of txs) {
      if (!tx) continue;
      batch.push({
        txid: tx.txid,
        fee: tx.fee,
        vsize: Math.ceil(tx.weight / 4),
        value: tx.vout.reduce((s, v) => s + v.value, 0),
      });
    }
    // Emit each batch as it resolves so the rain starts falling immediately.
    if (batch.length) onBatch?.(batch);
    out.push(...batch);
  }
  return out;
}

export interface MempoolStats {
  count: number;
  vsize: number;
  total_fee: number;
  fee_histogram: [number, number][];
}
export const fetchMempoolStats = () => get<MempoolStats>(`mempool`);

/** BTC spot price, lightly cached client-side (price moves slowly enough). */
interface Prices {
  USD: number;
  [k: string]: number;
}
let priceCache: { at: number; usd: number } | null = null;
export async function fetchBtcUsd(now: number): Promise<number | null> {
  if (priceCache && now - priceCache.at < 60_000) return priceCache.usd;
  try {
    const url = restUrl("v1/prices", loadSource());
    const res = await fetch(url);
    if (!res.ok) return priceCache?.usd ?? null;
    const data = (await res.json()) as Prices;
    priceCache = { at: now, usd: data.USD };
    return data.USD;
  } catch {
    return priceCache?.usd ?? null;
  }
}

export type QueryKind = "txid" | "address" | "invalid";

export function classifyQuery(q: string): QueryKind {
  const s = q.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return "txid";
  if (/^(bc1[a-zA-HJ-NP-Z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(s))
    return "address";
  return "invalid";
}

/** Where a search query should navigate: addresses get their own hub page. */
export function routeForQuery(q: string): string | null {
  const s = q.trim();
  const kind = classifyQuery(s);
  if (kind === "txid") return `/explore?q=${s}`;
  if (kind === "address") return `/address/${s}`;
  return null;
}
