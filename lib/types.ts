/** Esplora/mempool.space API shapes (subset we consume). */

export interface EsploraVout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number; // sats
}

export interface EsploraVin {
  txid: string;
  vout: number;
  prevout: EsploraVout | null; // null for coinbase
  scriptsig: string;
  is_coinbase: boolean;
  sequence: number;
}

export interface EsploraTx {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  vin: EsploraVin[];
  vout: EsploraVout[];
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

export interface EsploraOutspend {
  spent: boolean;
  txid?: string;
  vin?: number;
  status?: EsploraTx["status"];
}

export interface EsploraAddressInfo {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

/** ── Analysis layer ───────────────────────────────────────────── */

export type CoinjoinKind =
  | "whirlpool"
  | "wasabi"
  | "wasabi2"
  | "joinmarket"
  | "generic";

export interface CoinjoinVerdict {
  isCoinjoin: boolean;
  kind?: CoinjoinKind;
  confidence: number; // 0..1
  equalOutputCount: number;
  denomination?: number; // sats, dominant equal-output value
  reasons: string[];
}

export interface ChangeVerdict {
  /** Index into vout, or null if undecidable. */
  changeIndex: number | null;
  confidence: number;
  reasons: string[];
}

export type LabelCategory =
  | "exchange"
  | "hack"
  | "sanctioned"
  | "seizure"
  | "mining"
  | "service"
  | "historic";

export interface EntityLabel {
  address: string;
  name: string;
  category: LabelCategory;
  /** Risk contribution 0 (clean / KYC origin) .. 1 (directly criminal). */
  risk: number;
  note?: string;
  /** Where the attribution comes from (kept honest + auditable). */
  source?: string;
}

export type RiskBand = "clean" | "low" | "medium" | "high" | "critical";

export interface Signal {
  key: string;
  label: string;
  detail: string;
}

export interface TxAnalysis {
  txid: string;
  coinjoin: CoinjoinVerdict;
  change: ChangeVerdict;
  isPeelChain: boolean;
  isConsolidation: boolean;
  /** Secondary structural signals (address reuse, dusting, round payments…). */
  signals: Signal[];
  /** 0..100 taint score from ancestry walk. */
  risk: number;
  riskBand: RiskBand;
  riskReasons: string[];
  labels: EntityLabel[]; // labels matched on this tx's own addresses
}

/** ── Graph layer ──────────────────────────────────────────────── */

export interface GraphNode {
  id: string; // txid
  tx: EsploraTx;
  analysis: TxAnalysis;
  /** Hop distance from the trace origin (negative = ancestor). */
  depth: number;
  /** Ancestor expansion exhausted for this node. */
  expandedUp: boolean;
  expandedDown: boolean;
  // d3-force mutates these:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  id: string; // `${source}:${voutIndex}>${target}`
  source: string; // funding txid
  target: string; // spending txid
  value: number; // sats
  address?: string;
  voutIndex: number;
}

export interface TraceGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  origin: string; // txid the trace started from
  /** Union-find cluster id per address (common-input-ownership). */
  addressCluster: Map<string, string>;
}
