import type { EsploraTx } from "./types";
import { detectCoinjoin, inputAddresses } from "./heuristics";

/**
 * Union-find over addresses implementing the common-input-ownership heuristic:
 * when a non-coinjoin transaction spends several inputs, those input addresses
 * are co-owned and merged into one cluster. Coinjoins are excluded — their
 * inputs belong to different participants.
 */
export class AddressClusters {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  private find(a: string): string {
    let root = a;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) ?? root;
    }
    // Path compression.
    let cur = a;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) ?? root;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  private add(a: string) {
    if (!this.parent.has(a)) {
      this.parent.set(a, a);
      this.rank.set(a, 0);
    }
  }

  union(a: string, b: string) {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  /** Merge all input addresses of a transaction (unless it's a coinjoin). */
  ingest(tx: EsploraTx) {
    if (detectCoinjoin(tx).isCoinjoin) return;
    const addrs = inputAddresses(tx);
    for (let i = 1; i < addrs.length; i++) this.union(addrs[0], addrs[i]);
  }

  clusterId(a: string): string {
    this.add(a);
    return this.find(a);
  }

  /** Short stable handle for display, e.g. CLUSTER·3F9A. */
  clusterTag(a: string): string {
    const root = this.clusterId(a);
    let h = 0;
    for (let i = 0; i < root.length; i++) h = (h * 31 + root.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).slice(0, 4).toUpperCase();
  }

  /** Map every known address to its cluster root. */
  snapshot(): Map<string, string> {
    const out = new Map<string, string>();
    for (const a of this.parent.keys()) out.set(a, this.find(a));
    return out;
  }

  size(): number {
    const roots = new Set<string>();
    for (const a of this.parent.keys()) roots.add(this.find(a));
    return roots.size;
  }
}
