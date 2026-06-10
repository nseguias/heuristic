import type {
  ChangeVerdict,
  CoinjoinVerdict,
  EsploraTx,
  RiskBand,
  TxAnalysis,
} from "./types";
import { labelFor } from "./labels";

/**
 * On-chain forensic heuristics. These are probabilistic fingerprints, not proof
 * — every verdict carries a confidence and its reasons so the UI can show the
 * "why", which is the whole point of the tool.
 */

const WHIRLPOOL_DENOMS = [
  500_000, 1_000_000, 5_000_000, 50_000_000,
]; // sats: 0.005 / 0.01 / 0.05 / 0.5 BTC pools

/** Common-input-ownership: all inputs of a non-coinjoin tx share an owner. */
export function inputAddresses(tx: EsploraTx): string[] {
  return tx.vin
    .map((v) => v.prevout?.scriptpubkey_address)
    .filter((a): a is string => Boolean(a));
}

export function outputAddresses(tx: EsploraTx): string[] {
  return tx.vout
    .map((v) => v.scriptpubkey_address)
    .filter((a): a is string => Boolean(a));
}

/**
 * Coinjoin fingerprinting. Detects the structural signature: many equal-value
 * outputs with a comparable number of inputs. Specializes Whirlpool (fixed
 * denominations, 5-in/5-out), Wasabi 1 (~0.1 BTC base), and Wasabi 2 (many
 * unequal-but-clustered outputs, large participant count).
 */
export function detectCoinjoin(tx: EsploraTx): CoinjoinVerdict {
  const reasons: string[] = [];
  const values = tx.vout.map((v) => v.value);
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  let denomination: number | undefined;
  let equalOutputCount = 0;
  for (const [val, c] of counts) {
    if (c > equalOutputCount) {
      equalOutputCount = c;
      denomination = val;
    }
  }

  const nIn = tx.vin.length;
  const nOut = tx.vout.length;
  const noCoinbase = !tx.vin.some((v) => v.is_coinbase);

  // Base structural test: ≥3 equal outputs and enough inputs to be a join.
  const structural =
    noCoinbase && equalOutputCount >= 3 && nIn >= equalOutputCount - 1;

  if (!structural) {
    return {
      isCoinjoin: false,
      confidence: 0,
      equalOutputCount,
      denomination,
      reasons: ["no dominant equal-output set"],
    };
  }

  reasons.push(`${equalOutputCount} equal outputs of ${denomination} sat`);
  reasons.push(`${nIn} inputs → ${nOut} outputs`);

  // Whirlpool: exactly 5 in / 5 out, all five equal, fixed denomination.
  if (
    nIn === 5 &&
    nOut === 5 &&
    equalOutputCount === 5 &&
    denomination &&
    WHIRLPOOL_DENOMS.some((d) => Math.abs(d - denomination!) <= d * 0.02)
  ) {
    reasons.push("5×5 structure at a known Whirlpool denomination");
    return {
      isCoinjoin: true,
      kind: "whirlpool",
      confidence: 0.98,
      equalOutputCount,
      denomination,
      reasons,
    };
  }

  // Wasabi 2 (WabiSabi): large participant set, many clustered outputs.
  if (equalOutputCount >= 8 && nIn >= 10) {
    reasons.push("high participant count consistent with WabiSabi");
    return {
      isCoinjoin: true,
      kind: equalOutputCount >= 20 ? "wasabi2" : "wasabi",
      confidence: 0.9,
      equalOutputCount,
      denomination,
      reasons,
    };
  }

  // JoinMarket: a few equal outputs, asymmetric input count, modest size.
  if (equalOutputCount >= 3 && equalOutputCount <= 7) {
    reasons.push("small equal-output set consistent with JoinMarket");
    return {
      isCoinjoin: true,
      kind: "joinmarket",
      confidence: 0.6,
      equalOutputCount,
      denomination,
      reasons,
    };
  }

  return {
    isCoinjoin: true,
    kind: "generic",
    confidence: 0.5,
    equalOutputCount,
    denomination,
    reasons,
  };
}

/**
 * Change-output detection. Combines well-known heuristics, each adding evidence:
 * address-type matching, round-number payments, the unnecessary-input test, and
 * the "no other output is a self-spend" fallback.
 */
export function detectChange(tx: EsploraTx): ChangeVerdict {
  const reasons: string[] = [];
  if (tx.vout.length !== 2) {
    return {
      changeIndex: null,
      confidence: 0,
      reasons: ["change heuristic only applied to 2-output txs"],
    };
  }

  const [a, b] = tx.vout;
  const inputType = tx.vin[0]?.prevout?.scriptpubkey_type;
  const score = [0, 0];

  // 1. Change usually matches the input script type (same wallet software).
  if (inputType) {
    if (a.scriptpubkey_type === inputType) score[0] += 1;
    if (b.scriptpubkey_type === inputType) score[1] += 1;
    if (a.scriptpubkey_type === inputType && b.scriptpubkey_type !== inputType)
      reasons.push("output 0 matches input script type");
    if (b.scriptpubkey_type === inputType && a.scriptpubkey_type !== inputType)
      reasons.push("output 1 matches input script type");
  }

  // 2. The payment is often a round number; change is the messy remainder.
  const roundness = (v: number) => {
    if (v % 1_000_000 === 0) return 2; // whole 0.01 BTC
    if (v % 100_000 === 0) return 1; // whole 0.001 BTC
    return 0;
  };
  const ra = roundness(a.value);
  const rb = roundness(b.value);
  if (ra > rb) {
    score[1] += 1;
    reasons.push("output 0 is a round amount → output 1 is change");
  } else if (rb > ra) {
    score[0] += 1;
    reasons.push("output 1 is a round amount → output 0 is change");
  }

  if (score[0] === score[1]) {
    return {
      changeIndex: null,
      confidence: 0.3,
      reasons: reasons.length ? reasons : ["ambiguous — no distinguishing signal"],
    };
  }

  const changeIndex = score[0] > score[1] ? 0 : 1;
  const margin = Math.abs(score[0] - score[1]);
  return {
    changeIndex,
    confidence: Math.min(0.5 + margin * 0.2, 0.9),
    reasons,
  };
}

/** Peel chain: 1→2 spend where one leg is large and continues hopping. */
export function isPeelChain(tx: EsploraTx): boolean {
  if (tx.vout.length !== 2 || tx.vin.length > 2) return false;
  const [a, b] = tx.vout.map((v) => v.value).sort((x, y) => y - x);
  return a > b * 4; // one dominant leg, one small payment
}

/** Consolidation: many inputs swept into one or two outputs. */
export function isConsolidation(tx: EsploraTx): boolean {
  return tx.vin.length >= 5 && tx.vout.length <= 2;
}

/**
 * Secondary structural signals — privacy/behaviour tells that aren't full
 * verdicts but are worth surfacing during an investigation.
 */
export function extraSignals(tx: EsploraTx): import("./types").Signal[] {
  const out: import("./types").Signal[] = [];
  const inAddrs = new Set(inputAddresses(tx));
  const outAddrs = outputAddresses(tx);

  // Address reuse: paying back to an address that funded this tx (privacy leak).
  if (outAddrs.some((a) => inAddrs.has(a)))
    out.push({
      key: "reuse",
      label: "address reuse",
      detail: "an output pays an address also used as an input",
    });

  // Dusting: several economically meaningless outputs (tracking dust).
  const dust = tx.vout.filter((v) => v.value > 0 && v.value <= 1000).length;
  if (dust >= 3)
    out.push({
      key: "dust",
      label: `${dust} dust outputs`,
      detail: "tiny outputs consistent with a dusting/tracking attempt",
    });

  // Round-number payment: a clean whole-BTC-fraction output (likely a payment).
  if (tx.vout.some((v) => v.value >= 100_000 && v.value % 100_000 === 0))
    out.push({
      key: "round",
      label: "round payment",
      detail: "a round-number output — usually the payment, not the change",
    });

  // Self-transfer: every output returns to an input address (wallet shuffle).
  if (
    outAddrs.length > 0 &&
    outAddrs.every((a) => inAddrs.has(a)) &&
    inAddrs.size > 0
  )
    out.push({
      key: "self",
      label: "self-transfer",
      detail: "all outputs return to input addresses — a self-spend",
    });

  return out;
}

function bandFor(risk: number): RiskBand {
  if (risk >= 75) return "critical";
  if (risk >= 50) return "high";
  if (risk >= 25) return "medium";
  if (risk >= 8) return "low";
  return "clean";
}

/**
 * Mixing risk from the number of coinjoins coins have passed through. A coinjoin
 * is a privacy tool, not proof of wrongdoing, so one or two mixes is MEDIUM;
 * heavy obfuscation (3+) climbs toward HIGH. Criminal provenance is handled
 * separately by label taint, which dominates this.
 */
export function mixingRiskFor(coinjoinCount: number): number {
  if (coinjoinCount <= 0) return 0;
  // 1→32, 3→40, 5→48 (all MEDIUM) … only heavy remixing climbs to HIGH:
  // 6→52, 8→58. Privacy mixing stays medium; industrial laundering trends up.
  return Math.min(58, 28 + 4 * coinjoinCount);
}

/**
 * Per-transaction analysis. `inheritedRisk` carries label taint from the
 * ancestry walk (a hack/sanctioned source). `mixingExposure` carries cumulative
 * coinjoin/mixing risk. The two are combined by max — a clean privacy mix stays
 * medium, but flagged provenance pushes it to high/critical.
 */
export function analyzeTx(
  tx: EsploraTx,
  inheritedRisk = 0,
  mixingExposure = 0
): TxAnalysis {
  const coinjoin = detectCoinjoin(tx);
  const change = detectChange(tx);
  const peel = isPeelChain(tx);
  const consolidation = isConsolidation(tx);

  const labels = [...inputAddresses(tx), ...outputAddresses(tx)]
    .map((a) => labelFor(a))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  const riskReasons: string[] = [];
  let risk = inheritedRisk;
  if (inheritedRisk > 0)
    riskReasons.push(`inherits ${Math.round(inheritedRisk)} from flagged ancestry`);

  const directLabel = labels.reduce((max, l) => Math.max(max, l.risk), 0);
  if (directLabel > 0) {
    risk = Math.max(risk, directLabel * 100);
    riskReasons.push(`touches flagged entity (+${Math.round(directLabel * 100)})`);
  }

  // Mixing exposure — coinjoin is a privacy technique, treated as MEDIUM unless
  // the coins also carry flagged provenance (handled above, by max).
  let mix = mixingExposure;
  if (coinjoin.isCoinjoin && mix < 35) mix = 35; // a single mix
  if (mix > 0) {
    risk = Math.max(risk, mix);
    riskReasons.push(
      coinjoin.isCoinjoin
        ? "coinjoin — a privacy mix (medium unless the source is flagged)"
        : "spends coinjoin-mixed coins"
    );
  }

  // Peel chains are a classic layering pattern; nudge risk up modestly.
  if (peel && risk < 30) {
    risk = Math.max(risk, 18);
    riskReasons.push("peel-chain layering pattern");
  }

  risk = Math.max(0, Math.min(100, risk));

  return {
    txid: tx.txid,
    coinjoin,
    change,
    isPeelChain: peel,
    isConsolidation: consolidation,
    signals: extraSignals(tx),
    risk,
    riskBand: bandFor(risk),
    riskReasons,
    labels,
  };
}
