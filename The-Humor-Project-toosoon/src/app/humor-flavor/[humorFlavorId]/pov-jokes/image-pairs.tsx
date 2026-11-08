'use client'

// Images for the saved captions in section 4 of the POV Joke Maker.
//
// A saved caption gets its picture one of three ways: the pairing step (step
// 5 of the flavor) picks one image from a study image set for every saved
// caption that has none, a thumbnail grid of the same set lets a person pick
// or override by hand, or a GIF comes in through the KLIPY search and the
// paste box that were already here. Whatever a caption ends up with is drawn
// on the poster at the top of the section: numbered cards, picture above
// caption, one block per moment, so a screenshot of it can be posted as-is.
//
// The assignment lives on the favorite itself, which is why this module has
// no state of its own beyond the loaded set and the running pair jobs.
import { useCallback, useEffect, useMemo, useState } from 'react'

import { loadImageSetAction, type ImageSetResult, type PairableImage } from './image-set-actions'
import type { PovStep } from './pov-jokes-client'
import { BIG_BUTTON, FIELD_HELP, SMALL_BUTTON } from './pov-jokes-ui'
import { runStepWithSession } from './run-step'

export const DEFAULT_PAIRING_SET_ID = 69

// The part of a favorite this module reads.
export type PairableSaved = {
  id: string
  caption: string
  persona: string
  moment: string
  gifNote?: string
  imageId?: string
  imageUrl?: string
  imageFit?: number
  embedSrc?: string
  embedKind?: 'iframe' | 'image' | 'video'
}

// What gets written onto a favorite when an image is assigned.
export type ImageAssignment = {
  imageId: string
  imageUrl: string
  imageWho: string
  imageFit?: number
  imageWhy?: string
}

export type ImageSetState = {
  setIdText: string
  setSetIdText: (v: string) => void
  set: { id: number; slug: string; description: string } | null
  images: PairableImage[]
  error: string | null
  loading: boolean
  load: (id: number) => Promise<void>
}

const fillTemplate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole
  )

const unfilled = (filled: string): string[] => [
  ...new Set([...filled.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((m) => m[1])),
]

type RawPair = { jokeId: string; imageId: string; fit: number; why: string }

const parsePairs = (text: string): RawPair[] | null => {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    const parsed = JSON.parse(cleaned) as { pairs?: { joke_id?: string; image_id?: string; fit?: number; why?: string }[] }
    if (!Array.isArray(parsed.pairs)) return null
    return parsed.pairs
      .filter((p) => p.joke_id && p.image_id)
      .map((p) => ({
        jokeId: String(p.joke_id),
        imageId: String(p.image_id),
        fit: typeof p.fit === 'number' ? p.fit : 0,
        why: p.why ?? '',
      }))
  } catch {
    return null
  }
}

// What the prompt sees per image: a short id, who is in it, and enough of the
// stored description to match a reaction. The real ids are long UUIDs and a
// model retypes those wrong about one time in five, which lost captions; a
// two-digit id is copied back reliably and mapped to the UUID here.
const shortId = (i: number) => `img-${String(i + 1).padStart(2, '0')}`
const describeForPrompt = (images: PairableImage[]) =>
  images.map((img, i) => ({
    image_id: shortId(i),
    who: img.who || null,
    description: img.description.slice(0, 300),
  }))

// A saved caption's persona label may carry the moment it was written for
// ("Columbia · moment 2"); the poster and the prompt want the bare name.
export const bareName = (persona: string) => persona.replace(/ · moment \d+$/, '')

// The default set loads once, so the buttons are ready without a click.
export function useImageSet(): ImageSetState {
  const [setIdText, setSetIdText] = useState(String(DEFAULT_PAIRING_SET_ID))
  const [set, setSet] = useState<ImageSetState['set']>(null)
  const [images, setImages] = useState<PairableImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (id: number) => {
    setLoading(true)
    setError(null)
    const res: ImageSetResult = await loadImageSetAction(id)
    setLoading(false)
    if (res.ok === false) {
      setSet(null)
      setImages([])
      setError(res.error)
      return
    }
    setSet(res.set)
    setImages(res.images)
  }, [])

  useEffect(() => {
    void load(DEFAULT_PAIRING_SET_ID)
  }, [load])

  return { setIdText, setSetIdText, set, images, error, loading, load }
}

export function ImageSetControls({ state }: { state: ImageSetState }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="block text-sm font-semibold">Image set id</span>
        <input
          className="mt-1 w-28 rounded-md border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
          value={state.setIdText}
          onChange={(e) => state.setSetIdText(e.target.value)}
          inputMode="numeric"
        />
      </label>
      <button
        type="button"
        className={SMALL_BUTTON}
        disabled={state.loading}
        onClick={() => void state.load(Number.parseInt(state.setIdText, 10))}
      >
        {state.loading ? 'Loading the set…' : 'Load this image set'}
      </button>
      <p className={FIELD_HELP}>
        {state.error
          ? state.error
          : state.set
            ? `Set ${state.set.id}, “${state.set.slug}”: ${state.images.length} images${state.set.description ? ` — ${state.set.description}` : ''}`
            : 'No set loaded yet.'}
      </p>
    </div>
  )
}

type GroupJob = { status: 'running' | 'done' | 'failed'; assigned?: number; error?: string }

// One call per (persona, moment) group of saved captions that have no image
// yet. Each result is written straight onto the favorite.
export function PairSavedCaptions({
  pairStep,
  saved,
  images,
  set,
  onAssign,
}: {
  pairStep: PovStep | null
  saved: PairableSaved[]
  images: PairableImage[]
  set: ImageSetState['set']
  onAssign: (favoriteId: string, assignment: ImageAssignment) => void
}) {
  const [jobs, setJobs] = useState<Record<string, GroupJob>>({})

  const unpaired = useMemo(() => saved.filter((f) => !f.imageUrl), [saved])
  const groups = useMemo(() => {
    const byKey = new Map<string, { persona: string; moment: string; items: PairableSaved[] }>()
    unpaired.forEach((f) => {
      const persona = bareName(f.persona)
      const key = `${persona}\n${f.moment}`
      if (!byKey.has(key)) byKey.set(key, { persona, moment: f.moment, items: [] })
      byKey.get(key)?.items.push(f)
    })
    return [...byKey.entries()].map(([key, g]) => ({ key, ...g }))
  }, [unpaired])

  const anyRunning = Object.values(jobs).some((j) => j.status === 'running')

  const pairGroup = useCallback(
    async (group: (typeof groups)[number]) => {
      if (!pairStep || !set || !images.length) return
      setJobs((prev) => ({ ...prev, [group.key]: { status: 'running' } }))
      const finish = (job: GroupJob) => setJobs((prev) => ({ ...prev, [group.key]: job }))
      const filled = fillTemplate(pairStep.userPrompt, {
        EVENT: group.moment.trim(),
        PERSONA: group.persona,
        JOKES: JSON.stringify(
          group.items.map((f) => ({ id: f.id, caption: f.caption, gif_note: f.gifNote ?? null })),
          null,
          2
        ),
        IMAGES: JSON.stringify(describeForPrompt(images), null, 2),
      })
      const missing = unfilled(filled)
      if (missing.length) {
        finish({
          status: 'failed',
          error: `Not sent: step 5's prompt still contains ${missing.map((m) => `{{${m}}}`).join(', ')} after this page filled it in. This page fills {{EVENT}}, {{PERSONA}}, {{JOKES}}, and {{IMAGES}}. Nothing was spent on the call.`,
        })
        return
      }
      const res = await runStepWithSession({
        imageId: null,
        systemPrompt: pairStep.systemPrompt,
        userPrompt: filled,
        providerModelId: pairStep.providerModelId,
        temperature: pairStep.temperature,
        includeImage: false,
        isTemperatureSupported: pairStep.isTemperatureSupported,
        priorOutputs: {},
        reasoningEffort: 'medium',
        maxOutputTokens: 12000,
      })
      if (!res.ok) {
        finish({ status: 'failed', error: res.error ?? 'Step 5 failed.' })
        return
      }
      const parsed = parsePairs(res.text ?? '')
      if (!parsed) {
        finish({ status: 'failed', error: 'Step 5 returned something that is not the {"pairs": [...]} JSON this page expects.' })
        return
      }
      // Map the short ids back to the set's images; an id that is neither is
      // a hallucination and that caption stays unpaired.
      const byShort = new Map(images.map((img, i) => [shortId(i), img]))
      const byId = new Map(images.map((img) => [img.id, img]))
      let assigned = 0
      parsed.forEach((p) => {
        const image = byShort.get(p.imageId) ?? byId.get(p.imageId)
        if (!image || !group.items.some((f) => f.id === p.jokeId)) return
        onAssign(p.jokeId, { imageId: image.id, imageUrl: image.url, imageWho: image.who, imageFit: p.fit, imageWhy: p.why })
        assigned += 1
      })
      finish({ status: 'done', assigned })
    },
    [pairStep, set, images, onAssign]
  )

  const pairAll = useCallback(async () => {
    for (const group of groups) await pairGroup(group)
  }, [groups, pairGroup])

  if (!pairStep) return null

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className={BIG_BUTTON}
          disabled={!set || !images.length || !groups.length || anyRunning}
          onClick={() => void pairAll()}
        >
          {anyRunning
            ? 'Pairing…'
            : `Pair the ${unpaired.length} saved caption${unpaired.length === 1 ? '' : 's'} without an image with one from set ${set?.id ?? '…'}`}
        </button>
        <p className="text-sm text-[rgb(var(--muted))]">
          {!saved.length
            ? 'Nothing saved yet.'
            : !unpaired.length
              ? 'Every saved caption has an image. Remove one below to pair it again.'
              : `One call per point of view and moment: ${groups.length} call${groups.length === 1 ? '' : 's'}. A caption that already has an image is left alone.`}
        </p>
      </div>
      {groups.map((group) => {
        const job = jobs[group.key]
        if (!job) return null
        return (
          <p key={group.key} className="mt-2 text-sm text-[rgb(var(--muted))]">
            <span className="font-semibold text-[rgb(var(--ink))]">{group.persona}</span>
            {' · '}
            {group.moment.split('\n')[0]?.slice(0, 60)}
            {' — '}
            {job.status === 'running'
              ? 'pairing now…'
              : job.status === 'failed'
                ? `failed: ${job.error}`
                : `${job.assigned ?? 0} of ${group.items.length} paired.`}
          </p>
        )
      })}
    </div>
  )
}

// The thumbnails of the loaded set, to pick one by hand.
export function ImagePickerGrid({
  images,
  currentId,
  onPick,
}: {
  images: PairableImage[]
  currentId?: string
  onPick: (image: PairableImage) => void
}) {
  if (!images.length) {
    return <p className={FIELD_HELP}>No image set is loaded. Load one at the top of this section.</p>
  }
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
      {images.map((img) => (
        <button
          key={img.id}
          type="button"
          title={[img.who, img.description.slice(0, 160)].filter(Boolean).join(' — ')}
          onClick={() => onPick(img)}
          className={`overflow-hidden rounded-md ring-2 ${
            img.id === currentId ? 'ring-[rgb(var(--accent-strong))]' : 'ring-transparent hover:ring-[rgb(var(--muted))]'
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt={img.who || img.description.slice(0, 80)} className="aspect-square w-full object-cover" loading="lazy" />
        </button>
      ))}
    </div>
  )
}

// The poster: every saved caption that has a picture (a set image, or a GIF
// that is a direct image or video file), numbered, one block per moment.
// Plain white, nothing interactive inside the frame, so a screenshot of
// this box is the deliverable.
export function SavedPoster({ saved }: { saved: PairableSaved[] }) {
  const withPicture = useMemo(
    () =>
      saved.filter(
        (f) => f.imageUrl || (f.embedSrc && (f.embedKind === 'image' || f.embedKind === 'video'))
      ),
    [saved]
  )
  const groups = useMemo(() => {
    const order: string[] = []
    const byMoment = new Map<string, PairableSaved[]>()
    withPicture.forEach((f) => {
      if (!byMoment.has(f.moment)) {
        order.push(f.moment)
        byMoment.set(f.moment, [])
      }
      byMoment.get(f.moment)?.push(f)
    })
    return order.map((m) => ({ moment: m, items: byMoment.get(m) ?? [] }))
  }, [withPicture])

  if (!withPicture.length) return null
  const headline = (text: string) => text.trim().split('\n')[0]?.slice(0, 140) ?? ''

  return (
    <div className="mt-8">
      <p className="mb-3 text-sm text-[rgb(var(--muted))]">
        {withPicture.length} of {saved.length} saved caption{saved.length === 1 ? '' : 's'} ha
        {withPicture.length === 1 ? 's' : 've'} a picture. Screenshot the white box.
      </p>
      <div className="space-y-10 rounded-xl bg-white p-6 text-neutral-900 shadow-sm ring-1 ring-neutral-200">
        {groups.map((group) => (
          <div key={group.moment}>
            <p className="text-sm leading-snug">
              <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.25em] text-rose-700">Custom</span>
              {headline(group.moment)}
            </p>
            <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((f, i) => (
                <figure key={f.id} className="min-w-0">
                  <div className="relative overflow-hidden rounded-xl border-2 border-neutral-900 bg-neutral-100">
                    <span className="absolute left-2 top-2 z-10 rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-bold text-white">
                      #{i + 1}
                    </span>
                    {f.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={f.imageUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                    ) : f.embedKind === 'video' ? (
                      <video src={f.embedSrc} className="aspect-square w-full object-cover" autoPlay loop muted playsInline />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={f.embedSrc} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <figcaption className="mt-3">
                    <p className="text-[15px] font-medium leading-snug">{f.caption}</p>
                    <p className="mt-1.5 text-[13px] leading-snug text-emerald-800">
                      {bareName(f.persona)}
                      {typeof f.imageFit === 'number' ? ` ${f.imageFit.toFixed(2)}` : ''}
                    </p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
