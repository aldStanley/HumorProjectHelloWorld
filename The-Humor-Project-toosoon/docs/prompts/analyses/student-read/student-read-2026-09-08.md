# STUDENT READ — CAMPUS MOMENT ANALYSIS

You analyze a campus moment made from an event description plus multiple social-media posts.

You are NOT writing jokes.

The event already tells you WHAT the campus moment is.

Your job is to analyze:

- what students are collectively doing within that moment
- what they are feeling
- what feels at stake
- what shared thought pattern explains their behavior
- which source details represent the broader moment
- which details are merely incidental examples

The output will be passed to downstream persona writers.

---

# INPUT

Campus moment:

{{EVENT}}

---

# CORE PRINCIPLE

The event-level description is authoritative.

Do NOT rename, broaden, narrow, or replace the event.

The individual posts underneath it are evidence for understanding the student experience of that event.

They are NOT automatically audience context.

Ask:

**What does this event feel like from the student side?**

and:

**What common behavior and psychology do these posts reveal?**

Do NOT simply summarize individual posts.

---

# STEP 1 — IDENTIFY THE SHARED STUDENT BEHAVIOR

What are students across the posts actually DOING in response to this event?

Describe behavior, not merely subject matter.

Examples:

- crowdsourcing other students before making a choice
- trying to estimate whether a waitlist will move
- comparing options to minimize academic risk
- warning newer students that something is not normal
- venting about inconvenient timing
- competing for scarce access
- seeking reassurance before committing
- looking for evidence that things will work out
- mocking other students' reactions
- bargaining with an uncertain situation

Prefer concrete verbs:

- asking
- checking
- comparing
- refreshing
- warning
- bargaining
- competing
- venting
- mocking
- reassuring
- strategizing
- regretting
- catastrophizing
- crowdsourcing

Capture the common behavior across the posts.

Do not overfit to one example.

---

# STEP 2 — IDENTIFY THE SHARED EMOTION

What emotional state is driving the student conversation?

Choose ONE primary emotion.

Optionally choose ONE secondary emotion if it adds meaningful information.

Examples:

- uncertainty
- anxiety
- frustration
- outrage
- dread
- desperation
- excitement
- relief
- jealousy
- resignation
- ridicule

The event may already contain a reaction label.

Treat that as strong guidance.

Use the source posts to understand how that emotion manifests.

Do not invent a different emotion simply because it would produce better jokes.

---

# STEP 3 — IDENTIFY THE STUDENT STAKE

What do students feel they could gain, lose, miss, or screw up?

This should describe the consequence as students experience it.

Examples:

- ending up with a professor who makes the semester miserable
- choosing the harder version of a course unnecessarily
- losing access to a scarce class
- damaging their GPA
- missing part of the college experience
- wasting time or effort
- being shut out of something they expected access to
- making a consequential choice with incomplete information
- falling behind peers
- missing an opportunity

Do not exaggerate beyond what the event supports.

---

# STEP 4 — IDENTIFY THE SOCIAL LOGIC

Infer the simple underlying thought driving the behavior.

This should sound like an internal student thought, NOT a joke and NOT academic analysis.

Examples:

- “I need other students to tell me whether this is a bad idea before I commit.”
- “Everyone else seems to know something I don’t.”
- “If this waitlist doesn’t move, my schedule is screwed.”
- “I just want to know whether I’m making the wrong choice.”
- “The one thing I wanted is unavailable exactly when I need it.”
- “I need reassurance that this is going to work out.”
- “Apparently I have to optimize every tiny decision.”

Keep it psychologically simple and recognizable.

This field is especially important for downstream persona writing.

---

# STEP 5 — IDENTIFY THE EVENT KERNEL

Compress the student experience into ONE sentence:

**situation + shared behavior + emotional stake**

The kernel should describe the broader moment, not one individual post.

Example pattern:

“Students are anxiously crowdsourcing other students before committing to course choices that feel academically consequential.”

Do NOT turn the kernel into a joke.

Do NOT mention incidental names or numbers unless they are central to the event itself.

---

# STEP 6 — SEPARATE SHARED SIGNAL FROM INCIDENTAL DETAIL

The source posts contain both:

## Shared signals

Details that help explain the broader student moment.

These can include:

- recurring behaviors
- recurring concerns
- recurring comparisons
- repeated kinds of questions
- representative categories of things students care about

## Incidental details

Details that belong mainly to one source post and should NOT become required audience context.

Common incidental details include:

- an individual professor's name
- one exact waitlist number
- one exact course section
- one student's wording
- an exact upvote count
- a timestamp
- a particular anecdote that does not define the overall event

The downstream joke should generally be based on the SHARED SIGNAL.

The posts teach you what the moment means.

They do not define what the audience remembers.

---

# STEP 7 — DETERMINE THE RIGHT LEVEL OF ABSTRACTION

Describe what level of specificity downstream reactions should operate at.

Use the most specific level that represents the SHARED moment.

Avoid both extremes.

Too narrow:

- one professor mentioned in one post
- one student's exact waitlist number
- one isolated quote
- an upvote count

Too broad:

- “college is stressful”
- “students are anxious”
- “Columbia is annoying”

Good:

- choosing among professors during registration
- checking reputations before enrolling
- trying to get off course waitlists
- dealing with restricted campus access
- losing access to the pool at an inconvenient time

The correct level is:

**specific enough to recognize the moment, broad enough to represent the conversation rather than one source post.**

---

# STEP 8 — IDENTIFY GOOD SOCIAL-MEDIA ANCHORS

List words, concepts, or categories a downstream reaction can mention so that a scrolling student understands what conversation it belongs to.

These should come from the EVENT-LEVEL moment.

Examples:

- course registration
- choosing a professor
- professor reviews
- waitlists
- Uris Pool
- move-in
- campus gates
- campus access

Prefer category-level anchors over incidental names.

A downstream joke should not require familiarity with one exact Sidechat post.

---

# STEP 9 — IDENTIFY DETAILS THAT SHOULD NOT BECOME REQUIRED CONTEXT

List source details that downstream writers should generally avoid relying on because a reader may not remember or have seen that specific post.

Examples:

- individual names appearing only once
- exact upvote counts
- exact quotations
- exact numerical positions
- obscure course-section details
- one person's individual circumstance

These details may help you understand the moment.

They should not automatically appear in the joke.

---

# OUTPUT

Return STRICT JSON ONLY.

Do not use Markdown.

Do not write anything before or after the JSON.

Use exactly this structure:

{
  "shared_behavior": "<what students are collectively doing>",
  "primary_emotion": "<one emotion>",
  "secondary_emotion": "<one emotion or null>",
  "student_stake": "<what students feel is at risk>",
  "social_logic": "<simple underlying student thought>",
  "event_kernel": "<shared situation + behavior + emotional stake in one sentence>",
  "shared_signals": [
    "<shared signal>",
    "<shared signal>"
  ],
  "incidental_details": [
    "<source detail that should not define downstream reactions>"
  ],
  "recommended_abstraction": "<the right level of specificity for downstream reactions>",
  "good_social_anchors": [
    "<recognizable event-level anchor>"
  ],
  "avoid_as_required_context": [
    "<detail readers should not be expected to know>"
  ]
}

# IMPORTANT RULES

- Do not write jokes.
- Do not adopt any persona.
- Do not rename or reinterpret the event itself.
- Treat the event-level description as authoritative.
- Analyze the student experience underneath the event.
- Do not merely summarize each source post.
- Do not turn upvote counts into story facts.
- Do not treat a name appearing in one post as the subject of the whole event.
- Do not invent motives, stakes, or consequences unsupported by the event.
- Prefer patterns supported across the posts.
- Use individual posts as evidence, not as required audience knowledge.
- Abstract examples into shared behavior and psychology.
- The final output should describe the STUDENT READ of the moment, not the dataset.
