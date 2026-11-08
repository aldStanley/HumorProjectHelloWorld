// Meme frames for the hearted jokes.
//
// A frame is a two-line dialogue meme: the persona says the joke, then a
// second speaker reacts with a picture. The picture is what the person picks
// (from a study image set, or a KLIPY GIF); the frame says WHO reacts and
// with WHAT feeling, and supplies the words that find a fitting picture.
//
// Frames are data so more can be added here without touching the page.
// Lydia, 2026-09-07: "Here's the only possible frame we can apply (hopefully
// we'll come up with more)".

export type Frame = {
  id: string
  // Shown in the frame list, e.g. "Me: disappointed".
  name: string
  // The second line's speaker. Null means no second line: just the joke and
  // a picture under it.
  reactor: string | null
  // False drops the "Columbia:" label from line one, so the joke stands on
  // its own over the picture. Defaults to true.
  showSpeaker?: boolean
  // The feeling the picture should show, in words.
  reaction: string
  // Which emotion tags (from EMOTIONS, put on each face by the tagging
  // call) count as showing that feeling. Empty means any face will do.
  emotions: string[]
  // What the KLIPY search box starts with.
  gifSearch: string
  // Which personas this frame is for. Empty means every persona.
  personas: string[]
  // When set, the frame is offered only for jokes whose text matches.
  captionPattern?: RegExp
  // The GIF search starts from words pulled out of the joke itself (its
  // visualizable action or thing), found by one model call per joke, rather
  // than from gifSearch.
  queryFromJoke?: boolean
}

const COLUMBIA = 'Columbia University Administration'
const GIGACHAD = 'GigaChad'

export const FRAMES: Frame[] = [
  {
    id: 'me-disappointed',
    name: 'Me: disappointed',
    reactor: 'Me',
    reaction: 'disappointed, let down, tired of this',
    emotions: ['disappointed', 'sad', 'crying', 'tired', 'defeated', 'unimpressed', 'annoyed', 'frustrated', 'bored'],
    gifSearch: 'disappointed sigh',
    personas: [COLUMBIA],
  },
  {
    id: 'me-wtf',
    name: 'Me: wtf',
    reactor: 'Me',
    reaction: 'wtf, disbelief, staring at the screen',
    emotions: ['shocked', 'confused', 'disgusted', 'surprised'],
    gifSearch: 'wtf confused stare',
    personas: [COLUMBIA],
  },
  {
    id: 'me-faq-book',
    name: 'Me: reading the FAQ',
    reactor: 'Me',
    reaction: 'reading a very long document, flipping through a book, studying the fine print',
    emotions: ['thinking', 'bored', 'confused'],
    gifSearch: 'reading book flipping pages',
    personas: [COLUMBIA],
    // Only for the jokes where Columbia answers with an FAQ.
    captionPattern: /\bFAQs?\b/i,
  },
  {
    id: 'also-columbia-smug',
    name: 'Also Columbia: smug',
    reactor: 'Also Columbia',
    reaction: 'smirking, smug, laughing at its own cleverness',
    emotions: ['smug', 'smirking', 'confident', 'gloating', 'amused', 'laughing'],
    gifSearch: 'smug smirk',
    personas: [COLUMBIA],
  },
  {
    id: 'also-columbia-pretend-sad',
    name: 'Also Columbia: pretend sad',
    reactor: 'Also Columbia',
    reaction: 'pretending to be sad, fake tears, performed sympathy',
    emotions: ['pretend-sad', 'crying', 'sad'],
    gifSearch: 'fake crying',
    personas: [COLUMBIA],
  },
  // GigaChad: the joke on its own, a picture under it. No speaker labels.
  {
    id: 'gigachad-gigachad',
    name: 'GigaChad gif',
    reactor: null,
    showSpeaker: false,
    reaction: 'gigachad, chiseled jaw, serene superiority',
    emotions: ['confident', 'smug'],
    gifSearch: 'gigachad',
    personas: [GIGACHAD],
  },
  {
    id: 'gigachad-angry',
    name: 'Angry gif',
    reactor: null,
    showSpeaker: false,
    reaction: 'angry, furious, shouting',
    emotions: ['angry', 'annoyed', 'frustrated'],
    gifSearch: 'angry rage',
    personas: [GIGACHAD],
  },
  {
    id: 'gigachad-strong',
    name: 'Strong gif',
    reactor: null,
    showSpeaker: false,
    reaction: 'strong, flexing, lifting, triumphant',
    emotions: ['confident', 'excited'],
    gifSearch: 'flexing strong',
    personas: [GIGACHAD],
  },
  // Every persona: the joke over a gif of the joke's own visual word.
  {
    id: 'visual-word',
    name: "The joke's visual word gif",
    reactor: null,
    showSpeaker: false,
    reaction: 'the concrete action or thing the joke turns on',
    emotions: [],
    gifSearch: '',
    personas: [],
    queryFromJoke: true,
  },
  {
    id: 'plain',
    name: 'Just the joke and a picture',
    reactor: null,
    reaction: 'whatever fits the joke',
    emotions: [],
    gifSearch: '',
    personas: [],
  },
]

// How the persona is named on the meme's first line.
const SPEAKER_NAMES: Record<string, string> = {
  [COLUMBIA]: 'Columbia',
  // The default POV of flavor 1540: never named in a caption.
  'Gen-Z Columbia Student': 'Me',
}
export const speakerName = (persona: string): string => SPEAKER_NAMES[persona] ?? persona

// The frames offered for one joke: the persona's frames, minus any whose
// caption pattern the joke does not match.
export const framesFor = (persona: string, caption = ''): Frame[] =>
  FRAMES.filter(
    (f) =>
      (!f.personas.length || f.personas.includes(persona)) &&
      (!f.captionPattern || f.captionPattern.test(caption))
  )

export const frameById = (id: string): Frame | undefined => FRAMES.find((f) => f.id === id)

// The closed list of emotion tags a face can carry. Closed so a frame can
// name its emotions and be sure the tagger used the same words.
export const EMOTIONS = [
  'disappointed', 'sad', 'crying', 'tired', 'defeated', 'unimpressed', 'annoyed', 'frustrated',
  'angry', 'disgusted', 'bored', 'shocked', 'surprised', 'confused', 'scared', 'anxious',
  'thinking', 'neutral', 'smug', 'smirking', 'confident', 'gloating', 'amused', 'laughing',
  'happy', 'excited', 'relaxed', 'pretend-sad',
] as const

// Does a face with these tags show the frame's feeling? Only the two most
// visible tags count: the tagger lists them most-visible first, and a
// third-place "crying" on a face that is mostly "excited, happy" is not a
// disappointed face. A frame with no emotions accepts every face.
export const faceMatchesFrame = (frame: Frame, tags: string[] | undefined): boolean =>
  !frame.emotions.length || Boolean(tags?.slice(0, 2).some((t) => frame.emotions.includes(t)))
