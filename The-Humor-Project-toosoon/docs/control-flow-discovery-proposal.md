# Control-Flow Discovery for the Activity Graph — Proposal (v2, output-first)

**Goal:** make the graph answer *"what starts the work"* with the same evidence
discipline the edges have.

**The anchor (v2 correction, from Lydia):** a trigger is only recognizable AS a
trigger relative to the work it starts — so discovery must begin from the
group's **key recurring outputs**, not from trigger language. v1 of this
proposal started with a free-floating trigger reader; that was inverted.
Everything in this session that held up was secretly output-anchored: the
strongest evidence was always *dated output instances* (HP-1254 released
Mon 8/03, HP-1279 Wed 8/05), and the daily-study correction happened exactly
because instance evidence beat declaration evidence.

**A routine is: a recurring output stream + its cadence + what starts each
instance.** Triggers are answers to "why did instance N happen *when* it did."

Stages, each independently shippable and falsifiable:

---

## Stage 0 — Output Census (the anchor)

Classify the graph's existing 66 artifact nodes + per-phase `produces` into:

- **recurring output streams** — instances repeat: humor studies, Sidechat
  posts, standups, weekly deliverables/eval reports, flavor launches, lexicon
  snapshots
- **one-off artifacts** — a schema, a migration, a document
- **infrastructure** — codebases, tools (they *enable* streams, they aren't
  streams)

AI pass proposes the classification; human blesses the stream list (it's
short — likely 6–10 streams). Existing machinery to build on: the artifacts
registry and the activity→output attribution layer
(`result.activityOutputs` — evidence-based links from activities to the
artifacts they produce, already human-confirmed via propose→PUT).

**This stage answers "what are the key outputs of the group" as its own
deliverable, before any trigger is mentioned.**

## Stage 1 — Instance Harvest (AI reader; no regex)

Per blessed stream, an AI pass over the D/O/Ls asking one question:

> Does this item report a **delivered instance** of `<stream>`?
> If yes: `{ date, instanceKey (e.g. card #, study #), verbatimSpan, itemKey }`

Output: a dated instance timeline per stream ("Humor Study #26 · 8/04",
"HP-1279 released · 8/05"). The Linear done-cards lane and stats-report
mentions are prime instance sources.

**Falsification test:** the reader must recover the instances this session
found by hand (study releases jul 8 → aug 5, the standup submissions, the
Sidechat posts of spring) — the golden-test discipline from CLAUDE.md.

## Stage 2 — Rhythm per Stream (mechanical; numbers, not semantics)

Cadence detection on **instance timelines**, not phase chat activity —
periodicity, weekday structure, gaps, era breaks. (v1 measured phase activity
histograms, which mix *talking about* work with *doing* it; instance rhythms
are the clean signal.) Output per stream: cadence + era windows + anomalies
(streams with instances but no rhythm; rhythms that changed).

## Stage 3 — Backward Trigger Attribution (AI; per stream, now anchored)

For each stream, an AI reader answers: **"why did instance N happen when it
did?"** — reading (a) D/O/L items around each instance, (b) the two new
declaration lanes:

- **Open-commitments lane:** ALL Linear card titles/descriptions — open,
  in-progress, done — as a declarations feed. Explicitly NOT in the phase
  tree (that decision stands); this is the lane that would have surfaced
  Tamar's "release a study every MWF" card the day it was created.
- **Config lane:** the self-service cron registry ('cron job schedules'
  table), Akify ping schedules, KPI routines — pre-structured ground truth;
  a join, not an LLM.

Output: typed trigger hypothesis per stream
`{ triggerType: clock|event|approval|quota|deadline|bot, condition, cadence,
evidence[] }` — every claim with verbatim span + source lane.

## Stage 4 — Reconciliation Judge (AI; where routines are born)

Per stream, reconcile **instances × rhythm × declarations × config**:

| status | meaning | example from this session |
|---|---|---|
| CONFIRMED | declaration + instance rhythm agree | MWF standups (quote + Mon/Wed/Fri, Sat 0) |
| ASPIRATIONAL | declared, instances don't bear it out | "one study per day" (7/03 manual decision, zero-study week) |
| UNDECLARED | instance rhythm, no declaration found | Mon 8/03 / Wed 8/05 beats before HP-1144 surfaced |
| LAPSED | operated, era ended | daily Sidechat quota (last instance 7/13) |

Era windows mandatory — cadences here lived 2–6 weeks (daily goal → Fri 5PM →
MWF), so **cadence succession diffs are a primary output**, not noise.
Governance mirrors north-star B5: the judge PROPOSES `routines`; a human
blesses (acceptRediscover pattern). Schema + golden example:
`docs/control-flow-routines-proposal.json`.

## Stage 5 — Holes Become Questions

UNDECLARED streams and declaration/instance contradictions each emit one
graph question via the existing graph-questions machinery, routed to the
stream's people ("Live-performance analysis has inputs and instances but no
detectable trigger — does one exist?"). One human answer resolved the MWF
mystery in one message; a well-aimed question is the cheapest sensor.

---

## Decisions needed

1. **Bless the stream list** (Stage 0 output) — the census proposes, you cut.
2. **Open-cards lane approval** — all card titles/descriptions as a
   declarations feed, separate from the phase tree. OK?
3. **Cron registry access** — table name/location for the config lane join.
4. **Lens placement** — routines inside discovery-all after blessing, or a
   standing sibling lens (`control-routines`) the trace tool reads?

## Order of value

0 → 1 → 2 give "what does the group ship, and on what rhythm" — valuable
standalone, before any trigger work. 3 (with the open-cards lane) fixes the
failure that started this thread. 4–5 turn the one-off session analysis into
a maintained layer.
