# Persona schema for the 1546 chain (multi-person-scene)

Goal: separate everything SAD-GIRL-specific in flavor 1546's 16 steps from the
persona-agnostic machinery, so a new persona can be slotted in by filling a
data pack — not by rewriting prompts from scratch.

Source: flavor 1546 `multi-person-scene-SAD-GIRL-4`, steps dumped 2026-08-07.

---

## 1. What is already persona-free (no changes needed)

| Step | Why it's clean |
|------|----------------|
| S1 pixels read | pure image description |
| S2 physical analog | pure core/secondary skeleton extraction |
| S3 entity extraction | ensemble + secondary, pixels only |
| S4 metaphor brainstorm | abstract patterns, explicitly domain-free |
| S14 score extraction | mechanical JSON reshuffle |
| S15 Quick Study export | mechanical assembly |
| S16 dedup + selection | mechanical passes over registers (one cosmetic WRONG example, see §4) |

Everything persona-specific lives in **S5–S13**: the three lens reads
(S5/S8/S11), the three moment writers (S6/S9/S12), and the three caption
writers (S7/S10/S13).

**The universal structure those nine steps implement** (this is the part a new
persona must be able to inhabit — it is the go/no-go test for a persona idea):

1. **in_scene** — the persona + same-kind peers are IN the picture.
2. **watched_scene** — a scene from the ANTAGONIST world, persona off-screen,
   and the scene costs her something.
3. **internal** — the persona vs her own PERSONIFIED FORCES (or vs a
   state-stamped second self).

A persona that cannot fill all three worlds (a peer side, an opposite-kind
antagonist side worth watching, and a recognizable internal cast) will not fit
this chain — pick a different persona rather than bending the lenses.

---

## 2. The persona data pack (the fill-in sheet)

Twelve fields. Sad-girl values shown as the worked example under each.

### P1 — PERSONA BLOCK
One paragraph pasted verbatim into S5, S6, S8, S9, S11, S12: WHO the persona
is (2–3 traits, self-awareness among them), the central ongoing predicament,
then "Her world:" + 5–8 inventory items (recurring behaviors, rituals, props).

> A sad girl — very funny, very self-aware, probably in a toxic situationship.
> Her world: situationships, avoidant men, rereading texts, going back after
> saying she's done, telling her friends everything, fake "i don't care"
> energy, trying not to crash out.

### P2 — PEER SET (lens 1, in_scene)
The same-kind entities that can stand beside "me" in the picture, plus the
collective props they share.

> me, my bestie, my friends, the group chat

### P3 — ANTAGONIST WORLD (lens 2, watched_scene)
The different-kind side that causes her pain: a cast list whose members can
form ONE relationally coherent story, staged without her, such that watching
it costs her something.

> my situationship, my ex, the avoidant man, his best friend, his roommate,
> his new girl, men on a boys' night

### P4 — CROSS-SIDE PAIR (1546's S5 exception)
The ONE antagonist-world entity allowed beside "me" in the in_scene lens when
the core demands a different-kind slot ("me and X" are opposite kinds in this
persona's world).

> my situationship / my ex ("me and him")

### P5 — FORCE CANON (lens 3, internal)
2–4 word personified abstractions that pass the "nobody: / X:" test, plus the
state-stamp dimensions for me-vs-me forms.

> my delusion, my anxiety, my self respect, my urge to text him, my last
> brain cell; state stamps: time ("me at 2am" / "me at 9pm"), condition
> ("me after one crumb of attention")

### P6 — CANON REFERENTS (referent ledger, S7/S10/S13)
Entities the caption may use with NO noun-phrase introduction — the world
presupposes them. Everything else must be named on first mention.

> him / he / his (the situationship), my friends, the group chat, my ex,
> his new girl

### P7 — VOICE
The caption voice block, plus the banned feeling-words.

> very self-aware, slightly dramatic but grounded, ironic not cringe, chaotic
> but aware of it; hyper-specific > generic — feels like a private story or a
> close friends post; never state the feeling word ("sad", "anxious") — the
> behavior carries it

### P8 — EXPENSE LOGIC (who pays)
(a) WHOSE expense the joke must land at; (b) what counts as a HIDDEN WIN that
disqualifies (the flex disguised as a loss); (c) the wincing audience for the
last-laugh test; (d) the imagining rule carries over unchanged.

> (a) hers, always. (b) evidence he still wants her ("my hoodie still in his
> closet", "his mom still liking my photos") is a gain — it counts as her
> expense only when the sentence shows her PAYING with a visible behavior
> (replying anyway, waiting up, not blocking). (c) her friends: whose behavior
> in the sentence would her friends wince at? (d) with "picturing/imagining",
> score the loss INSIDE the imagined scene.

### P9 — DEMOGRAPHIC DOCK
The mechanical −0.1 rule: which visible demographic mismatch on a PHOTOGRAPHED
real human costs exactly 0.1 (never more) when carrying "me"/peer entities.
Avatars (cartoons, animals, costumes) are always exempt.

> figures that visibly read as men, docked −0.1 when cast as her or her
> friends

### P10 — READER
Who judges allusion + context recovery: the community reader who must be able
to rebuild the joke from caption + image alone.

> a reader who lives the sad-girl life (situationships, group chats,
> rereading texts) but has NOT seen the element map

### P11 — REGISTER GRAMMAR OPENERS
The literal caption frames per register (derived from P2–P5 but spelled out in
the caption prompts).

> in_scene: "me...", "me and my friends...", "me and him..." (the last only
> under the cross-side exception) · watched_scene: "my ex and his best friend
> after...", "him and his boys when..." — she never appears; the at-her-expense
> trigger must be in the caption · internal: "me..." + at most ONE force or a
> state-stamped self ("me and my urge to text him when...", "me at 2am proving
> me at 9pm wrong...")

### P12 — WRONG/RIGHT EXAMPLE PAIRS (the real porting work)
Every behavioral rule in S5–S13 carries a WRONG/RIGHT pair written in
sad-girl CONTENT. Per CLAUDE.md, stale examples silently override new rules —
**all pairs must be regenerated in the new persona's world in the same edit
that swaps P1–P11.** The rules themselves do not change; only the story
inside each example does. Catalog in §3.

---

## 3. Per-step replacement map

Legend: which pack fields each step consumes, and the example pairs (P12) that
must be regenerated in-place.

### S5 — in-scene read
- P1 persona block; P2 peer entities (schema enum too: `"<me | my bestie | my friends | ...>"`);
  P4 cross-side exception entity; P9 gender dock.
- P12 pairs: "two photographed men as me and my best friend" (dock rule);
  "me + my bestie on a different-kind core" vs "me + my situationship"
  (cross-side rule); secondary nomination example "the group chat voting on
  whether I text him back".

### S6 — moments, in_scene
- P1; concrete entity examples "(me, my situationship, my friends, the group
  chat, his ex, Hinge)"; stakes example "(he soft launches another girl while
  still texting you good morning)"; P8 who-pays (incl. picturing examples).
- P12 pairs: "rereading his 'lol' six times" (filmable behavior); the
  blocking/napkin pair (stand-alone trigger); "my delusion and my urge to text
  him hyping each other up" (forces fit any figure); the "no girlfriends until
  30 pact" picturing pair (expense).
- Step title itself says "Sad-girl moments" — rename.

### S7 — captions, in_scene
- P7 voice; P6 canon referents; P10 reader; P11 register grammar; P8
  speaker-agency test (`at_her_expense` — this scorer exists ONLY in S7).
- P12 pairs (largest set): texting-first/left-on-delivered (setup-half rule);
  brunch + 3am-text (peer test, twice); Hinge-clown-suit (entity-not-clause);
  soldiers/"every version of me" (cardinality); delusion+urge (poster test);
  we-need-to-talk (arrangement held); 'k'-after-paragraph (allusion);
  sunglasses-finsta (metaphor recovery); "finally someone who gets it" +
  camping-sundress (context recovery); "not looking for anything serious"
  (referent ledger); hard-launch vs wanted-the-label (speaker agency).

### S8 — watched-scene read
- P1; P3 antagonist-world entity list (its own labeled line: "HIS-WORLD
  ENTITIES: ..."); coherence rule keeps P3's "one story" requirement.
- P12 pairs: starfish-roommate (non-humanoid cap); drawn-men-crying (drawn ≠
  capped); man-pouring-a-drink (literal action); ex+new-girl on a
  different-kind core (same-kind cap); secondary example "the boys closing
  ranks after he got caught liking her photos".

### S9 — moments, watched_scene
- P1; register line names P3 entities and the rule "EVERY moment must name
  what he did or what it costs her"; P8 in full, INCLUDING the secret-card /
  last-laugh rule (this sub-rule exists only in S9).
- P12 pairs: as S6, plus hoodie-at-trivia-night pair (secret card).

### S10 — captions, watched_scene
- Same consumption as S7 minus `at_her_expense` (the at-her-expense burden
  lives in the register grammar + S9 instead). All S7-style pairs recur.

### S11 — internal read
- P1; P5 force canon + state stamps; P9 gender dock (avatar framing).
- P12 pairs: soldiers/self-respect vs "all my defense mechanisms"
  (cardinality); me-at-2am vs me+my-delusion (kind selector); secondary
  example "the 3am window where one notification decides my whole night".

### S12 — moments, internal
- P1; P5 (force canon test + "All the reasons I shouldn't text him" clause
  counter-example); me-side string test examples ("Me accepting one 'wyd'
  from him like it's a formal apology" / "me at 2am celebrating the plan me
  at 9pm already vetoed"); P8.

### S13 — captions, internal
- Same as S10 plus the evidence-ledger machinery (caption_span, analog split,
  context_to_caption) — all persona-free, but its examples are sad-girl
  ("my self respect" collapsed figure, unblock-for-a-thirst-trap,
  finsta-search). Regenerate content, keep rules.

### S16 — selection
- One WRONG example caption ("i keep texting first", overall 0.72) — swap the
  content when porting; everything else persona-free.

---

## 4. Porting procedure

1. Fill P1–P11 for the candidate persona. If P3 or P5 won't fill (no coherent
   antagonist world, no recognizable force canon), stop — wrong persona for
   this chain.
2. Duplicate 1546 (`node scripts/duplicate-flavor.mjs --source 1546 --slug <new>`).
3. In S5–S13 + S16: swap the pack fields AND regenerate every P12 example pair
   in the new world, in the same edit (CLAUDE.md rule: stale examples override
   new rules). The WRONG/RIGHT structure and the rule each pair demonstrates
   stay identical — only the story changes.
4. Leave S1–S4, S14, S15 untouched.

### Schema sanity check (existence proof, not a proposal)
"Burnt-out grad student" fills the pack: P2 = my labmates, my cohort, the
group chat; P3 = my advisor, the committee, Reviewer 2, the funding agency
(one coherent story, costs her); P4 = my advisor ("me and my advisor"); P5 =
my imposter syndrome, my last brain cell, my urge to check email, my sunk
cost ("me at 2am" / "me during week 6 of 'almost done'"); P8 hidden win =
"my advisor still calls the draft 'promising'". The topology holds, so the
schema is fillable by personas other than the sad girl.
