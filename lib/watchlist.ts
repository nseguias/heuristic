"use client";

/** Address watchlist + alert log, persisted client-side (no backend needed). */

const WATCH_KEY = "heuristic.watchlist";

export interface WatchEntry {
  address: string;
  note: string;
  addedAt: number;
}

export interface Alert {
  id: string;
  kind: "watch-hit" | "whale" | "high-fee";
  txid: string;
  address?: string;
  message: string;
  value?: number;
  at: number;
}

export function loadWatchlist(): WatchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveWatchlist(list: WatchEntry[]) {
  localStorage.setItem(WATCH_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("heuristic:watchlist", { detail: list }));
}

export function addWatch(address: string, note = ""): WatchEntry[] {
  const list = loadWatchlist();
  if (list.some((w) => w.address === address)) return list;
  const next = [{ address, note, addedAt: Date.now() }, ...list];
  saveWatchlist(next);
  return next;
}

export function removeWatch(address: string): WatchEntry[] {
  const next = loadWatchlist().filter((w) => w.address !== address);
  saveWatchlist(next);
  return next;
}
