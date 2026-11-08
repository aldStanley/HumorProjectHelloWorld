# Sidechat Event Clusters — design rationale

Parallel rationale page for `/sidechat-events`. Everything that guided the
layout lives here, not in the component.

## Who comes here, and what for

**A humor researcher comes to this page to see which specific campus
happenings Columbia students posted about in the last few days, so she can
pick the moments worth writing jokes about.**

She asked for this on 2026-09-04 after a terminal run of the same clustering
("this is great! I want to create a tool for this in its own page"). The
existing `/sidechat-topics` page already clusters posts but is built around
comparing the feed with the Student Brain's topics; this page is the
read-the-week view on its own, linked from the "Pick a tool" menu.

## Where the data and the clustering come from

- Posts: the live Student Brain feed (`GET /v1/sidechat-posts`), via
  `getStudentBrainSidechatPosts` in `src/utils/student-brain.ts`. toosoon's
  own `sidechat_posts` mirror stopped refreshing in June 2026 and is not used.
- Clustering: the three-pass pipeline in
  `src/app/sidechat-topics/event-clustering.ts` (name the event behind each
  post → merge only same-event names → force-split any title that reads as a
  list), reached through `clusterEventsAction`. `scripts/sidechat-cluster.mjs`
  runs the identical code from the terminal.
- Saved clusterings: the same `sidechat_clusterings` table and actions as
  `/sidechat-topics`, so a clustering saved on either page opens on both.

## Conceptual groups, and the sub-goal each serves

Two numbered cards, in the order the work happens.

1. **"Fetch the recent posts and cluster them by event"** — *sub-goal: get a
   clustering on screen.* Days-back selector, one big left-aligned run
   button, and the list of archived clusterings to open instead. Every
   fresh run is archived automatically (Lydia, 2026-09-04: "archive these
   clusterings so I can just load one from previous"). Cost is stated up
   front (about 650 posts and two to three minutes for 7 days) because the
   run is not free.
2. **"Read the events"** — *sub-goal: find the moments worth joking about.*
   Four sections in order of usefulness to her:
   - **What this clustering covers** — window, counts, and what the numbers
     mean, so the page explains itself cold.
   - **Events students posted about more than once** — the shared moments,
     ranked by total upvotes, every post shown. This is the payload.
   - **Events named by a single post** — plausible events with one post,
     shown compactly and flagged as possibly over-read by the model.
   - **Posts with no shared event behind them** — the one-offs; the top 40
     visible, the rest behind a "show the remaining N" button.

## What was made important, and how

- The event title is the judged thing: the largest text in each item.
- A rank numeral in the left gutter anchors each item so repeated items do
  not look identical; item gaps are much larger than line gaps.
- Upvote counts are bold tabular figures in a fixed column; dates are the
  quiet part.
- Color is used only for links, the run button, and the active nav entry.
  Importance is carried by size, weight, and whitespace.

## Navigation

The results run to many screens, so section 2 has a sticky nested sidebar
generated from the result:

- Top level: the four sections, each with a status ("41 events · 180 posts").
- Second level: every event under its section, with "posts · upvotes".
- The shared-events branch starts open; the single-post branch (often 100+
  entries) starts closed.
- The chevron alone toggles a branch. Clicking a label navigates and opens
  its branch. The scrollspy opens a branch only when the section being read
  changes, so a manual collapse sticks while scrolling.
- Every target has `scroll-mt-6`; the sidebar is hidden below the `lg`
  breakpoint where the page is one column.

## Reaction groups inside an event

An event like "Fall course registration opened" can hold 120+ posts, and a
flat list hides what students are actually going through. Stage 4 of the
clusterer partitions any event with six or more posts by the *reaction* the
poster is having — the feeling or the move, never the subject. The test the
prompt runs: would the writer of one post nod at the other for the same
reason? "Piechnik or de Silva for calc 3?" and "Alonso or Xavier for macro?"
belong together (shopping for the easier professor); "calc 3 waitlist
movement?" does not join them despite sharing the course (dread, not
shopping).

Each group is named to complete "students are ..." and carries a one- or
two-word reaction label. Mechanical rules do what prose cannot: every post is
placed exactly once, groups under two posts or named like a subject
("Calc 3 posts") fold into a trailing "Other reactions" group, and if fewer
than two real groups survive the event stays flat. The pass is best-effort —
a failed call leaves that one event flat instead of failing a multi-minute
run — and rides in the archived payload as an optional field, so older
archives still open and simply show events without reaction groups.

## Open questions

- Should single-post "events" count as events at all, or fold into one-offs?
- Should this page replace `/sidechat-topics` in the side menu, or stay
  alongside it? (Currently alongside: this page is in "Pick a tool", the
  older one stays under "Other tools".)
