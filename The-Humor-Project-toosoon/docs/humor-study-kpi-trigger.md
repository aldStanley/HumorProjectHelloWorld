# Humor Study KPI — trigger & manual kickoff

KPI: **"Release a humor study and get votes"** (Humor Publishers recurring
deliverable). One unit = a study live with ≥5 people voting. Slots run
Mon/Wed/Fri; the reading targets 3 `Humor Study` sessions per week
(measured from crackd_studies).

## The decision (2026-08-06)

**The trigger fires two days before each open slot.**

Every stalled slot in the chain of custody stops at Step 1 — "Captions and
source images ready" (flavor author: Lydia). The KPI had a cadence and an
accountable owner but no push mechanism: nothing converted an upcoming slot
or a stalled baton into action. Two days of lead time is enough to prep
captions and source images before the slot opens.

| Slot day  | Trigger day |
|-----------|-------------|
| Monday    | Saturday    |
| Wednesday | Monday      |
| Friday    | Wednesday   |

## The mechanism

A scheduled cloud routine (claude.ai Code routine) named
**`humor-study-slot-trigger`** runs Sat/Mon/Wed at 07:00 UTC (9am
Europe/Skopje in summer). It works out which slot it is two days ahead of
and sends Lydia a Slack DM with the Step-1 checklist:

1. Pick the humor flavor for this study.
2. Generate and select captions.
3. Have source images ready.
4. Hand the prepared study to the releaser (Tamar Lando).

Manage or disable it at <https://claude.ai/code/routines>.

## Manually starting a new run

Two ways to kick off a run of the workflow outside the schedule:

- **Web:** open <https://claude.ai/code/routines>, find
  `humor-study-slot-trigger`, and hit **Run**.
- **From Claude Code:** ask Claude to "run the humor-study-slot-trigger
  routine now" (it uses the RemoteTrigger tool, `action: "run"` with the
  routine's id — the id is recorded below once created).

## Routine id

Recorded at creation time so the manual trigger is one command:

- id: `trig_01VtQjx7BmnxKYZV5CJz3SKL`
- page: <https://claude.ai/code/routines/trig_01VtQjx7BmnxKYZV5CJz3SKL>
