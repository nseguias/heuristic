# Contributing

Thanks for considering a contribution to HEURISTIC. The goal of this project is
to make chain-analysis techniques **transparent and contestable** — so the bar
for any change is: *is it honest, and does it show its reasoning?*

## Getting set up

```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run build    # must pass before opening a PR
```

Node 20+. No keys or services required — it runs against public mempool.space.

## Where help is most valuable

1. **Attribution data** (highest impact). The risk model is only as good as its
   labels. Adding verified entity labels — or wiring in a maintained attribution
   dataset — is the single biggest improvement. See `lib/labels.ts` and the
   attribution notes in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
2. **More chains / assets.** Currently Bitcoin-only.
3. **New heuristics** — and, just as importantly, documenting where they break.
4. **A test suite.** There isn't one yet.
5. **Saved investigations / exportable reports** (case management).

## Ground rules

- **Never ship a false "clean".** A wrong exchange/clean label is worse than no
  label — it falsely clears coins. Verify every address on-chain before adding
  it, and prefer under-labelling to mislabelling.
- **Every verdict shows its reasons.** Don't add black-box scoring. Surface the
  "why" in the UI and keep `/methodology` honest about limitations.
- **Privacy is legitimate.** A high score is a lead to investigate, not an
  accusation. Coinjoins/PayJoins are privacy tools — keep them medium-risk
  unless the source is actually flagged.
- **No secrets, no personal infrastructure** in commits (no keys, IPs, node
  hostnames). The data source is configured via `ESPLORA_API_BASE` or in-app
  settings — never hardcoded.
- **`lib/ofac.ts` is generated** — edit `scripts/update-ofac.mjs`, then run
  `npm run update-ofac`. Don't hand-edit the generated file.

## Style

- Match the surrounding code: TypeScript, Tailwind, the money-colour and
  number-formatting conventions (`lib/format.ts`, `lib/colors.ts`).
- Keep canvas hot paths off React state (refs + `requestAnimationFrame`).
- If you change bubble sizing/density or the risk calibration, re-verify the
  invariants (zero bubble overlap; coinjoin stays medium; flagged sources go
  red).

## Pull requests

- Keep them focused; explain the reasoning, not just the change.
- Run `npm run lint` and `npm run build` first.
- Update `README.md` / `ARCHITECTURE.md` / `/methodology` if behaviour changes.
