import Link from "next/link";
import Header from "@/components/Header";
import AmbientGraph from "@/components/AmbientGraph";
import ExampleCards from "@/components/ExampleCards";
import HomeSearch from "@/components/HomeSearch";

const CAPABILITIES = [
  {
    k: "01",
    title: "UTXO ancestry",
    body: "Walk inputs back to their coinbase origin, hop by hop. Every edge is a real spend, weighted by value.",
    color: "var(--accent)",
  },
  {
    k: "02",
    title: "Wallet clustering",
    body: "Common-input-ownership union-find collapses co-spent addresses into a single entity — minus coinjoins.",
    color: "var(--clean)",
  },
  {
    k: "03",
    title: "CoinJoin detection",
    body: "Structural fingerprints for Whirlpool, Wasabi 1 & 2, and JoinMarket — each with a confidence score.",
    color: "var(--mix)",
  },
  {
    k: "04",
    title: "Taint scoring",
    body: "Risk propagates downstream from a seed of documented hacks, seizures, and sanctioned wallets.",
    color: "var(--taint)",
  },
];

export default function Home() {
  return (
    <>
      <Header />

      {/* Hero — asymmetric, left-weighted */}
      <section className="scanline relative overflow-hidden border-b border-line">
        <AmbientGraph />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-transparent" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-24 md:grid-cols-12 md:py-32">
          <div className="md:col-span-7 lg:col-span-6">
            <div className="fade-up flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="microlabel">Bitcoin · UTXO · forensics</span>
            </div>
            <h1
              className="fade-up mt-5 font-sans text-[44px] font-bold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[56px]"
              style={{ animationDelay: "60ms" }}
            >
              Is this coin
              <br />
              <span className="text-accent">safe to accept?</span>
            </h1>
            <p
              className="fade-up mt-5 max-w-lg font-mono text-[15px] leading-relaxed text-dim"
              style={{ animationDelay: "120ms" }}
            >
              Before you accept a Bitcoin payment, paste the sender&apos;s address
              below. HEURISTIC traces its history back toward origin, screens it
              against the OFAC sanctions list and known entities, and tells you
              whether an exchange would accept it — with every reason shown.
            </p>
            <div
              className="fade-up mt-7 max-w-lg"
              style={{ animationDelay: "150ms" }}
            >
              <HomeSearch />
            </div>
            <div
              className="fade-up mt-4 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "210ms" }}
            >
              <Link
                href="/check"
                className="rounded-[2px] bg-accent px-6 py-3 font-mono text-[13px] uppercase tracking-wider text-bg transition-opacity hover:opacity-90"
              >
                ✓ Check a coin →
              </Link>
              <Link
                href="/explore"
                className="rounded-[2px] border border-line px-6 py-3 font-mono text-[13px] uppercase tracking-wider text-dim transition-colors hover:border-accent/40 hover:text-accent"
              >
                Open the explorer
              </Link>
              <Link
                href="/mempool"
                className="rounded-[2px] border border-line px-6 py-3 font-mono text-[13px] uppercase tracking-wider text-dim transition-colors hover:border-accent/40 hover:text-accent"
              >
                Watch the mempool
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Curated investigations — one click to see the tool work */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-end justify-between border-b border-line pb-4">
          <div>
            <span className="microlabel">Start here</span>
            <h2 className="mt-1 font-sans text-[22px] font-bold tracking-tight text-ink">
              Curated investigations
            </h2>
          </div>
          <Link
            href="/explore"
            className="font-mono text-[13px] text-dim transition-colors hover:text-accent"
          >
            open explorer →
          </Link>
        </div>
        <p className="mt-3 max-w-xl font-mono text-[13px] leading-relaxed text-dim">
          No need to hunt for a transaction. Open one of these and watch the
          clustering, coinjoin detection, and taint scoring run live.
        </p>
        <div className="mt-6">
          <ExampleCards />
        </div>
      </section>

      {/* Capabilities — offset 2-col, not a symmetric 3-up grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex items-end justify-between border-b border-line pb-4">
          <h2 className="font-sans text-lg font-bold tracking-tight text-ink">
            What it does
          </h2>
          <span className="microlabel">04 instruments</span>
        </div>
        <div className="mt-px grid md:grid-cols-2">
          {CAPABILITIES.map((c, i) => (
            <div
              key={c.k}
              className={`group border-line p-7 transition-colors hover:bg-surface/60 ${
                i % 2 === 0 ? "md:border-r" : ""
              } ${i < 2 ? "border-b" : ""}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="font-mono text-[11px] tabular-nums"
                  style={{ color: c.color }}
                >
                  {c.k}
                </span>
                <span
                  className="h-px flex-1"
                  style={{ background: "var(--line)" }}
                />
                <span
                  className="h-2 w-2 rounded-full transition-transform group-hover:scale-125"
                  style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }}
                />
              </div>
              <h3 className="mt-4 font-sans text-[17px] font-medium tracking-tight text-ink">
                {c.title}
              </h3>
              <p className="mt-2 max-w-sm font-mono text-[12px] leading-relaxed text-dim">
                {c.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Self-host strip */}
      <section className="border-y border-line bg-surface/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-14 md:flex-row md:items-center md:justify-between">
          <div className="max-w-lg">
            <span className="microlabel">Privacy &amp; your own node</span>
            <p className="mt-2 font-mono text-[14px] leading-relaxed text-dim">
              By default, queries route through this site to mempool.space — so
              the operator and mempool.space can see what you look up. Open{" "}
              <span className="text-accent">⚙ settings</span> and point HEURISTIC
              at your own electrs/mempool instance: queries then go{" "}
              <span className="text-ink">straight from your browser to your
              node</span>{" "}— nothing touches our servers, no rate limits. Any
              machine running a full node with electrs/mempool handles it.
            </p>
          </div>
          <div className="shrink-0 rounded-[2px] border border-line bg-bg p-4 font-mono text-[12px] leading-relaxed text-dim">
            <span className="text-faint"># in ⚙ settings → Your instance</span>
            <br />
            <span className="text-ink">REST</span>{" "}
            <span className="text-clean">http://your-node.local:3006/api</span>
            <br />
            <span className="text-ink">WS&nbsp;&nbsp;</span>{" "}
            <span className="text-clean">ws://your-node.local:3006/api/v1/ws</span>
            <br />
            <span className="mt-1 block text-faint">
              # or set ESPLORA_API_BASE for the default
            </span>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 font-mono text-[10px] text-faint">
        <span>HEURISTIC — heuristic, not proof. Verify before you accuse.</span>
        <span>data: mempool.space / esplora</span>
      </footer>
    </>
  );
}
