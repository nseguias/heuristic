import type { EntityLabel } from "./types";
import { OFAC_BTC, OFAC_SNAPSHOT } from "./ofac";

/**
 * Seed label set — a handful of publicly documented entities so traces light up
 * out of the box. Extend or replace with a real attribution dataset; every
 * heuristic consumes labels through `labelFor`, so swapping the source is local.
 */
export const SEED_LABELS: EntityLabel[] = [
  {
    address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    name: "Genesis block (Satoshi)",
    category: "historic",
    risk: 0,
    note: "Block 0 coinbase. Unspendable by consensus quirk.",
  },
  {
    address: "1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF",
    name: "Mt. Gox 2011 theft wallet",
    category: "hack",
    risk: 1,
    note: "~79,957 BTC moved out of Mt. Gox in March 2011. Dormant.",
  },
  {
    address: "bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97",
    name: "Bitfinex 2016 hack",
    category: "hack",
    risk: 1,
    note: "Portion of the 119,756 BTC stolen in Aug 2016; seized by DOJ in 2022.",
  },
  {
    address: "1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX",
    name: "Silk Road (DOJ seizure)",
    category: "seizure",
    risk: 0.1,
    note: "69,370 BTC seized by the US DOJ (Nov 2020) — now in government custody, not a criminal wallet.",
  },
  {
    address: "12t9YDPgwueZ9NyMgw519p7AA8isjr6SMw",
    name: "WannaCry ransom wallet",
    category: "hack",
    risk: 1,
    note: "One of three hardcoded WannaCry ransom addresses (May 2017).",
  },
  {
    address: "13AM4VW2dhxYgXeQepoHkHSQuy6NgaEb94",
    name: "WannaCry ransom wallet",
    category: "hack",
    risk: 1,
  },
  {
    address: "115p7UMMngoj1pMvkpHijcRdfJNXj6LrLn",
    name: "WannaCry ransom wallet",
    category: "hack",
    risk: 1,
    note: "Third of three hardcoded WannaCry ransom addresses.",
  },
  {
    address: "1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s",
    name: "Binance hot wallet",
    category: "exchange",
    risk: 0.05,
    note: "Binance's primary hot wallet — one of the busiest addresses on chain.",
  },
  {
    address: "1Archive1n2C579dMsAu3iC6tWzuQJz8dN",
    name: "Internet Archive donations",
    category: "service",
    risk: 0,
    note: "archive.org's public donation address (vanity 1Archive…).",
  },
  {
    address: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo",
    name: "Binance cold wallet",
    category: "exchange",
    risk: 0.05,
    note: "KYC exchange custody — generally treated as clean origin.",
  },
  {
    address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
    name: "Binance cold wallet",
    category: "exchange",
    risk: 0.05,
    note: "Binance's main bech32 cold wallet — millions of transactions.",
  },
  {
    address: "3JZq4atUahhuA9rLhXLMhhTo133J9rF97j",
    name: "Bitfinex cold wallet",
    category: "exchange",
    risk: 0.05,
    note: "KYC exchange custody — generally treated as clean origin.",
  },
  {
    address: "bc1qjasf9z3h7w3jspkhtgatgpyvvzgpa2wwd2lr0eh5tx44reyn2k7sfc27a4",
    name: "Coinbase cold wallet",
    category: "exchange",
    risk: 0.05,
  },
  {
    address: "1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY",
    name: "F2Pool payout",
    category: "mining",
    risk: 0,
    note: "Freshly mined coins — the cleanest possible origin.",
  },
];

const index = new Map(SEED_LABELS.map((l) => [l.address, l]));

export function labelFor(address: string | undefined): EntityLabel | undefined {
  if (!address) return undefined;
  const seed = index.get(address);
  if (seed) return seed;
  // OFAC SDN sanctions list — the authoritative source of "do not touch".
  if (OFAC_BTC.has(address)) {
    return {
      address,
      name: "OFAC sanctioned",
      category: "sanctioned",
      risk: 1,
      note: `On the U.S. Treasury OFAC SDN list (snapshot ${OFAC_SNAPSHOT}).`,
      source: "OFAC SDN",
    };
  }
  return undefined;
}
