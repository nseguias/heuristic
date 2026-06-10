"use client";

/**
 * Data-source configuration, persisted client-side.
 *
 * Privacy model:
 *  - "public" (default): browser → this site's /api/btc proxy → mempool.space.
 *    The site operator and mempool.space can see what you query.
 *  - "custom": browser fetches DIRECTLY from your own Esplora/mempool instance.
 *    Requests never touch our server. Point it at a node on your LAN (or a
 *    private mempool.space deployment) for full query privacy.
 */

export type SourceMode = "public" | "custom";

export interface DataSource {
  mode: SourceMode;
  /** REST base, e.g. http://your-node.local:3006/api  (no trailing slash). */
  customBase: string;
  /** WebSocket endpoint, e.g. ws://your-node.local:3006/api/v1/ws */
  customWs: string;
}

const KEY = "heuristic.datasource";

export const DEFAULT_SOURCE: DataSource = {
  mode: "public",
  customBase: "",
  customWs: "",
};

export const PUBLIC_WS = "wss://mempool.space/api/v1/ws";

export function loadSource(): DataSource {
  if (typeof window === "undefined") return DEFAULT_SOURCE;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SOURCE;
    return { ...DEFAULT_SOURCE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SOURCE;
  }
}

export function saveSource(s: DataSource) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("heuristic:source", { detail: s }));
}

/** Resolve the REST URL for an Esplora path under the active source. */
export function restUrl(path: string, s: DataSource): string {
  if (s.mode === "custom" && s.customBase) {
    return `${s.customBase.replace(/\/$/, "")}/${path}`;
  }
  return `/api/btc/${path}`;
}

/** Resolve the WebSocket endpoint under the active source. */
export function wsUrl(s: DataSource): string {
  if (s.mode === "custom" && s.customWs) return s.customWs;
  return PUBLIC_WS;
}
