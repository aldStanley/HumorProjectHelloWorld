'use client'

// Section 4 of the Reaction Joke Maker: the jokes that got a heart, turned
// into memes. Hearts outlive a run: clearing the moments and jokes above
// leaves this list alone, so the keepers from several personas and moments
// pile up here.
//
// A hearted joke becomes a meme through a FRAME (see frames.ts): the persona
// says the joke on line one, a second speaker reacts on line two, and the
// reaction is a picture. The picture comes from a study image set (set 69,
// Tamar's reaction faces, by default), filtered to the frame's feeling, or
// from the KLIPY search. A joke can hold one picture per frame. Every framed
// joke with a picture is drawn on the poster at the top of the section, the
// way it would be posted.
//
// The set loader and thumbnail grid are borrowed from the POV Joke Maker's
// image-pairs module rather than copied.
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ImagePickerGrid, ImageSetControls, useImageSet } from '../pov-jokes/image-pairs'
import { searchKlipyAction } from '../pov-jokes/klipy-actions'
import type { KlipyResult, KlipySearchResult } from '../pov-jokes/klipy-types'
import type { PovStep } from '../pov-jokes/pov-jokes-client'
import { loadRecord, saveRecord } from '../pov-jokes/pov-jokes-store'
import { FIELD_HELP, GOAL_TEXT, SECTION, SECTION_NUMBER, SECTION_TITLE, SMALL_BUTTON } from '../pov-jokes/pov-jokes-ui'
import { runStepWithSession } from '../pov-jokes/run-step'
import { buildTagPrompt, faceTagsKey, parseTagOutput, type FaceTags } from './face-tags'
import { faceMatchesFrame, framesFor, speakerName, type Frame } from './frames'
import { buildVisualWordsPrompt, parseVisualWords } from './visual-words'

// The picture under one frame of one joke: a set image, or a KLIPY GIF.
export type MemePicture = {
  imageId?: string
  imageUrl?: string
  imageWho?: string
  embedSrc?: string
  embedTitle?: string
  embedKind?: 'image' | 'video'
}

export type HeartedJoke = {
  id: string
  caption: string
  persona: string
  moment: string
  heartedAt: string
  // When the caption is a refiner's variant or a workshop rewrite: the
  // original joke it came from, so original, variants, and the human's
  // choice can be compared later.
  refinedFrom?: string
  // Where the caption came from: the writer's joke (absent or 'joke'), the
  // refiner ('variant'), or the workshop chat ('workshop').
  origin?: 'joke' | 'variant' | 'workshop' | 'edit'
  // For a workshop rewrite: the model's own tag after the dash ("douchiest
  // version"), and what the editor had asked for in the turn before it.
  // Stored so the feedback can be analyzed later (Lydia, 2026-09-09).
  note?: string
  askedFor?: string
  // One picture per frame id.
  memes?: Record<string, MemePicture>
  // The joke's visualizable words, best first, from one model call.
  visualWords?: string[]
}

// A stable id for one joke: the same persona saying the same line about the
// same moment is the same joke, whichever run produced it.
export const heartId = (persona: string, moment: string, caption: string): string => {
  let h = 5381
  const s = `${persona}\n${moment}\n${caption}`
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `h${(h >>> 0).toString(36)}`
}

const headline = (text: string) => text.trim().split('\n')[0]?.slice(0, 120) ?? ''
const hasPicture = (p?: MemePicture) => Boolean(p?.imageUrl || p?.embedSrc)

// The meme as it would be posted: white, nothing interactive, so a
// screenshot of it is the deliverable. Line one is the persona saying the
// joke; line two is the reactor, whose reaction is the picture.
export function MemeCard({ joke, frame, picture }: { joke: HeartedJoke; frame: Frame; picture?: MemePicture }) {
  return (
    <figure className="min-w-0 rounded-xl bg-white p-5 text-neutral-900 shadow-sm ring-1 ring-neutral-200">
      <p className="text-[17px] font-semibold leading-snug">
        {frame.showSpeaker === false ? joke.caption : <>{speakerName(joke.persona)}: &ldquo;{joke.caption}&rdquo;</>}
      </p>
      {frame.reactor ? <p className="mt-3 text-[17px] font-semibold leading-snug">{frame.reactor}:</p> : null}
      <div className="mt-3 overflow-hidden rounded-lg bg-neutral-100">
        {picture?.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={picture.imageUrl} alt={picture.imageWho || frame.reaction} className="w-full object-cover" loading="lazy" />
        ) : picture?.embedKind === 'video' ? (
          <video src={picture.embedSrc} className="w-full" autoPlay loop muted playsInline />
        ) : picture?.embedSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={picture.embedSrc} alt={picture.embedTitle ?? frame.reaction} className="w-full" loading="lazy" />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center p-6 text-center text-sm text-neutral-500">
            No picture yet. This is where the {frame.reaction} face goes.
          </div>
        )}
      </div>
    </figure>
  )
}

// Every framed joke that has a picture, one block per moment.
function MemePoster({ hearted }: { hearted: HeartedJoke[] }) {
  const cards = useMemo(
    () =>
      hearted.flatMap((joke) =>
        framesFor(joke.persona, joke.caption)
          .filter((frame) => hasPicture(joke.memes?.[frame.id]))
          .map((frame) => ({ joke, frame, picture: joke.memes?.[frame.id] }))
      ),
    [hearted]
  )
  const groups = useMemo(() => {
    const order: string[] = []
    const byMoment = new Map<string, typeof cards>()
    cards.forEach((c) => {
      if (!byMoment.has(c.joke.moment)) {
        order.push(c.joke.moment)
        byMoment.set(c.joke.moment, [])
      }
      byMoment.get(c.joke.moment)?.push(c)
    })
    return order.map((m) => ({ moment: m, items: byMoment.get(m) ?? [] }))
  }, [cards])

  if (!cards.length) {
    return (
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]">
        No meme has a picture yet. Give a framed joke below a picture and it appears here as it would be posted.
      </p>
    )
  }
  return (
    <div className="mt-6">
      <p className="mb-3 text-sm text-[rgb(var(--muted))]">
        {cards.length} meme{cards.length === 1 ? '' : 's'} ready to post. Screenshot any card.
      </p>
      <div className="space-y-10">
        {groups.map((group) => (
          <div key={group.moment}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
              On &ldquo;{headline(group.moment)}&rdquo;
            </p>
            <div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((c) => (
                <MemeCard key={`${c.joke.id}-${c.frame.id}`} joke={c.joke} frame={c.frame} picture={c.picture} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// A compact KLIPY search for one frame of one joke. It opens already
// searching for the frame's own words, and the box stays editable: retype
// and press Enter (or the button) to search for something else.
function GifSearch({ id, initialQuery, onChoose }: { id: string; initialQuery: string; onChoose: (r: KlipyResult) => void }) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<KlipyResult[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState('')

  const run = useCallback(async (term: string) => {
    const trimmed = term.trim()
    if (!trimmed) return
    setStatus('searching')
    setError(null)
    setSearched(trimmed)
    const res: KlipySearchResult = await searchKlipyAction({ query: trimmed, perPage: 16 })
    setStatus('done')
    if (res.ok) {
      setResults(res.results ?? [])
      return
    }
    setError(res.error ?? 'The GIF search failed.')
    setResults([])
  }, [])

  useEffect(() => {
    if (initialQuery.trim()) void run(initialQuery)
    // Runs once, when this search opens; the box drives every later search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mt-4">
      <p className={FIELD_HELP}>
        {initialQuery.trim()
          ? `Started with the frame's own search, “${initialQuery}”. Change the words and search again for something else.`
          : 'Type what the reaction should look like and search.'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          id={`gif-search-${id}`}
          type="search"
          className="min-w-0 flex-1 rounded-lg border border-[rgb(var(--gloss)/0.5)] bg-transparent px-3 py-2 text-sm dark:border-[rgb(var(--gloss)/0.2)]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void run(query)
            }
          }}
          placeholder="Search KLIPY, e.g. disappointed sigh"
        />
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={status === 'searching' || !query.trim()}
          onClick={() => void run(query)}
        >
          {status === 'searching' ? 'Searching KLIPY…' : 'Search KLIPY for a GIF'}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p> : null}
      {status === 'done' && !error ? (
        <p className={FIELD_HELP}>
          {results.length
            ? `${results.length} results for “${searched}”. Click one to use it as the reaction.`
            : `KLIPY returned nothing for “${searched}”. Try a simpler, more common phrase.`}
        </p>
      ) : null}
      {results.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                title={r.title}
                onClick={() => onChoose(r)}
                className="block w-full overflow-hidden rounded-lg border border-transparent transition hover:border-[rgb(var(--accent-strong))]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.previewUrl} alt={r.title} className="h-28 w-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// One hearted joke: its frames on the left, the chosen frame's meme and the
// picture pickers on the right.
type TagState = { tags: FaceTags | null; status: 'idle' | 'running' | 'failed'; error?: string; canTag: boolean; tag: () => void }
type WordsState = { status: 'idle' | 'running' | 'failed'; error?: string }

function HeartedJokeBlock({
  joke,
  images,
  tagState,
  wordsState,
  onFindWords,
  onUnheart,
  onSetPicture,
}: {
  joke: HeartedJoke
  images: { id: string; url: string; description: string; who: string }[]
  tagState: TagState
  wordsState: WordsState
  onFindWords: () => void
  onUnheart: () => void
  onSetPicture: (frameId: string, picture: MemePicture | null) => void
}) {
  const frames = framesFor(joke.persona, joke.caption)
  const [frameId, setFrameId] = useState(frames[0]?.id ?? 'plain')
  const frame = frames.find((f) => f.id === frameId) ?? frames[0]
  const picture = joke.memes?.[frame.id]
  const [picker, setPicker] = useState<'none' | 'set' | 'gif'>('none')
  const [showAll, setShowAll] = useState(false)
  // Which of the joke's visual words the GIF search is using.
  const [wordQuery, setWordQuery] = useState<string | null>(null)
  const words = joke.visualWords ?? []
  // Picking the visual-word frame finds the words if the joke has none yet,
  // and opens the GIF search on the best one.
  useEffect(() => {
    if (!frame.queryFromJoke) return
    if (!words.length && wordsState.status === 'idle') onFindWords()
    setPicker('gif')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.id])
  const gifQuery = frame.queryFromJoke ? (wordQuery ?? words[0] ?? '') : frame.gifSearch
  const { tags } = tagState
  // The grid's hover text is who plus description; putting the tags first
  // makes a face's tags visible without any new UI.
  const tagged = useMemo(
    () => images.map((img) => (tags?.[img.id] ? { ...img, description: `${tags[img.id].join(', ')} — ${img.description}` } : img)),
    [images, tags]
  )
  const matching = useMemo(
    () => tagged.filter((img) => faceMatchesFrame(frame, tags?.[img.id])),
    [tagged, frame, tags]
  )
  const filterable = frame.emotions.length > 0 && Boolean(tags)
  const shown = showAll || !filterable ? tagged : matching

  return (
    <li id={`hearted-${joke.id}`} className="scroll-mt-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
        {joke.persona} · on &ldquo;{headline(joke.moment)}&rdquo;
      </p>
      <p className="mt-2.5 max-w-3xl text-2xl font-semibold leading-snug">&ldquo;{joke.caption}&rdquo;</p>

      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-x-10">
        <fieldset>
          <legend className="text-sm font-semibold">The frame this joke is posted in</legend>
          <div className="mt-3 space-y-2.5">
            {frames.map((f) => {
              const has = hasPicture(joke.memes?.[f.id])
              return (
                <label key={f.id} className="flex cursor-pointer items-baseline gap-3">
                  <input
                    type="radio"
                    name={`frame-${joke.id}`}
                    value={f.id}
                    checked={frameId === f.id}
                    onChange={() => {
                      setFrameId(f.id)
                      setPicker('none')
                      setShowAll(false)
                    }}
                  />
                  <span className={frameId === f.id ? 'text-sm font-semibold' : 'text-sm'}>{f.name}</span>
                  <span className="text-xs text-[rgb(var(--muted))]">{has ? 'has a picture' : 'no picture yet'}</span>
                </label>
              )
            })}
          </div>
          <button
            type="button"
            className="mt-6 text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
            onClick={onUnheart}
          >
            Remove the heart from this joke
          </button>
        </fieldset>

        <div className="mt-6 min-w-0 lg:mt-0">
          <p className="text-sm font-semibold">How it would post, in the &ldquo;{frame.name}&rdquo; frame</p>
          <div className="mt-3 max-w-md">
            <MemeCard joke={joke} frame={frame} picture={picture} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() => setPicker((p) => (p === 'set' ? 'none' : 'set'))}
            >
              {picker === 'set'
                ? 'Hide the image set'
                : frame.emotions.length
                  ? `Pick a ${frame.reaction.split(',')[0]} face from the image set`
                  : 'Pick a face from the image set'}
            </button>
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() => setPicker((p) => (p === 'gif' ? 'none' : 'gif'))}
            >
              {picker === 'gif' ? 'Hide the GIF search' : 'Find a GIF on KLIPY instead'}
            </button>
            {hasPicture(picture) ? (
              <button type="button" className={SMALL_BUTTON} onClick={() => onSetPicture(frame.id, null)}>
                Remove this picture
              </button>
            ) : null}
          </div>

          {picker === 'set' ? (
            <div className="mt-3">
              {frame.emotions.length && !tags ? (
                <div className={FIELD_HELP}>
                  <p>
                    The faces in this set have not been tagged by emotion yet, so all {images.length} are shown.
                    Tagging is one model call over the set&rsquo;s descriptions; the tags stay in this browser.
                  </p>
                  <button
                    type="button"
                    className={`${SMALL_BUTTON} mt-2`}
                    disabled={tagState.status === 'running' || !tagState.canTag}
                    onClick={tagState.tag}
                  >
                    {tagState.status === 'running' ? 'Tagging the faces…' : `Tag the ${images.length} faces by emotion`}
                  </button>
                  {tagState.status === 'failed' ? (
                    <p className="mt-2 text-red-700 dark:text-red-400">{tagState.error}</p>
                  ) : null}
                </div>
              ) : null}
              {filterable ? (
                <p className={FIELD_HELP}>
                  {showAll
                    ? `All ${images.length} faces in the set.`
                    : `${matching.length} of ${images.length} faces are tagged ${frame.emotions.join(', ')}.`}{' '}
                  <button type="button" className="font-semibold underline" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Show only the matching ones' : 'Show all of them'}
                  </button>
                  {' · '}
                  <button
                    type="button"
                    className="font-semibold underline"
                    disabled={tagState.status === 'running' || !tagState.canTag}
                    onClick={tagState.tag}
                  >
                    {tagState.status === 'running' ? 'Tagging the faces again…' : 'Tag the faces again'}
                  </button>
                  {tagState.status === 'failed' ? (
                    <span className="block text-red-700 dark:text-red-400">{tagState.error}</span>
                  ) : null}
                </p>
              ) : null}
              <div className="mt-2">
                <ImagePickerGrid
                  images={shown}
                  currentId={picture?.imageId}
                  onPick={(img) => {
                    onSetPicture(frame.id, { imageId: img.id, imageUrl: img.url, imageWho: img.who })
                    setPicker('none')
                  }}
                />
              </div>
            </div>
          ) : null}
          {frame.queryFromJoke ? (
            <div className="mt-3">
              <p className="text-sm font-semibold">The visual words in this joke</p>
              {wordsState.status === 'running' ? (
                <p className={FIELD_HELP}>Reading the joke for its action or thing…</p>
              ) : wordsState.status === 'failed' ? (
                <p className="mt-1 text-sm text-red-700 dark:text-red-400">{wordsState.error}</p>
              ) : words.length ? (
                <p className={FIELD_HELP}>Best first. Click one to search KLIPY for it, or edit the search box below.</p>
              ) : (
                <p className={FIELD_HELP}>Not found yet.</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {words.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
                      gifQuery === w
                        ? 'border-[rgb(var(--accent-strong))] font-semibold'
                        : 'border-[rgb(var(--gloss)/0.6)] hover:bg-[rgb(var(--panel)/0.9)] dark:border-[rgb(var(--gloss)/0.25)]'
                    }`}
                    onClick={() => {
                      setWordQuery(w)
                      setPicker('gif')
                    }}
                  >
                    {w}
                  </button>
                ))}
                <button
                  type="button"
                  className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline disabled:opacity-40"
                  disabled={wordsState.status === 'running'}
                  onClick={onFindWords}
                >
                  {words.length ? 'Find the words again' : 'Find the visual words'}
                </button>
              </div>
            </div>
          ) : null}
          {picker === 'gif' ? (
            <GifSearch
              key={`${joke.id}-${frame.id}-${gifQuery}`}
              id={`${joke.id}-${frame.id}`}
              initialQuery={gifQuery}
              onChoose={(r) => {
                onSetPicture(frame.id, { embedSrc: r.fullUrl, embedTitle: r.title, embedKind: r.fullKind })
                setPicker('none')
              }}
            />
          ) : null}
        </div>
      </div>
    </li>
  )
}

export function HeartedJokesSection({
  hearted,
  step,
  onUnheart,
  onSetPicture,
  onSetVisualWords,
  header,
}: {
  hearted: HeartedJoke[]
  // The flavor's step, for its model: the tagging call runs on it.
  step: PovStep | null
  onUnheart: (id: string) => void
  onSetPicture: (id: string, frameId: string, picture: MemePicture | null) => void
  onSetVisualWords: (id: string, words: string[]) => void
  // The past-runs page uses this section too, with its own numbering and
  // first line; the working page uses the defaults.
  header?: { number: string; scope: string; emptyNote: string }
}) {
  const imageSet = useImageSet()
  const setId = imageSet.set?.id ?? null

  // ---- emotion tags for the loaded set, cached per set id
  const [tags, setTags] = useState<FaceTags | null>(null)
  const [tagStatus, setTagStatus] = useState<'idle' | 'running' | 'failed'>('idle')
  const [tagError, setTagError] = useState<string | undefined>(undefined)
  useEffect(() => {
    setTags(null)
    setTagStatus('idle')
    if (setId == null) return
    let cancelled = false
    loadRecord<FaceTags>(faceTagsKey(setId))
      .then((saved) => {
        if (!cancelled && saved) setTags(saved)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [setId])

  const tagFaces = useCallback(async () => {
    if (!step || setId == null || !imageSet.images.length) return
    setTagStatus('running')
    setTagError(undefined)
    const faces = imageSet.images
    const res = await runStepWithSession({
      imageId: null,
      systemPrompt: 'Return only JSON.',
      userPrompt: buildTagPrompt(faces),
      providerModelId: step.providerModelId,
      temperature: step.temperature,
      includeImage: false,
      isTemperatureSupported: step.isTemperatureSupported,
      priorOutputs: {},
      reasoningEffort: 'low',
      maxOutputTokens: 16000,
    })
    if (!res.ok) {
      setTagStatus('failed')
      setTagError(res.error ?? 'The tagging call failed.')
      return
    }
    const parsed = parseTagOutput(res.text ?? '', faces)
    if (!parsed) {
      setTagStatus('failed')
      setTagError('The model returned something that is not the expected JSON, so no face was tagged.')
      return
    }
    setTags(parsed)
    setTagStatus('idle')
    saveRecord(faceTagsKey(setId), parsed).catch(() => undefined)
  }, [step, setId, imageSet.images])

  // ---- the visual words of one joke, one small call each
  const [wordsStatus, setWordsStatus] = useState<Record<string, WordsState>>({})
  const findWords = useCallback(
    async (joke: HeartedJoke) => {
      if (!step) return
      setWordsStatus((prev) => ({ ...prev, [joke.id]: { status: 'running' } }))
      const res = await runStepWithSession({
        imageId: null,
        systemPrompt: 'Return only JSON.',
        userPrompt: buildVisualWordsPrompt(joke.caption),
        providerModelId: step.providerModelId,
        temperature: step.temperature,
        includeImage: false,
        isTemperatureSupported: step.isTemperatureSupported,
        priorOutputs: {},
        reasoningEffort: 'low',
        maxOutputTokens: 2000,
      })
      const words = res.ok ? parseVisualWords(res.text ?? '') : null
      if (!words) {
        setWordsStatus((prev) => ({
          ...prev,
          [joke.id]: { status: 'failed', error: res.ok ? 'The model did not return a list of words.' : res.error ?? 'The call failed.' },
        }))
        return
      }
      onSetVisualWords(joke.id, words)
      setWordsStatus((prev) => ({ ...prev, [joke.id]: { status: 'idle' } }))
    },
    [step, onSetVisualWords]
  )

  const tagState: TagState = {
    tags,
    status: tagStatus,
    error: tagError,
    canTag: Boolean(step) && setId != null && imageSet.images.length > 0,
    tag: () => void tagFaces(),
  }

  return (
    <section className={`${SECTION} max-w-6xl`} id="hearted-jokes">
      <p className={SECTION_NUMBER}>{header?.number ?? 'Step 5 of 5'}</p>
      <h2 className={SECTION_TITLE}>Turn the hearted jokes into memes</h2>
      <ul className={`${GOAL_TEXT} list-disc space-y-1 pl-5`}>
        <li>
          {header?.scope ??
            'Every joke you hearted, newest first, across every run on this flavor. Hearts survive clearing a run.'}
        </li>
        <li>
          A frame turns a joke into a two-line meme: the persona says the joke, then someone reacts with a
          picture. &ldquo;Me: disappointed&rdquo;, &ldquo;Me: wtf&rdquo;, &ldquo;Also Columbia: smug&rdquo;, and
          &ldquo;Also Columbia: pretend sad&rdquo; are the Columbia frames so far, plus &ldquo;Me: reading the
          FAQ&rdquo; on jokes that mention an FAQ. GigaChad jokes stand alone over a GigaChad, angry, or strong
          gif. Every joke also gets &ldquo;the joke&rsquo;s visual word gif&rdquo;: one small call pulls the
          concrete action or thing out of the joke, and the GIF search starts there. More frames go in{' '}
          <code>frames.ts</code>.
        </li>
        <li>
          The reaction picture comes from the image set (set 69, reaction faces, by default) or from a KLIPY GIF
          search. One model call tags every face in the set by emotion; a frame then shows only the faces tagged
          with its feeling.
        </li>
        <li>Every framed joke with a picture is shown at the top, as it would be posted.</li>
      </ul>

      {!hearted.length ? (
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]">
          {header?.emptyNote ?? 'Nothing hearted yet. Every joke in step 4 has a heart beside it.'}
        </p>
      ) : (
        <>
          <div className="mt-6 max-w-3xl">
            <ImageSetControls state={imageSet} />
          </div>
          <MemePoster hearted={hearted} />

          <ul className="mt-12 space-y-14">
            {hearted.map((joke) => (
              <HeartedJokeBlock
                key={joke.id}
                joke={joke}
                images={imageSet.images}
                tagState={tagState}
                wordsState={wordsStatus[joke.id] ?? { status: 'idle' }}
                onFindWords={() => void findWords(joke)}
                onUnheart={() => onUnheart(joke.id)}
                onSetPicture={(frameId, picture) => onSetPicture(joke.id, frameId, picture)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
