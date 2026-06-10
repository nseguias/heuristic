import type {
  EsploraTx,
  EntityLabel,
  LabelCategory,
  RiskBand,
  TraceGraph,
} from "./types";
import { labelFor } from "./labels";

/**
 * Address screening / exposure analysis — the core of commercial chain-analysis
 * products (Chainalysis KYT, Elliptic Lens, TRM screening). Given an address it
 * measures DIRECT exposure (labelled counterparties it transacts with) and
 * INDIRECT exposure (labelled entities reached by tracing its funding history),
 * aggregates by risk category, and produces a single acceptance-risk score.
 *
 * Like the rest of HEURISTIC this is "glass box": every number carries its
 * reasons, and the result is only as good as the (currently small) label set —
 * the engine is the moat, the data is the fill-in-later.
 */

export const CATEGORY_META: Record<
  LabelCategory,
  { name: string; risk: number }
> = {
  sanctioned: { name: "Sanctioned", risk: 1.0 },
  hack: { name: "Stolen funds / hack", risk: 0.92 },
  service: { name: "Service", risk: 0.3 },
  // Law-enforcement seizure wallets are government custody, not criminal —
  // receiving from a government auction is generally clean.
  seizure: { name: "Seizure (gov. custody)", risk: 0.1 },
  exchange: { name: "Exchange (KYC)", risk: 0.05 },
  mining: { name: "Mining", risk: 0.0 },
  historic: { name: "Historic", risk: 0.0 },
};

export interface Counterparty {
  address: string;
  name: string;
  category: LabelCategory;
  direction: "received" | "sent";
  value: number; // sats
  risk: number;
}

export interface CategoryExposure {
  category: LabelCategory;
  name: string;
  risk: number;
  value: number; // sats attributable to this category
  share: number; // 0..1 of analysed counterparty flow
  direct: boolean;
}

export interface ScreeningReport {
  address: string;
  score: number; // 0..100 acceptance risk
  band: RiskBand;
  sanctioned: boolean;
  self?: EntityLabel; // the address itself is labelled
  exposures: CategoryExposure[];
  counterparties: Counterparty[];
  reasons: string[];
  analyzedTxs: number;
  analyzedFlow: number; // total counterparty value examined (sats)
}

function bandFor(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score >= 8) return "low";
  return "clean";
}

/**
 * Pure screening computation over already-fetched data. `graph` (optional) is an
 * ancestry/descendant trace used to surface indirect exposure; without it only
 * direct counterparties are screened.
 */
export function buildScreening(
  address: string,
  txs: EsploraTx[],
  graph?: TraceGraph
): ScreeningReport {
  const reasons: string[] = [];
  const self = labelFor(address);

  // ── Direct counterparties ──────────────────────────────────────
  const cps = new Map<string, Counterparty>();
  let analyzedFlow = 0;
  const directCatValue = new Map<LabelCategory, number>();

  const addCp = (
    addr: string,
    direction: "received" | "sent",
    value: number
  ) => {
    analyzedFlow += value;
    const label = labelFor(addr);
    if (!label) return;
    directCatValue.set(
      label.category,
      (directCatValue.get(label.category) ?? 0) + value
    );
    const key = `${addr}:${direction}`;
    const prev = cps.get(key);
    if (prev) prev.value += value;
    else
      cps.set(key, {
        address: addr,
        name: label.name,
        category: label.category,
        direction,
        value,
        risk: label.risk,
      });
  };

  for (const tx of txs) {
    for (const vin of tx.vin) {
      const a = vin.prevout?.scriptpubkey_address;
      if (a && a !== address) addCp(a, "received", vin.prevout?.value ?? 0);
    }
    for (const vout of tx.vout) {
      const a = vout.scriptpubkey_address;
      if (a && a !== address) addCp(a, "sent", vout.value);
    }
  }

  // ── Indirect exposure from the ancestry/descendant trace ───────
  const indirectCat = new Map<LabelCategory, number>();
  if (graph) {
    for (const node of graph.nodes.values()) {
      for (const l of node.analysis.labels) {
        // Don't double-count the address's own direct counterparties.
        indirectCat.set(
          l.category,
          Math.max(indirectCat.get(l.category) ?? 0, l.risk)
        );
      }
    }
  }

  // ── Build category exposures ───────────────────────────────────
  const exposures: CategoryExposure[] = [];
  const cats = new Set<LabelCategory>([
    ...directCatValue.keys(),
    ...indirectCat.keys(),
  ]);
  for (const cat of cats) {
    const value = directCatValue.get(cat) ?? 0;
    const meta = CATEGORY_META[cat];
    exposures.push({
      category: cat,
      name: meta.name,
      risk: meta.risk,
      value,
      share: analyzedFlow > 0 ? value / analyzedFlow : 0,
      direct: value > 0,
    });
  }
  exposures.sort((a, b) => b.risk - a.risk || b.share - a.share);

  // ── Score ──────────────────────────────────────────────────────
  let score = 0;
  if (self) {
    score = self.risk * 100;
    reasons.push(`address is labelled "${self.name}" (${self.category})`);
  }
  // Direct counterparty risk, weighted by how much flow touches it.
  for (const e of exposures) {
    if (!e.direct) continue;
    const contribution = e.risk * 100 * Math.min(1, 0.4 + e.share);
    if (contribution > score) {
      score = contribution;
      if (e.risk >= 0.5)
        reasons.push(
          `${Math.round(e.share * 100)}% direct exposure to ${e.name}`
        );
    }
  }
  // Indirect ancestry risk, decayed.
  for (const [cat, risk] of indirectCat) {
    const contribution = risk * 100 * 0.7;
    if (contribution > score) {
      score = contribution;
      if (risk >= 0.5)
        reasons.push(`indirect exposure to ${CATEGORY_META[cat].name} upstream`);
    }
  }

  const sanctioned =
    self?.category === "sanctioned" ||
    self?.category === "hack" ||
    exposures.some((e) => e.direct && (e.category === "sanctioned"));
  if (sanctioned && !reasons.length)
    reasons.push("direct exposure to a sanctioned / stolen-funds entity");
  if (!reasons.length) reasons.push("no exposure to labelled risk entities");

  score = Math.max(0, Math.min(100, score));

  const counterparties = [...cps.values()]
    .sort((a, b) => b.risk - a.risk || b.value - a.value)
    .slice(0, 12);

  return {
    address,
    score,
    band: bandFor(score),
    sanctioned,
    self,
    exposures,
    counterparties,
    reasons,
    analyzedTxs: txs.length,
    analyzedFlow,
  };
}
