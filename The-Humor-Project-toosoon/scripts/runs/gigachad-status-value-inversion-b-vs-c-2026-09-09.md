# b vs c: status_value_inversion on 4 moments

| | b | c |
|---|---|---|
| generated | 32 | 32 |
| excellent | 8 | 8 |
| strong | 8 | 8 |
| possible | 6 | 8 |
| reject | 10 | 8 |
| survivors | 8 | 8 |
| flag technically_valid_but_not_funny | 8 | 7 |
| flag generic_dominance | 3 | 2 |
| flag unclear_scene | 1 | 4 |
| flag duplicate_premise | 2 | 2 |
| flag insufficient_status_inversion | 2 | 0 |
| flag mechanical_role_swap | 1 | 1 |
| flag abstract_value_assertion | 0 | 2 |
| flag event_misread | 1 | 0 |
| flag weak_relatable_base | 1 | 0 |
| status_consequence concrete_event_native | 0 | 30 |
| status_consequence abstract_value_assertion | 0 | 2 |

Generators: b docs/prompts/engines/gigachad-power-reversal/generator/gigachad-power-reversal-2026-09-09b.md; c docs/prompts/engines/gigachad-power-reversal/generator/gigachad-power-reversal-2026-09-09c.md
Evaluators: b docs/prompts/engines/gigachad-power-reversal/evaluator/gigachad-power-reversal-evaluator-2026-09-09b.md; c docs/prompts/engines/gigachad-power-reversal/evaluator/gigachad-power-reversal-evaluator-2026-09-09c.md

## Moment 1: Fall classes start late this year

### b

**KEEP · EXCELLENT** — Before classes start September 9, I sit in my room. Classrooms envy it.
- event_truth: Students can spend the unscheduled week in their rooms instead of attending classes.
- status_axis: Dorm rooms feel confining while classrooms represent the campus life students await.
- gigachad_flip: His presence makes his room more desirable than the classrooms awaiting him.
- flags: none

**KEEP · EXCELLENT** — Campus is a ghost town until classes start. Empty quads get unobstructed views of me.
- event_truth: Campus is sparsely populated before classes start.
- status_axis: An empty campus offers students fewer people and sights than a lively campus.
- gigachad_flip: His appearance is so valuable that empty quads become fortunate spectators.
- flags: none

**STRONG** — The week before classes is boring. Boredom has seven days to impress me.
- event_truth: Students feel bored and restless during the week before classes.
- status_axis: Boredom lowers the value of free time and leaves students wanting relief.
- gigachad_flip: His approval is so valuable that boredom must impress him instead.
- flags: none

**STRONG** — Move-in precedes classes by a week. That week receives a private audience with me.
- event_truth: Move-in occurs a full week before classes begin.
- status_axis: Students endure the empty week while waiting for classes to give their time structure.
- gigachad_flip: The empty week becomes privileged because it receives private access to him.
- flags: none

**POSSIBLE** — Orientation icebreakers run all week before lectures. Each competes for my attention.
- event_truth: Orientation icebreakers take place throughout the week before lectures begin.
- status_axis: Orientation activities receive and direct students' attention during the opening week.
- gigachad_flip: His attention is so scarce that the icebreakers compete to receive it.
- flags: none

**POSSIBLE** — Classes begin September 9. My arrival validates the academic calendar.
- event_truth: Fall classes begin on September 9, one week after move-in.
- status_axis: The academic calendar sets the date students must accept and plan around.
- gigachad_flip: His arrival is so authoritative that it validates the academic calendar instead.
- flags: none

**REJECT** — Syllabus week begins September 9. My attendance is its main event.
- event_truth: Syllabus week begins when classes start on September 9.
- status_axis: Students treat syllabus week as the anticipated event ending the empty wait.
- gigachad_flip: His attendance becomes more important than syllabus week itself.
- flags: generic_dominance, technically_valid_but_not_funny

**REJECT** — The first lecture begins September 9. Every seat wants the prestige of holding me.
- event_truth: The first lectures begin on September 9 after the week-long gap.
- status_axis: Students normally evaluate lecture seats by the value each seat offers them.
- gigachad_flip: His occupancy is so prestigious that every seat desires the status of holding him.
- flags: event_misread, weak_relatable_base

### c

**KEEP · EXCELLENT** — The empty week after move-in cannot afford to waste my time.
- event_truth: Students have an unscheduled week between move-in and the start of classes.
- status_axis: The empty week consumes students' time without providing anything they value.
- gigachad_flip: His time is too valuable for the empty week to waste.
- event_native_consequence: The week cannot afford the cost of wasting his time.
- status_consequence: concrete_event_native
- flags: none

**KEEP · EXCELLENT** — Campus stays empty until classes start. Late arrivals forfeit seven days with me.
- event_truth: Campus stays mostly empty until classes begin.
- status_axis: Students who arrive early endure the empty campus while later arrivals avoid it.
- gigachad_flip: His presence makes arriving later the undesirable choice.
- event_native_consequence: Late arrivals lose seven days in his presence.
- status_consequence: concrete_event_native
- flags: none

**STRONG** — Classes leave my calendar blank until September 9. Every date bids for me.
- event_truth: Students have blank calendars until classes begin on September 9.
- status_axis: Students ordinarily seek activities to fill unwanted open dates.
- gigachad_flip: His open time is so scarce that the dates compete to receive it.
- event_native_consequence: Each blank date bids for a place on his calendar.
- status_consequence: concrete_event_native
- flags: none

**STRONG** — Orientation runs a week of icebreakers. Mine becomes the only name remembered.
- event_truth: Orientation icebreakers run during the week before lectures.
- status_axis: Students introduce themselves hoping other students will remember them.
- gigachad_flip: His introduction makes every other introduction forgettable.
- event_native_consequence: His is the only name students remember from the icebreakers.
- status_consequence: concrete_event_native
- flags: none

**POSSIBLE** — Classes start September 9 with me. Holidays compete for second place.
- event_truth: Classes begin on September 9, and students anticipate the date like a holiday.
- status_axis: Holidays ordinarily outrank class days as dates students eagerly anticipate.
- gigachad_flip: His presence makes the first day of classes more desirable than any holiday.
- event_native_consequence: Holidays fall to second place in the ranking of anticipated dates.
- status_consequence: concrete_event_native
- flags: none

**POSSIBLE** — Orientation fills the empty week with icebreakers. Every group saves its final seat for me.
- event_truth: Orientation fills the week before classes with group icebreakers.
- status_axis: Students ordinarily hope to secure a place in a desirable orientation group.
- gigachad_flip: The groups compete for the chance to include him.
- event_native_consequence: Every orientation group reserves its final seat for him.
- status_consequence: concrete_event_native
- flags: none

**REJECT** — Students sit in dorm rooms all week. Mine becomes campus's most coveted room.
- event_truth: Students spend much of the empty week sitting in their dorm rooms.
- status_axis: A dorm room's features ordinarily determine whether students find it desirable.
- gigachad_flip: His occupancy becomes the feature that makes one room uniquely desirable.
- event_native_consequence: His dorm room rises to the top of campus demand.
- status_consequence: abstract_value_assertion
- flags: abstract_value_assertion, generic_dominance, technically_valid_but_not_funny

**REJECT** — Classes start September 9. My first lecture wins the opening day.
- event_truth: The first lectures take place when classes begin on September 9.
- status_axis: Students ordinarily judge whether the first lecture is worth attending.
- gigachad_flip: The lecture that receives his attendance becomes the fortunate one.
- event_native_consequence: His first lecture wins the opening day.
- status_consequence: abstract_value_assertion
- flags: abstract_value_assertion, unclear_scene, technically_valid_but_not_funny

## Moment 2: Dorm room views

### b

**KEEP · EXCELLENT** — A dorm window facing bricks is not a bad view. The bricks see me.
- event_truth: Some dorm windows face a brick wall only a few feet away.
- status_axis: Students normally receive value from whatever view lies outside the window.
- gigachad_flip: His presence becomes the valuable view, making the bricks the fortunate viewers.
- flags: none

**KEEP · EXCELLENT** — A brick wall blocks sunlight from my dorm. The sun lacks access to me.
- event_truth: A nearby brick wall can block sunlight from a dorm room.
- status_axis: Students value sunlight entering the room as a benefit they hope to receive.
- gigachad_flip: Sunlight is denied the privilege of reaching him.
- flags: none

**STRONG** — Housing assigned me a brick-facing dorm room. The room won.
- event_truth: Housing assignments can place students in dorm rooms with brick-facing windows.
- status_axis: Students judge an assignment as lucky or unlucky according to the room's quality.
- gigachad_flip: The room becomes the winner simply by ending up with him as its resident.
- flags: none

**STRONG** — My dorm window faces a nearby wall. The wall has the better neighbor.
- event_truth: Some dorm windows sit only a short distance from neighboring brick walls.
- status_axis: Students normally judge a nearby wall as an undesirable neighbor because it ruins the view.
- gigachad_flip: His proximity is so valuable that the wall gains the superior neighbor.
- flags: none

**POSSIBLE** — Students pay thousands for dorm rooms facing brick. Mine remains underpriced.
- event_truth: Students pay thousands of dollars for dorm rooms whose windows face brick.
- status_axis: A room's view helps students judge whether its housing cost is worthwhile.
- gigachad_flip: His occupancy adds so much value that the brick-facing room remains underpriced.
- flags: none

**POSSIBLE** — A brick-facing dorm window hides the time of day. Noon awaits my recognition.
- event_truth: Brick-facing windows can make natural daylight cues hard to see.
- status_axis: Students rely on daylight cues to recognize the time of day.
- gigachad_flip: His recognition becomes the status that noon must wait to receive.
- flags: none

**REJECT** — Brick-facing windows lower a dorm's appeal. My presence gives the building prestige.
- event_truth: Brick-facing windows make dorm rooms less appealing to many students.
- status_axis: The building's features normally determine how desirable a student's room feels.
- gigachad_flip: His presence confers prestige on the entire building despite the poor view.
- flags: generic_dominance, technically_valid_but_not_funny

**REJECT** — My dorm window faces blank brick. The wall has secured my attention.
- event_truth: A student looking through a brick-facing dorm window sees mostly blank wall.
- status_axis: The student normally decides whether the outside scene deserves visual attention.
- gigachad_flip: His attention is so valuable that the blank wall gains status by receiving it.
- flags: insufficient_status_inversion, technically_valid_but_not_funny

### c

**KEEP · EXCELLENT** — My dorm window faces a brick wall. The wall received the view.
- event_truth: Some dorm windows face brick walls instead of an open view.
- status_axis: The student normally receives either a desirable or undesirable view through the window.
- gigachad_flip: His appearance is so valuable that the brick wall becomes the fortunate viewer.
- event_native_consequence: The brick wall receives the desirable view.
- status_consequence: concrete_event_native
- flags: none

**KEEP · EXCELLENT** — Housing assigned me a brick-facing dorm room. The room won.
- event_truth: Housing assigns some students to brick-facing dorm rooms.
- status_axis: Students normally judge whether they were fortunate in their room assignments.
- gigachad_flip: His tenancy is so valuable that the assigned room becomes the fortunate party.
- event_native_consequence: The brick-facing room wins the housing assignment.
- status_consequence: concrete_event_native
- flags: none

**STRONG** — My dorm gets zero sunlight. Daylight wastes those hours without me.
- event_truth: Brick-facing dorm rooms can receive no direct sunlight for hours.
- status_axis: Students normally lose valuable daylight when sunlight cannot reach their rooms.
- gigachad_flip: His time is so valuable that daylight suffers the wasted hours instead.
- event_native_consequence: Daylight loses hours without access to him.
- status_consequence: concrete_event_native
- flags: none

**STRONG** — Students pay thousands for brick-facing dorm rooms. Mine remains underpriced.
- event_truth: Students pay thousands of dollars for dorm rooms facing brick walls.
- status_axis: A high price normally makes a brick-facing room feel like poor value.
- gigachad_flip: His occupancy adds more value than the housing price accounts for.
- event_native_consequence: His brick-facing room becomes underpriced.
- status_consequence: concrete_event_native
- flags: none

**POSSIBLE** — A brick wall blocks my skyline view. The skyline cannot see me.
- event_truth: A brick wall outside a dorm window can block the skyline.
- status_axis: The student normally loses the desirable skyline view when a wall blocks it.
- gigachad_flip: His visibility is more desirable than the skyline, making the skyline the deprived viewer.
- event_native_consequence: The skyline loses its view of him.
- status_consequence: concrete_event_native
- flags: duplicate_premise

**POSSIBLE** — A brick wall stands feet from my window. It secured the closest position.
- event_truth: Some brick walls stand only a few feet from dorm windows.
- status_axis: A wall extremely close to a window normally makes the room less desirable.
- gigachad_flip: Proximity to him is so scarce that the nearby wall holds the best position.
- event_native_consequence: The wall ranks closest to him.
- status_consequence: concrete_event_native
- flags: none

**REJECT** — A brick wall fills my entire dorm window. It monopolizes my gaze.
- event_truth: A nearby brick wall can fill the view from a dorm window.
- status_axis: The wall normally monopolizes the student's limited view in an undesirable way.
- gigachad_flip: His gaze is so valuable that monopolizing it becomes the wall's advantage.
- event_native_consequence: The wall receives his entire outward gaze.
- status_consequence: concrete_event_native
- flags: technically_valid_but_not_funny

**REJECT** — Brick-facing windows hide the time of day. Noon passes unrecognized by me.
- event_truth: Brick-facing windows can make the time of day difficult to recognize.
- status_axis: Students normally lose useful information when they cannot recognize the time outside.
- gigachad_flip: His recognition is so valuable that noon becomes the overlooked party.
- event_native_consequence: Noon passes without being recognized by him.
- status_consequence: concrete_event_native
- flags: technically_valid_but_not_funny

## Moment 3: Course registration

### b

**KEEP · EXCELLENT** — I do not check Rate My Professor. My enrollment raises professors' ratings.
- event_truth: Students check Rate My Professor before deciding whether to enroll in a professor's section.
- status_axis: A professor's rating influences whether students consider the professor worth taking.
- gigachad_flip: His enrollment is so prestigious that it raises the professor's rating.
- flags: none

**KEEP · EXCELLENT** — Students compare course sections. Sections compare their chances of receiving me.
- event_truth: Students compare course sections before enrolling.
- status_axis: Students are the selectors, while course sections are the available options.
- gigachad_flip: His enrollment is such a prize that sections assess their chances of receiving him.
- flags: none

**STRONG** — Professor reviews consume hours. Professors earn seconds of my attention.
- event_truth: Students can spend hours reading professor reviews before choosing a section.
- status_axis: Students devote scarce time and attention to deciding whether professors are worth taking.
- gigachad_flip: His attention is so valuable that professors are fortunate to receive mere seconds.
- flags: none

**STRONG** — Professor reviews help students avoid regret. Professors regret the semester without me.
- event_truth: Students read professor reviews to avoid regretting their section choice.
- status_axis: Students ordinarily bear the risk of losing a semester to an undesirable professor.
- gigachad_flip: Not teaching him becomes the regrettable semester outcome for the professor.
- flags: none

**POSSIBLE** — Poor professor reviews deter students. My presence makes every seat desirable.
- event_truth: Poor professor reviews can discourage students from choosing a section.
- status_axis: Negative reviews ordinarily reduce a section's desirability among prospective students.
- gigachad_flip: His presence is so desirable that every seat near him gains value.
- flags: none

**REJECT** — CULPA reviews contradict each other. Agreement with me makes one review credible.
- event_truth: CULPA reviews of course sections can contradict one another.
- status_axis: Readers decide which conflicting reviews deserve credibility and influence their choices.
- gigachad_flip: His agreement alone grants credibility to one of the conflicting reviews.
- flags: technically_valid_but_not_funny

**REJECT** — Students compare course sections in spreadsheets. Every ranking defers to mine.
- event_truth: Students use spreadsheets to compare course sections.
- status_axis: Spreadsheet rankings help students judge which sections are most desirable.
- gigachad_flip: His ranking becomes the standard to which every other ranking defers.
- flags: generic_dominance, technically_valid_but_not_funny

**REJECT** — Students check CULPA and Rate My Professor. My click makes one source authoritative.
- event_truth: Students check both CULPA and Rate My Professor before enrolling.
- status_axis: Student trust and attention determine which review source carries greater authority.
- gigachad_flip: His single click grants one review source decisive authority.
- flags: duplicate_premise, technically_valid_but_not_funny

### c

**KEEP · EXCELLENT** — I do not check Rate My Professor. My enrollment raises the professor's rating.
- event_truth: Students check Rate My Professor before deciding whether to enroll with a professor.
- status_axis: A professor's rating influences whether students consider the professor worth taking.
- gigachad_flip: His enrollment is so valuable that it improves the professor's standing.
- event_native_consequence: The professor's rating rises.
- status_consequence: concrete_event_native
- flags: none

**KEEP · EXCELLENT** — Students compare sections. Sections compare their chances of receiving me.
- event_truth: Students compare sections before choosing where to enroll.
- status_axis: Students are ordinarily the scarce selectors while sections are competing options.
- gigachad_flip: His enrollment is so desirable that the sections compete over their odds of receiving it.
- event_native_consequence: The sections compare their chances of receiving him.
- status_consequence: concrete_event_native
- flags: none

**STRONG** — Dorm spreadsheets compare sections. My choice removes every other row.
- event_truth: Students use spreadsheets to compare course sections.
- status_axis: Sections remain competing options until students finish comparing them.
- gigachad_flip: His choice is so authoritative that every unchosen option becomes unnecessary.
- event_native_consequence: The other section rows are removed from the spreadsheet.
- status_consequence: concrete_event_native
- flags: none

**STRONG** — CULPA reviews contradict each other. My enrollment makes one of them correct.
- event_truth: CULPA reviews for the same course can contradict one another.
- status_axis: Students judge which review gives the more reliable account of a section.
- gigachad_flip: His enrollment is treated as definitive proof that one review was right.
- event_native_consequence: One contradictory review becomes the correct one.
- status_consequence: concrete_event_native
- flags: none

**POSSIBLE** — Conflicting professor reviews delay enrollment. My choice ends the hesitation.
- event_truth: Conflicting professor reviews can make students delay enrollment.
- status_axis: Students wait for enough evidence before committing to a section.
- gigachad_flip: His decision is so valuable that other students no longer require certainty from reviews.
- event_native_consequence: Students stop hesitating and proceed with enrollment.
- status_consequence: concrete_event_native
- flags: none

**POSSIBLE** — Professor reviews waste three hours. Mine is beyond their budget.
- event_truth: Students can spend three hours reading professor reviews before choosing a section.
- status_axis: Students normally sacrifice their time to reduce uncertainty about professors.
- gigachad_flip: His time is too valuable for professor reviews to consume at the usual rate.
- event_native_consequence: The reviews receive none of the three hours.
- status_consequence: concrete_event_native
- flags: unclear_scene

**REJECT** — Professor ratings guide enrollment. The section I choose fills first.
- event_truth: Professor ratings influence which sections students enter.
- status_axis: Highly rated sections ordinarily attract students and fill more quickly.
- gigachad_flip: His choice becomes more desirable to follow than any professor rating.
- event_native_consequence: The section he chooses fills first.
- status_consequence: concrete_event_native
- flags: duplicate_premise, technically_valid_but_not_funny

**REJECT** — CULPA and Rate My Professor offer reviews. My choice decides which site keeps readers.
- event_truth: Students consult both CULPA and Rate My Professor before enrolling.
- status_axis: Review sites compete to remain useful sources for students choosing professors.
- gigachad_flip: His choice becomes the standard that determines which review source remains useful.
- event_native_consequence: Only the site aligned with his choice keeps its readers.
- status_consequence: concrete_event_native
- flags: unclear_scene, technically_valid_but_not_funny

## Moment 4: Vergil's course search is broken during registration

### b

**KEEP · EXCELLENT** — Vergil wastes time on failed searches. Mine is beyond its budget.
- event_truth: Failed Vergil searches waste students' time during registration.
- status_axis: Students ordinarily bear the time cost of adapting to a broken search tool.
- gigachad_flip: His time becomes so valuable that Vergil cannot afford the time it wastes.
- flags: none

**KEEP · EXCELLENT** — Vergil demands exact course names. The courses have mine memorized.
- event_truth: Vergil requires students to enter exact course names to get useful search results.
- status_axis: Students must know a course's identity before gaining access to its listing.
- gigachad_flip: His identity is so valuable that the courses memorize his name instead.
- flags: none

**STRONG** — Vergil leaves wanted classes undiscovered. They lose the chance to receive me.
- event_truth: Vergil's broken search leaves classes students want undiscovered.
- status_axis: Students normally lose access to desirable classes when search results fail.
- gigachad_flip: The undiscovered classes suffer because they lose the chance to receive his presence.
- flags: none

**STRONG** — Vergil's course search is broken. My use is its remaining prestige.
- event_truth: Vergil's course search remains broken while students use it for registration.
- status_axis: A search tool earns status by being useful to the students who use it.
- gigachad_flip: His patronage alone becomes the broken tool's remaining source of prestige.
- flags: none

**POSSIBLE** — Students complain about Vergil's broken search. My silence is its best review.
- event_truth: Students complain about Vergil's broken course search during registration.
- status_axis: Student criticism lowers the perceived quality and status of a campus tool.
- gigachad_flip: His mere refusal to criticize carries more status than every other student's judgment.
- flags: none

**REJECT** — Vergil cannot find the classes I want. My interest is their prestige.
- event_truth: Students cannot find classes they want when Vergil search fails.
- status_axis: Wanted classes hold value because students desire to find and take them.
- gigachad_flip: His interest becomes the source of a class's prestige rather than its appeal attracting him.
- flags: duplicate_premise

**REJECT** — Vergil returns nothing for inexact searches. My wording judges the catalog.
- event_truth: Vergil returns nothing when students use inexact course names.
- status_axis: The catalog's official wording determines whether a student's query is acceptable.
- gigachad_flip: His wording becomes the supreme standard, leaving the catalog subject to his judgment.
- flags: mechanical_role_swap, unclear_scene, technically_valid_but_not_funny

**REJECT** — An exact Vergil search returns classes. Each result competes for my attention.
- event_truth: Typing an exact course name into Vergil produces class results.
- status_axis: Returned classes receive a student's limited attention as possible choices.
- gigachad_flip: His attention becomes so scarce and valuable that every result competes for it.
- flags: insufficient_status_inversion, technically_valid_but_not_funny

### c

**KEEP · EXCELLENT** — Vergil returns classes only for exact names. They compare their chances of receiving me.
- event_truth: Vergil returns classes only when sufficiently exact course names are entered.
- status_axis: Students ordinarily evaluate returned classes as options worth selecting.
- gigachad_flip: His choice is so valuable that the returned classes become competitors for it.
- event_native_consequence: The displayed classes compare their chances of receiving his selection.
- status_consequence: concrete_event_native
- flags: none

**KEEP · EXCELLENT** — Vergil wastes students' time on failed searches. Mine is beyond its budget.
- event_truth: Failed searches on Vergil waste students' time during registration.
- status_axis: Students ordinarily bear the time cost when a course search fails.
- gigachad_flip: His time is so valuable that Vergil becomes the party unable to afford the failed search.
- event_native_consequence: The wasted search exceeds Vergil's budget for his time.
- status_consequence: concrete_event_native
- flags: none

**STRONG** — Vergil fails one course search. It does not receive another from me.
- event_truth: A failed Vergil search can force students to try searching again.
- status_axis: Students ordinarily repeat searches because finding their classes matters more than each attempt.
- gigachad_flip: His queries are so scarce that Vergil receives only one attempt to use one successfully.
- event_native_consequence: After one failed search, Vergil receives no second query from him.
- status_consequence: concrete_event_native
- flags: none

**STRONG** — Vergil requires full course titles. Only worthy classes receive my final keystroke.
- event_truth: Vergil requires every word of a full course title before returning useful results.
- status_axis: Students ordinarily complete exact titles because the classes are worth finding.
- gigachad_flip: His final keystroke is so valuable that only classes he judges worthy receive it.
- event_native_consequence: Only selected course titles are completed and submitted exactly.
- status_consequence: concrete_event_native
- flags: none

**POSSIBLE** — Classes hidden by Vergil lose first place when I cannot find them.
- event_truth: Vergil fails to reveal some classes that students want.
- status_axis: Wanted classes ordinarily retain high desirability even when they are difficult to find.
- gigachad_flip: His preference is so decisive that a class loses rank when it cannot reach his consideration.
- event_native_consequence: Classes hidden by the search lose first place in his course ranking.
- status_consequence: concrete_event_native
- flags: none

**POSSIBLE** — Vergil is worse than last year. This year still wins by processing my query.
- event_truth: Students consider Vergil's course search worse than it was last year.
- status_axis: Versions of a search tool are ordinarily compared by how well they help students.
- gigachad_flip: His query is so valuable that processing it outweighs this year's inferior performance.
- event_native_consequence: The worse version wins the year-to-year comparison.
- status_consequence: concrete_event_native
- flags: none

**REJECT** — Broken Vergil searches delay my registration. Campus postpones its most valuable enrollment.
- event_truth: Broken Vergil searches can delay a student's course registration.
- status_axis: Students ordinarily suffer when a search problem postpones their enrollment.
- gigachad_flip: His enrollment is so valuable that the campus becomes the party suffering from the delay.
- event_native_consequence: The campus must wait longer for his enrollment.
- status_consequence: concrete_event_native
- flags: technically_valid_but_not_funny, generic_dominance

**REJECT** — Vergil demands the exact course name. The courses have mine memorized.
- event_truth: Vergil requires students to type the exact course name.
- status_axis: Students ordinarily need to know course names to gain access to search results.
- gigachad_flip: His name is so important that the courses are expected to know it exactly.
- event_native_consequence: The courses, rather than only the student, have an exact name memorized.
- status_consequence: concrete_event_native
- flags: mechanical_role_swap, unclear_scene
