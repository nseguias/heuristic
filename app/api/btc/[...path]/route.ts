import { NextRequest, NextResponse } from "next/server";

/**
 * Thin proxy in front of an Esplora-compatible API. Defaults to mempool.space;
 * point ESPLORA_API_BASE at a self-hosted electrs/mempool instance (e.g. your own node)
 * to drop the public rate limits without touching the frontend.
 */
const API_BASE = process.env.ESPLORA_API_BASE ?? "https://mempool.space/api";

const ALLOWED = [
  /^tx\/[0-9a-f]{64}$/,
  /^tx\/[0-9a-f]{64}\/outspends$/,
  /^address\/[a-zA-Z0-9]{14,74}$/,
  /^address\/[a-zA-Z0-9]{14,74}\/txs$/,
  /^address\/[a-zA-Z0-9]{14,74}\/txs\/chain\/[0-9a-f]{64}$/,
  /^blocks\/tip\/height$/,
  /^blocks\/tip\/hash$/,
  /^block\/[0-9a-f]{64}$/,
  /^block\/[0-9a-f]{64}\/txids$/,
  /^mempool$/,
  /^mempool\/recent$/,
  /^mempool\/txids$/,
  /^v1\/prices$/,
];

// The full mempool txid list is ~100k entries / several MB; we only ever need a
// small sample to seed visuals, so slice it server-side.
const TXIDS_LIMIT = 150;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const joined = path.join("/");

  if (!ALLOWED.some((re) => re.test(joined))) {
    return NextResponse.json({ error: "unsupported path" }, { status: 400 });
  }

  // Address tx listings can exceed Next's 2MB data-cache limit; stream them
  // uncached. Tip height is volatile. Everything else is immutable chain data.
  const isAddressList = joined.startsWith("address/");
  const isTxids = joined === "mempool/txids";
  const isTip =
    joined.startsWith("blocks/tip") ||
    joined.startsWith("mempool") ||
    joined === "v1/prices";
  const upstream = await fetch(`${API_BASE}/${joined}`, {
    headers: { accept: "application/json" },
    ...(isAddressList || isTxids
      ? { cache: "no-store" as const }
      : { next: { revalidate: isTip ? 30 : 3600 } }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return NextResponse.json(
      { error: text || upstream.statusText },
      { status: upstream.status }
    );
  }

  let body = await upstream.text();
  if (isTxids) {
    try {
      body = JSON.stringify(
        (JSON.parse(body) as string[]).slice(0, TXIDS_LIMIT)
      );
    } catch {
      /* pass through on parse failure */
    }
  }
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": isTip
        ? "public, max-age=30"
        : isAddressList
          ? "public, max-age=120"
          : "public, max-age=3600",
    },
  });
}
