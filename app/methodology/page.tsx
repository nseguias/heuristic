import Header from "@/components/Header";
import Link from "next/link";

export const metadata = { title: "Methodology — HEURISTIC" };

const SECTIONS = [
  {
    h: "Common-input-ownership clustering",
    p: "When a transaction spends multiple inputs, those input addresses are almost always controlled by one entity — you need every private key to sign. We union-find all co-spent addresses into a single cluster. CoinJoins are explicitly excluded, because their whole purpose is to break this assumption.",
    caveat:
      "PayJoin and some multi-party protocols deliberately violate this. Treat clusters as strong hints, not identities.",
  },
  {
    h: "CoinJoin fingerprinting",
    p: "CoinJoins leave a structural signature: many outputs of identical value funded by a comparable number of inputs. We match against known schemes — Whirlpool (fixed 5×5 denominations), Wasabi 1 (~0.1 BTC base), Wasabi 2 / WabiSabi (large participant sets), and JoinMarket (small equal-output sets) — and emit a confidence per match.",
    caveat:
      "A high-participant payment batch can look like a coinjoin. Confidence below ~0.6 means 'structurally plausible', not 'confirmed'.",
  },
  {
    h: "Change-output detection",
    p: "For two-output spends we combine several signals: the output whose script type matches the inputs is likely change; a round-number output is likely the payment, leaving the remainder as change. Signals are scored and the winner is reported with a confidence.",
    caveat:
      "Wallets that randomize change position and match address types defeat this. It is the weakest heuristic here by design.",
  },
  {
    h: "Exchange-acceptance risk",
    p: "The score estimates how a regulated exchange's compliance desk would treat these coins — higher means less likely to be accepted, more likely to be flagged or frozen. Two independent factors combine (by max): label taint flows downstream from documented hacks, seizures, and sanctioned wallets (these go RED); and mixing exposure rises with the number of coinjoins the coins passed through. A coinjoin is a legitimate privacy tool, so one or a few mixes is MEDIUM — only heavy, repeated remixing trends toward HIGH, and a coinjoin only goes RED when its source is actually flagged.",
    caveat:
      "This models exchange behaviour, not guilt — privacy is legitimate and a high score is not an accusation. Attribution combines the full U.S. Treasury OFAC SDN sanctioned-address list (the authoritative 'do not touch' source) with a small curated set of documented entities, each with a source. PayJoin defeats detection entirely, so payjoined coins score low — a known blind spot, not a clean bill.",
  },
  {
    h: "Address screening & exposure",
    p: "Any address can be screened for direct exposure (the labelled entities it transacts with) and indirect exposure (labelled entities reached by tracing its funding history — the same 'go back until you hit a known service' approach commercial tools use). Results aggregate by risk category into one acceptance-risk score, available both in the UI and as a JSON API at /api/screen/<address>. Sanctions screening runs against the live OFAC list.",
    caveat:
      "Screening quality is bounded by the label set: it lights up on sanctioned and documented entities but stays blank for unknown ones. The engine is complete; broader attribution data is the ongoing work.",
  },
  {
    h: "Secondary signals",
    p: "Beyond the headline verdicts, we surface behavioural tells: address reuse (paying back to a funding address — a privacy leak), dusting (clusters of economically meaningless outputs used for tracking), round-number payments (which usually mark the payment vs. the change), and self-transfers (every output returns to an input address). On the graph, edges believed to carry self-change render dashed amber rather than solid.",
    caveat:
      "These are weak, individually-defeatable signals — useful in aggregate to characterise a wallet's behaviour, not to prove intent.",
  },
];

export default function MethodologyPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <span className="microlabel">Documentation</span>
        <h1 className="mt-2 font-sans text-[32px] font-bold tracking-[-0.03em] text-ink">
          Methodology
        </h1>
        <p className="mt-3 font-mono text-[13px] leading-relaxed text-dim">
          Every verdict in HEURISTIC is a heuristic — a probabilistic read of
          on-chain structure, not cryptographic proof. This page documents what
          each one assumes and where it breaks. The point of the tool is to make
          the reasoning visible, so you can argue with it.
        </p>

        <div className="mt-10 space-y-10">
          {SECTIONS.map((s, i) => (
            <section key={i} className="border-t border-line pt-6">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] tabular-nums text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="font-sans text-[18px] font-medium tracking-tight text-ink">
                  {s.h}
                </h2>
              </div>
              <p className="mt-3 font-mono text-[12px] leading-relaxed text-dim">
                {s.p}
              </p>
              <p className="mt-3 border-l-2 border-taint/40 pl-3 font-mono text-[11px] leading-relaxed text-warn">
                Caveat — {s.caveat}
              </p>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-[2px] border border-line bg-surface/50 p-5">
          <span className="microlabel">Ethic</span>
          <p className="mt-2 font-mono text-[12px] leading-relaxed text-dim">
            Chain surveillance has real consequences for real people. HEURISTIC
            is built to make these techniques legible and contestable — to show
            that &ldquo;dirty coin&rdquo; labels rest on assumptions that often
            do not hold. Use it to understand the system, not to punish strangers
            for the history of a UTXO they had no part in.
          </p>
        </div>

        <div className="mt-10">
          <Link
            href="/explore"
            className="rounded-[2px] bg-accent px-5 py-2.5 font-mono text-[12px] uppercase tracking-wider text-bg transition-opacity hover:opacity-90"
          >
            Open the explorer →
          </Link>
        </div>
      </main>
    </>
  );
}
