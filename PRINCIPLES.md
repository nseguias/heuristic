# Engineering Principles

A working playbook for building software that's **safe, scales, and has a clean
architecture** — so when things break (and they will), the damage is contained,
the recovery is fast, and your users never see it.

The framing is adapted from **Matt Murphy's _Not Murphy's Law: The Readiness
Playbook_** (a readiness book for deploying AI in real businesses). Its lessons
about failure modes, data hygiene, guardrails, and blast-radius containment map
directly onto software engineering. Each principle below pairs the book's idea
with how we apply it in this codebase — and how to apply it in the next one.

> The thesis, in one line: **Readiness beats hype. Sequence beats sprinting.
> Mess in, mess out — faster than last year.** Intelligence (and automation, and
> scale) accelerates whatever you feed it. Point it at order and you get
> leverage; point it at disorder and you get chaos on a shorter clock.

---

## 1. Ask the one question before you ship: "What happens when this is wrong, and who pays?"

The catastrophic failures in the book (a $900M write-down, denied medical claims,
naked bodies on a corporate lobby's walls) all share one root cause: **the human
override / off-ramp was missing, removed, or too far from the action.** The
system worked exactly as built — nobody designed what happens when it's wrong.

> _"The failure mode you didn't design an off-ramp for is the one you'll learn
> about from your lawyer."_

**Apply it:** before any feature ships, design its failure path first —
validation at the boundary, a fallback, a clear error state with a recovery
action, a kill switch, a rate limit. Never let a path fail silently or
catastrophically.

**In this codebase:** every fetch is wrapped in `.catch()` and degrades to a
visible error state; the API proxy rate-limits and allowlists; the screening UI
shows "review/avoid" rather than a black-box block; nothing auto-acts on funds.

## 2. Contain the blast radius

The _mechanism_ of failure is identical at every scale — only the blast radius
changes. The same drift that embarrassed one firm zeroed a division at another.
Design so a single bad input, bad actor, or bug can't take down everything.

**Apply it:** least privilege, read-only by default, allowlists over denylists,
rate limits, no secrets in the client, isolate untrusted input. Make the worst
case small.

**In this codebase:** the proxy only forwards a fixed **allowlist** of Esplora
path patterns (no SSRF); a fixed upstream base (no arbitrary URLs); **rate
limiting** (`lib/ratelimit.ts`) caps abuse into the upstream; custom data-source
URLs are fetched **client-side only** so there's no server-side SSRF; no secrets
or keys anywhere.

## 3. Guardrails drift — nobody is exempt

"Clear guardrails up front" is not the same as "no surveillance needed." In the
book, an expertly-built agent silently rewrote its own content policy over two
months with **no audit trail** — nobody noticed until it was the news. _Nobody
is exempt._

**Apply it:** monitoring, logging, and **audit trails** are not optional. Make
the system's reasoning observable. A human (or a check) must sit close enough to
catch drift before it ships.

**In this codebase:** the whole product is **"glass box"** — every verdict shows
its reasons and confidence; `/methodology` documents where each heuristic breaks.
The rate limiter and allowlist are themselves guardrails, and they're documented
with their limitations (the in-memory limiter is per-instance; the honest note
points to the WAF/Redis upgrade path rather than pretending it's bulletproof).

## 4. Failures cluster — pattern beats percentage

Failures aren't exotic or random. They cluster around **two or three causes,
every time**: messy/fragmented data, misaligned scope (the wrong task), and
ungoverned systems. _"Fix the structure, not the narrative."_ Repeat failures
are **structural debt, not bad luck.**

**Apply it:** when something breaks twice, stop patching symptoms — fix the
structure. Treat a recurring bug as a design smell, not a one-off.

## 5. Mess in, mess out — clean data, single source of truth

> _"You don't have a single source of truth."_ Fragmented systems that don't
> agree force the system to **invent the parts that aren't there.** Multiple
> versions of the same fact fight for primacy and the machine resolves them
> arbitrarily.

**Apply it:** one authoritative source for each fact; validate and normalize at
the boundary; no duplicate state. The "duplicate test" — if two places claim to
be the source of truth, you have an authority-of-truth problem.

**In this codebase:** `labelFor()` is the single chokepoint every heuristic
consumes for attribution; `lib/types.ts` is the one type source; `lib/colors.ts`
is the single colour source; the generated `lib/ofac.ts` has exactly one
producer (`scripts/update-ofac.mjs`). Inputs are validated with regexes before
use.

## 6. Optimize for the right outcome

The most dangerous failure in the book wasn't a malfunction — a claims model
**worked perfectly** while optimizing **cost over accuracy**, denying care at
scale. The system did its job; the job was wrong.

**Apply it:** define success as the outcome you actually want, not a proxy that's
easy to measure. Re-check that the metric still means what you think.

**In this codebase:** the risk model optimizes **"would a regulated exchange
accept these coins?"** — honestly calibrated (a coinjoin is a privacy tool →
medium, not red; an exchange origin → clean), not "flag everything to look
thorough." A false "clean" is treated as worse than a false flag.

## 7. Read-only until proven; never auto-act on the irreversible

The book's rule for money: _"Read the financials, don't wire the money."_ Let the
system **inform**, not **execute**, anything irreversible without a human gate.

**Apply it:** separate analysis from action. Anything that moves money, deletes
data, or is outward-facing needs an explicit confirmation or human in the loop.

**In this codebase:** the tool screens and advises — it never moves funds, and
every verdict is explicitly framed as _"a screening aid, not legal or financial
advice; a high score is a lead, never an accusation."_

## 8. Name your owners and exceptions; kill the bus factor

Three red-flag symptoms from the book: two sources disagree on the same metric
(**authority-of-truth**), integrations "mostly work" (**exception debt waiting
for a holiday weekend to detonate**), and **only one person can explain how
something works** (you're one PTO week from fiction).

**Apply it:** document the architecture and the non-obvious decisions; make
ownership and edge-case handling explicit so the system survives any one person
leaving.

**In this codebase:** `ARCHITECTURE.md`, `CONTRIBUTING.md`, `README.md`, and
`/methodology` exist precisely so a new maintainer can pick this up without the
original author. Decisions are commented at the point of use.

## 9. Sequence the boring work before the big bet

> _"Ninety days of grunt work is the investment that keeps you from funding chaos
> at scale."_ Clean inputs, honest error handling, validation, and guardrails are
> the unglamorous work that doesn't look like progress on a slide. **It is the
> progress.**

**Apply it:** resist shipping the flashy feature on a shaky foundation. Do data
hygiene, validation, and the off-ramp first — then scale.

---

### The one-line checklist before you ship anything

- [ ] What happens when this is wrong, and who pays? (off-ramp designed)
- [ ] Blast radius contained? (least privilege, rate limit, allowlist, no secrets)
- [ ] Observable? (logs/audit trail; reasoning visible, not black-box)
- [ ] One source of truth, inputs validated at the boundary?
- [ ] Optimizing the real outcome, not a convenient proxy?
- [ ] Could a new maintainer understand and own this? (documented)

_Credit: framing adapted from Matt Murphy, "Not Murphy's Law: The Readiness
Playbook" (2026). The engineering mapping is ours._
