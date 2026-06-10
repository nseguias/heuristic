/**
 * Curated investigations — load with one click so the tool demonstrates itself.
 * Each `query` is a real, resolvable txid or address.
 */

import type { TraceDirection } from "./trace";

export interface Example {
  id: string;
  title: string;
  tag: string; // short category chip
  tagColor: string;
  query: string;
  blurb: string;
  direction: TraceDirection;
  depth: number;
}

export const EXAMPLES: Example[] = [
  {
    id: "pizza",
    title: "The Bitcoin Pizza",
    tag: "Historic",
    tagColor: "var(--accent)",
    // 10,000 BTC for two pizzas — 22 May 2010.
    query: "a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",
    blurb:
      "10,000 BTC paid for two pizzas in 2010. Trace where the coins came from and watch the change outputs peel off.",
    direction: "both",
    depth: 2,
  },
  {
    id: "silkroad",
    title: "Silk Road seizure",
    tag: "Seizure",
    tagColor: "var(--text-dim)",
    // DOJ-seized 69,370 BTC wallet — government custody, not a criminal wallet.
    query: "1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX",
    blurb:
      "69,370 BTC seized by the U.S. DOJ in 2020 — now in government custody. A famous wallet to trace, but receiving from a government auction is clean.",
    direction: "both",
    depth: 2,
  },
  {
    id: "mtgox",
    title: "Mt. Gox 2011 theft",
    tag: "Hack",
    tagColor: "var(--taint)",
    query: "1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF",
    blurb:
      "~80,000 BTC moved out of Mt. Gox in March 2011 and sat dormant for years. One of the most-watched wallets on chain.",
    direction: "both",
    depth: 2,
  },
  {
    id: "consolidation",
    title: "Exchange consolidation",
    tag: "Clustering",
    tagColor: "var(--clean)",
    // A Binance cold-wallet address — sweeps many inputs into custody.
    query: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo",
    blurb:
      "A major exchange cold wallet. Many-input consolidation sweeps are a textbook common-input-ownership cluster.",
    direction: "both",
    depth: 2,
  },
  {
    id: "coinjoin",
    title: "Wasabi CoinJoin",
    tag: "CoinJoin",
    tagColor: "var(--mix)",
    // Documented WabiSabi coinjoin (block 755,972): 374 in → 408 out.
    query: "198aee6e1b2cad9b7c3e4cd12962980fbaab0b20c07016031d0c2416b3ef9b70",
    blurb:
      "374 inputs, dozens of equal-value outputs — the WabiSabi fingerprint our detector keys on, and exactly what breaks clustering.",
    direction: "both",
    depth: 2,
  },
  {
    id: "payjoin",
    title: "PayJoin (P2EP)",
    tag: "PayJoin",
    tagColor: "var(--accent)",
    // Documented payjoin from the Bitcoin Wiki (block 557,792).
    query: "7104bae698587b3e75563b7ea7a9aada41d9c787788bc2bf26dd201fd7eca8a2",
    blurb:
      "Looks like an ordinary 2-output payment — but the receiver slipped in an input, quietly defeating the common-input-ownership heuristic.",
    direction: "both",
    depth: 2,
  },
  {
    id: "bitfinex",
    title: "Bitfinex 2016 hack",
    tag: "Hack",
    tagColor: "var(--taint)",
    // 119,756 BTC stolen Aug 2016; partially seized by DOJ in 2022.
    query: "bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97",
    blurb:
      "Part of the 119,756 BTC stolen from Bitfinex in 2016. A textbook flagged origin — watch the acceptance risk light up downstream.",
    direction: "both",
    depth: 2,
  },
  {
    id: "mining",
    title: "F2Pool mining wallet",
    tag: "Mining",
    tagColor: "var(--clean)",
    // F2Pool payout address — its latest tx is a consolidation sweep.
    query: "1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY",
    blurb:
      "An F2Pool payout address. Its latest transaction sweeps seven mining-payout UTXOs into one — a clean-origin consolidation.",
    direction: "both",
    depth: 2,
  },
  {
    id: "coinbase",
    title: "Coinbase · block 952,881",
    tag: "Coinbase",
    tagColor: "var(--clean)",
    // The block's first transaction — newly minted coins, no ancestry.
    query: "80b08a8972e461d188ad0a4365d508cd2014e77bf9ad7d47d8edafdfa0f43dc4",
    blurb:
      "A block's very first transaction — freshly minted coins with nothing behind them. The ⛏ marker means there's no ancestry to trace.",
    direction: "both",
    depth: 2,
  },
];

export function exampleHref(e: Example): string {
  const params = new URLSearchParams({
    q: e.query,
    dir: e.direction,
    depth: String(e.depth),
  });
  return `/explore?${params.toString()}`;
}
