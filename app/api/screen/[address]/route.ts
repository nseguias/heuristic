import { NextResponse } from "next/server";
import { buildScreening } from "@/lib/screening";
import type { EsploraTx } from "@/lib/types";

/**
 * Address screening API — a machine-readable acceptance-risk assessment for any
 * Bitcoin address, the way Chainalysis KYT / Elliptic Lens expose screening.
 * Screens direct counterparties (a deep ancestry trace is reserved for the UI
 * to keep this endpoint cheap and fast).
 *
 *   GET /api/screen/<address>  →  { score, band, sanctioned, exposures, ... }
 */

const API_BASE = process.env.ESPLORA_API_BASE ?? "https://mempool.space/api";
const ADDR = /^(bc1[a-zA-HJ-NP-Z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  if (!ADDR.test(address))
    return NextResponse.json(
      { error: "invalid bitcoin address" },
      { status: 400 }
    );

  const res = await fetch(`${API_BASE}/address/${address}/txs`, {
    headers: { accept: "application/json" },
    next: { revalidate: 120 },
  });
  if (!res.ok)
    return NextResponse.json(
      { error: "upstream lookup failed" },
      { status: res.status }
    );

  const txs = (await res.json()) as EsploraTx[];
  const r = buildScreening(address, txs);

  return NextResponse.json(
    {
      address: r.address,
      score: Math.round(r.score),
      band: r.band,
      sanctioned: r.sanctioned,
      label: r.self?.name ?? null,
      exposures: r.exposures.map((e) => ({
        category: e.category,
        name: e.name,
        risk: e.risk,
        share: Number(e.share.toFixed(4)),
        direct: e.direct,
      })),
      counterparties: r.counterparties.map((c) => ({
        name: c.name,
        category: c.category,
        direction: c.direction,
        valueSats: c.value,
        risk: c.risk,
      })),
      reasons: r.reasons,
      analyzed: { transactions: r.analyzedTxs, flowSats: r.analyzedFlow },
      disclaimer:
        "Heuristic acceptance-risk estimate over a small open label set — direct counterparties only. Glass-box, not legal or financial advice.",
    },
    { headers: { "cache-control": "public, max-age=120" } }
  );
}
