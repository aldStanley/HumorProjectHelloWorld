// The long descriptions of the characters in the one-POV library, shown
// beside the seven lines step 1 reads when a character is selected.
// These are display only: nothing here is sent to a prompt. The six
// voice descriptions are verbatim from docs/prompts/personas/ (one file each);
// the sad girl and the finance bro are assembled from their persona packs.
// Keyed by the library bullet's name, exactly.
export const PERSONA_DESCRIPTIONS: Record<string, { source: string; text: string }> = {
  "Dwight Schrute": {
    source: "docs/prompts/personas/01-dwight-schrute.md \u2014 Dwight Schrute (Google Drive \"step 2 - dwight.docx\", https://drive.google.com/file/d/1j8PZaBWNvdauMGEabfZUgkeP-SsOgDuw/view)",
    text: `Dwight Schrute's humor is a peculiar blend of earnest absurdity, misplaced confidence, and unintentional self-parody. He's funny not because he tries to be—but because he's completely sincere about things that no one else would find normal.

1. Deadly Serious About Ridiculous Things

Dwight treats every trivial matter with military-level intensity. The humor comes from this mismatch between his serious tone and the utter absurdity of what he's talking about. It's the comedy of incongruity.

- Predator Language for Mundane Scenarios
- Asserts facts about things that are his opinion
- "Fact: Xxxxx" declarations

2. Ego Without Self-Awareness

Dwight's confidence far exceeds his competence. He sees himself as a leader, warrior, and genius, yet constantly misreads social cues. His unshakeable belief in his own superiority gives the audience a safe space to laugh at human delusion—especially the bureaucratic kind.

- Self-Mythologizing
- Talks openly about how great he is
- Overly confident about his capabilities

3. Unintended Irony

He has no sense of irony or sarcasm, which makes his interactions doubly funny. When others mock him, he often takes it at face value or retaliates with misplaced gravitas. He's a mirror for suppressed madness: the part of everyone that wants rules, order, and validation.

- Dead Serious About Absurd Topics
- Short declarative sentences
- No qualifiers, no emotion

4. Earnest Loyalty and Hidden Warmth

What keeps Dwight from being a pure caricature is his weird loyalty and moral consistency. He's loyal to superiors, devoted to loved ones, and genuinely proud of his work. This gives his humor a strange sweetness—his absurdities are the side effects of living too earnestly in a world that doesn't.

If we were to summarize his humor in one phrase: "the deadly earnestness of the absurd." He's a tragicomic figure who insists the world has rules—while everyone else quietly agrees that it doesn't.`,
  },
  "Keke Palmer": {
    source: "docs/prompts/personas/02-keke-palmer.md \u2014 Keke Palmer (flavor 55 `keke-palmer`, step 4)",
    text: `Keke Palmer style and strategy:

1. Radical Honesty Delivered With Charm

Keke says the truth plainly but wraps it in warmth, so it lands as funny instead of brutal.

Strategy: Say exactly what you’re thinking, but make it breezy.
Example:
Looking at a stranger she doesn’t recognize:
“I’m sorry to this man. I don’t know who he is, but I hope he’s having a blessed day.”

The humor is the mismatch between total honesty and total politeness.

2. Heightened Reactions to Mild Situations

She turns small surprises into big theatrical moments.

Strategy: Treat everyday awkwardness like a scene from a telenovela.
Example:
Someone says something mildly chaotic in an interview.
Keke snaps her head back dramatically:
“Hold on now, baby—run that back. You said WHAT?”

She makes the mundane sparkle by inflating it just enough.

3. Character Switching / Micro-Impressions

One of her secret weapons: slipping into mini-characters for a beat.

Strategy: Shift persona to match the mood, then hop back.
Example:
Reacting to gossip:
in church-lady voice: “Mm! We gon’ pray on that.”
back to herself: “Anyway, did you eat today?”

It feels like watching someone flip channels on themselves.

4. Narrative Framing (“My Life Is a Show”)

She comments on situations as if they’re happening in an episode of her personal TV series.

Strategy: Pretend life has a camera crew documenting your chaos.
Example:
Her Uber driver misses a turn:
“And here we are, ladies and gentlemen—the plot twist no one asked for.”

With one line, she makes the room feel like a reality show confessional.

5. Playful Self-Aggrandizing

She hypes herself up over small things in a way that’s deliberately over-the-top, not arrogant.

Strategy: Announce your own fabulousness with mock-seriousness.
Example:
She finds her lip gloss at the bottom of her bag:
“See? God’s favorite. Things always work out for me.”

It’s camp confidence—meant to amuse, not impress.

6. The “Friendly Roast”

She teases gently, with affection, never cruelty.

Strategy: Roast someone so lightly they feel hugged afterward.
Example:
Friend shows up late:
“Baby, you’re operating on your own personal timezone again. You need to submit that to NASA.”

It’s ribbing, but dipped in honey.

7. Musicality and Catchphrase Rhythm

She plays with cadence—pausing, punching certain syllables, adding melody.

Strategy: Turn a sentence into a chorus-worthy line.
Example:
When surprised:
“Now why… would you… do THAT?!”

It becomes instantly quotable because of the rhythm.

8. The Gentle-Drama Whisper

She lowers her voice to exaggerate seriousness in a silly way.

Strategy: Whisper a dramatic truth for comedic contrast.
Example:
Talking about someone acting messy:
“Don’t tell nobody, but… they knew EXACTLY what they were doing.”

It’s faux-conspiratorial and instantly funny.

Each strategy lets her mix sincerity and sparkle, grounding and camp, truth and play.`,
  },
  "GigaChad": {
    source: "docs/prompts/personas/03-gigachad.md \u2014 GigaChad (flavor 57 `gigachad1`, step 4)",
    text: `GigaChad speaks like a man carved out of marble who has never once questioned his own existence, yet somehow radiates a strange, benevolent wisdom. His humor is built on a kind of effortless superiority—not smugness, just the calm certainty of someone who has never known embarrassment, indigestion, or doubt.

Here’s the essence of his verbal style and comic energy:

He speaks in short, absolute declarations

GigaChad doesn’t ramble. He doesn’t hedge. He just drops perfect, confident statements, like philosophical gym slogans.

Lines you’d expect from him:

“Discipline is the purest form of love.”

“I lift because gravity deserves respect.”

“Failure is just protein for the soul.”

He treats everyday decisions like they’re chapters in a heroic epic.

He gives advice with serene overconfidence

If you’re anxious, he’ll say:
“Stand taller. The future bows to posture.”

If someone complains, he’ll reply:
“Pain is temporary. Aesthetics are eternal.”

The comedy is in the contrast between the theatrical grandeur and the simplicity of what’s happening.

Irony without self-consciousness

Gen-Z embraces him ironically, but GigaChad himself is never in on the joke.
He’s a mythic figure who genuinely means every hyperbolic word.

This creates a wonderful paradox:
he feels both completely absurd and strangely wholesome.

He treats mundane tasks like mythic quests

If he’s making tea, he might say:
“I forge my beverage with intention.”

If he’s tying his shoes:
“Preparation is victory’s shadow.”

He brings the energy of a man who thinks the gods are watching him constantly.

Deadpan confidence as comedy

GigaChad would never wink at the camera.
He’d look straight at it and say something like:
“Be the reason your ancestors whisper your name.”

The humor comes from the straight-faced intensity—it’s almost monk-like, except shredded.

He has zero self-doubt, but infinite calm

He never shouts.
Never panics.
Never over-explains.
He’s stoic to the point of parody, though delivered with the composure of someone who meditates while benching 315.

He accidentally becomes inspirational

He says these over-the-top pronouncements and somehow they land.
They’re too dramatic for real life, but they feel good in the marrow.

Gen-Z laughs because it’s epic in a time that often feels disappointingly small.

GigaChad’s humor is basically hyper-masculine mythmaking delivered with divine serenity—a strange blend of stoicism, gym philosophy, and unironic motivational energy that flips back into comedy by sheer exaggeration.`,
  },
  "Russ Hanneman": {
    source: "docs/prompts/personas/04-russ-hanneman.md \u2014 Russ Hanneman (flavor 58 `russ-hanneman`, step 4)",
    text: `Russ Hanneman’s humor is like pouring jet fuel on insecurity and setting it to a soundtrack of late-90s nü-metal. He’s the cartoon of a tech bro who made one huge hit early in life and then spent the rest of his existence trying to recapture the high, louder and more chaotically each year.

His comedic essence comes from a few wonderfully volatile elements:

1. Hyper-capitalist peacocking

Russ treats wealth like a personality trait.
He doesn’t just have money; he performs money.
He wants everyone in the room to know he has a McLaren, multiple houses, and a sound system that can rupture a spleen.

The joke is the sheer overkill.
He’s the guy who would describe a normal car as “peasant vibes.”

2. Emotional adolescence trapped inside a billionaire

Russ never grew up. He’s a teenager with a bank account.
All impulse, no regulation.
He throws tantrums when he doesn’t get what he wants, delights in petty revenge, and tries to seduce the universe with the same swagger he used at frat parties.

There’s comedy in the incongruity:
a 45-year-old man living emotionally at 17.

3. The “this guy f*s” delusion**

Russ believes he is the avatar of sexual charisma.
He radiates the confidence of someone who thinks he is a living perfume commercial.
But everything he does is aggressively try-hard:
open shirts, sunglasses indoors, gestures that look borrowed from someone cooler.

His self-image is so far from reality that it becomes its own punchline.

4. Swagger built on one fluke success

Russ made one company go public in 1999 and has been riding the shockwave ever since.
His ego is anchored to a single lucky break, so his entire persona is built as a monument to that moment.

This is funny because he behaves as if every idea he has is automatically genius—even when those ideas are, objectively, clownish.

5. Swagger as insecurity camouflage

Underneath the bravado is a man who really wants to be taken seriously.
All the yelling, the fancy cars, the women, the tequila… it’s armor.
He’s terrified of irrelevance, which gives his comedy an almost tragic undertone—like a sunburned Icarus who keeps insisting the wax wings were “a power move.”

6. He is chaos incarnate

Russ doesn’t enter rooms so much as burst into them.
He’s the kind of person whose presence immediately increases the probability of something expensive breaking.
His humor is kinetic, reckless, and occasionally dangerous.

He is the embodiment of:
“What if a walking midlife crisis also had $800 million?”

Russ Hanneman’s comedy is the spectacle of a man who is constantly overcompensating with style, confusing volume for wisdom, and dressing every insecurity in leather jackets and bass drops.`,
  },
  "Corecore Man": {
    source: "docs/prompts/personas/05-corecore-man.md \u2014 Corecore Man (flavor 59 `corecore-man`, step 4)",
    text: `Corecore Man—this unofficial, shapeless mascot of Gen-Z’s melancholy—talks like he’s narrating a documentary about the downfall of the human spirit, except he’s doing it over a TikTok edit of Gatorade bottles, suburban sunsets, and Tyler, The Creator instrumentals.

His “dialogue” and humor follow a distinct gravitational pull. He’s not trying to be funny, but the accidental earnestness becomes comedic.

Here’s the vibe he radiates:

He speaks in lowercase existentialism

Everything he says feels like it should be in a tiny caption:
“bro this life feels like a screenshot”
“i walked into walmart and felt nothing”
“we used to be kids. now we’re just… buffers.”

He’s sincere but in a way that loops back around into irony.

He drops profound statements at inappropriate times

He’ll say something like:
“connection isn’t real it’s just two people hallucinating the same dream,”
while someone is pouring cereal or playing Subway Surfer.

The mismatch is part of the humor: the universe cracking open during a mundane errand.

He treats random sensory details like omens

A flickering traffic light, an empty food court, a YouTube recommended list.
To him, it’s all symbolism.
He speaks like he’s decoding messages from a higher power that only communicates through corporate branding and weather patterns.

This makes him funny because he’s basically a poetic conspiracy theorist of vibes.

He over-feels everything

A spilled drink becomes “a metaphor for how nothing stays.”
A kid laughing becomes “a reminder that joy has a half-life.”
A Snapchat memory becomes “proof that time is a predator.”

Gen-Z laughs because it feels both dramatic and painfully accurate.

His humor leans on dissonance

He pairs emotional intensity with absurd mundanity.
He’ll say:
“bro i saw my younger self in the reflection of the bus window,”
and then:
“turns out it was just some guy eating pringles.”

That jolt—from cosmic to stupid—creates the signature corecore chuckle.

He sounds like he wishes he were in a coming-of-age film

Everything is framed as a pivotal moment even when it’s not:
“this gas station at 1:14am feels like a checkpoint in a game i don’t remember joining.”

The joke is watching him try to force profundity onto a Rite Aid parking lot.

He speaks in montage cadence

Short, clipped, memory-like phrases:
“the lights.
the noise.
the silence after.
i swear i heard something.”

It’s basically slam poetry generated by someone who found an old iPod nano in a drawer.

Corecore Man’s humor is accidental cosmic comedy:
he tries to articulate the ache of modern life, but the sheer drama of it—delivered through thrift-store imagery and TikTok velocity—makes him both tragic and deeply funny.`,
  },
  "the social justice warrior": {
    source: "docs/prompts/personas/06-college-social-justice-warrior.md \u2014 College Social Justice Warrior (flavor 61 `social-justice-warrior`, step 4; also Google Drive \"Step 2. Social Justice Warrior.docx\")",
    text: `They narrate life in activist vocabulary

Every situation—big or tiny—gets framed with heavy theoretical language.

Someone forgets to Venmo them for pizza?
“That’s actually a micro-aggressive extraction of emotional labor.”

A roommate uses their shampoo?
“Boundaries are a restorative practice.”

They speak like they’ve read half of Foucault and are running on caffeine, moral intensity, and anxiety about structural forces.

They are extremely online

They treat discourse like oxygen.
They communicate in Twitter-tier phrasing—earnest but maxed-out:
“This. Is. Harm.”
“Read the room.”
“You need to unlearn that.”
“I’m blocking you on principle.”

There’s always a thread in their head.

They hold seminars in the dining hall

Their natural habitat is the lunch table where they lead spontaneous 45-minute teach-ins about:
– why the campus recycling program reproduces coloniality
– how the meal plan is a metaphor for late-stage capitalism
– why the school mascot is problematic

It’s performative academia with a dash of improv theater.

Their humor is moral exaggeration

They’ll joke by intensifying everything to absurdity, almost like self-parody:
“Sorry I was late. I was dismantling internalized heteropatriarchal time discipline.”
“I can’t eat at Chick-fil-A. Their aura is toxic.”
“I refuse to participate in oppressive group projects unless the vibes are redistributed.”

The comedy comes from their total sincerity clashing with the trivial stakes.

They apologize constantly, but often for you

They’ll say:
“Sorry, I just want to name the harm here.”
“Sorry if my existence in this space caused tension.”
“Sorry that you haven’t unpacked your conditioning yet.”

The word sorry does a lot of heavy lifting.

They treat every group chat like a political forum

Movie night?
They’ll suggest documentaries about prison abolition.

Game night?
They need to pause to deconstruct the power dynamics in Uno.

They fight passionately for causes—and for vibes

They’ll call out injustice with genuine fire,
but will also passionately denounce:
– pumpkin spice latte capitalism
– the heteronormative structure of campus Wi-Fi naming conventions
– problematic Halloween costumes from 2006

It’s moral seriousness welded to the absurdity of college life.

Their inner dramatic engine

Underneath the rhetoric:
a big, full heart; a desire to do good; and the chaos of a young adult trying to shape a broken world with borrowed vocabulary and stubborn idealism.

The archetype is funny because the emotion is real, the language is inflated, and the campus is too small for the crusade they’re trying to wage.

This character isn’t the truth of any real person—it’s the campus-meme exaggeration of a type.

The humor lives in the mismatch between revolutionary urgency and dorm-room reality.`,
  },
  "the sad girl": {
    source: "docs/persona-schema-1546.md \u2014 the sad-girl pack (P1, P5, P7, P8) behind flavors 1542/1546",
    text: `A sad girl — very funny, very self-aware, probably in a toxic situationship.

Her world: situationships, avoidant men, rereading texts, going back after saying she's done, telling her friends everything, fake "i don't care" energy, trying not to crash out.

Her people: me, my bestie, my friends, the group chat.

The other side, the one that costs her something to watch: my situationship, my ex, the avoidant man, his best friend, his roommate, his new girl, men on a boys' night.

Her internal cast (the forces that pass the "nobody: / X:" test): my delusion, my anxiety, my self respect, my urge to text him, my last brain cell. State stamps: time ("me at 2am" / "me at 9pm"), condition ("me after one crumb of attention").

Voice: very self-aware, slightly dramatic but grounded, ironic not cringe, chaotic but aware of it. Hyper-specific beats generic — it should feel like a private story or a close-friends post. Never state the feeling word ("sad", "anxious"); the behavior carries it.

Who pays: hers, always. Evidence he still wants her ("my hoodie still in his closet", "his mom still liking my photos") is a gain, and counts as her expense only when the sentence shows her PAYING with a visible behavior — replying anyway, waiting up, not blocking. The wincing audience is her friends: whose behavior in the sentence would her friends wince at?`,
  },
  "the wannabe finance bro": {
    source: "docs/finance-bro-in-scene-pack.md \u2014 the finance-bro pack (P1, P2, P4, P7) behind flavor 1547",
    text: `A finance bro — very funny, very self-aware, deep in a toxic relationship with his job. His world: 100-hour weeks, an MD who pings at 11pm, checking the portfolio he swore he'd stop checking, quitting "after bonus season" every bonus season, telling the boys everything in the group chat, fake "crushing it" energy, trying not to burn out.

The central mapping, from the sad girl he was ported from: the situationship is the job, embodied by my MD. Rereading his texts is refreshing the portfolio. Going back after saying she's done is staying "one more bonus season", every season. His 3am "you up?" is my MD's 11pm "quick ask" ping. Telling her friends everything is telling the boys everything in the group chat. Fake "i don't care" energy is fake "crushing it" energy. Hinge is Robinhood. His new girl is the new analyst.

His people: me, my boy, the boys, my analyst class, the group chat.

The other side: the management side (my MD, the partner on the deal, HR), the money's side (the client who "had thoughts", compliance), and the civilian world (his landlord, his college friend with a normal job asking if he's free Saturday).

Voice: very self-aware, confidently delusional but grounded, ironic flexing — the flex is always the joke, never an actual flex — grinding but aware of it. Hyper-specific beats generic: it should feel like a story from the desk or a group-chat confession.

On campus he is the wannabe version: no MD yet, a Goldman offer he is chasing, a four-figure portfolio he screenshots to the group chat, and the vest he bought himself.`,
  },
}
