'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseAuthCookieOptions } from '@/utils/supabase/authCookies'
import { createPortal } from 'react-dom'

import { getSupabasePublicKey } from '@/utils/supabase/env'

type StudyImageSet = {
  id: number
  slug: string
  description: string | null
}

type StudyImageSetImage = {
  id: string
  url: string
  additional_context: string | null
}

type StudyImageSetPanelProps = {
  humorFlavorId: number
  captionHref: string
  imageSets: StudyImageSet[]
  imageSetImages: Record<string, StudyImageSetImage[]>
  imageSetsError: string | null
  mappingError: string | null
}

type RequestStatus = 'loading' | 'done'

const formatFlavorLabel = (slug: string) =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const formatAdditionalContext = (value: string | null) => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return 'No additional context available for this image.'
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length <= 10) {
    return words.join(' ')
  }
  return `${words.slice(0, 10).join(' ')}...`
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
const apiEndpoint = apiBaseUrl
  ? `${apiBaseUrl.replace(/\/+$/, '')}/pipeline/generate-captions`
  : null

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabasePublicKey = getSupabasePublicKey()

const createSupabaseBrowserClient = () => {
  if (!supabaseUrl || !supabasePublicKey) {
    return null
  }

  return createBrowserClient(supabaseUrl, supabasePublicKey, { cookieOptions: getSupabaseAuthCookieOptions(supabaseUrl) })
}

export default function StudyImageSetPanel({
  humorFlavorId,
  captionHref,
  imageSets,
  imageSetImages,
  imageSetsError,
  mappingError,
}: StudyImageSetPanelProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [activeSetId, setActiveSetId] = useState<number | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [requestStatuses, setRequestStatuses] = useState<
    Record<string, RequestStatus>
  >({})
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    setPortalTarget(document.body)
  }, [])

  const activeSet = activeSetId
    ? imageSets.find((set) => set.id === activeSetId) ?? null
    : null
  const activeImages = activeSetId
    ? imageSetImages[String(activeSetId)] ?? []
    : []

  const closeModal = () => {
    setIsModalOpen(false)
  }

  const setAllDone = (images: StudyImageSetImage[]) => {
    const nextStatuses: Record<string, RequestStatus> = {}
    images.forEach((image) => {
      nextStatuses[image.id] = 'done'
    })
    setRequestStatuses(nextStatuses)
  }

  const handleSelectSet = async (imageSetId: number) => {
    const images = imageSetImages[String(imageSetId)] ?? []
    const initialStatuses: Record<string, RequestStatus> = {}
    images.forEach((image) => {
      initialStatuses[image.id] = 'loading'
    })

    setActiveSetId(imageSetId)
    setIsModalOpen(true)
    setRequestStatuses(initialStatuses)

    if (!apiEndpoint || images.length === 0 || !supabase) {
      if (!supabase) {
        console.warn('Supabase client unavailable; skipping caption requests.')
      }
      setAllDone(images)
      return
    }

    setIsSending(true)

    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session?.access_token) {
        console.error('Missing Supabase session for caption requests.', error)
        setAllDone(images)
        setIsSending(false)
        return
      }

      const accessToken = data.session.access_token

      await Promise.all(
        images.map(async (image) => {
          try {
            await fetch(apiEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                imageId: image.id,
                humorFlavorId,
              }),
            })
          } catch (requestError) {
            console.error('Error generating captions:', requestError)
          } finally {
            setRequestStatuses((prev) => ({
              ...prev,
              [image.id]: 'done',
            }))
          }
        })
      )
    } finally {
      setIsSending(false)
    }
  }

  if (imageSetsError) {
    return (
      <p className="mt-4 text-sm text-[rgb(var(--muted))]">
        Unable to load study image sets right now.
      </p>
    )
  }

  if (!imageSets.length) {
    return (
      <p className="mt-4 text-sm text-[rgb(var(--muted))]">
        No study image sets found.
      </p>
    )
  }

  return (
    <>
      {mappingError ? (
        <p className="mt-4 text-sm text-[rgb(var(--muted))]">
          Image mappings are unavailable right now.
        </p>
      ) : null}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {imageSets.map((imageSet) => {
          const setImages = imageSetImages[String(imageSet.id)] ?? []
          const isActive = isSending && activeSetId === imageSet.id

          return (
            <button
              key={imageSet.id}
              type="button"
              onClick={() => handleSelectSet(imageSet.id)}
              disabled={isSending}
              className="group rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-4 text-left shadow-[0_18px_40px_-30px_rgb(var(--primary-deep)/0.5)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-32px_rgb(var(--primary-deep)/0.6)] disabled:cursor-not-allowed disabled:opacity-70 dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                    Image set
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-[rgb(var(--ink))]">
                    {formatFlavorLabel(imageSet.slug)}
                  </h3>
                  <p className="mt-1 text-xs text-[rgb(var(--muted))]">
                    {imageSet.description ?? imageSet.slug}
                  </p>
                </div>
                <span className="rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.7)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--primary-deep))] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--primary-bright))]">
                  {setImages.length} images
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {setImages.length ? (
                  setImages.map((image, index) => (
                    <img
                      key={image.id}
                      src={image.url}
                      alt={`${formatFlavorLabel(imageSet.slug)} thumbnail ${
                        index + 1
                      }`}
                      className="h-7 w-7 rounded-lg border border-[rgb(var(--gloss)/0.7)] object-cover shadow-[0_6px_16px_-10px_rgb(var(--primary-deep)/0.6)] dark:border-[rgb(var(--gloss)/0.1)]"
                      loading="lazy"
                    />
                  ))
                ) : (
                  <p className="text-xs text-[rgb(var(--muted))]">
                    No images mapped yet.
                  </p>
                )}
              </div>

              {isActive ? (
                <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--primary-deep))] dark:text-[rgb(var(--primary-bright))]">
                  Sending requests...
                </p>
              ) : null}
            </button>
          )
        })}
      </div>

      {portalTarget && isModalOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.75)] px-4 py-6 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              onMouseDown={closeModal}
            >
              <div
                className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.45)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.28),rgb(var(--primary)/0.14))]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                      Caption requests
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-[rgb(var(--ink))] dark:text-[rgb(var(--on-primary))]">
                      {activeSet
                        ? `Testing ${formatFlavorLabel(activeSet.slug)}`
                        : 'Testing image set'}
                    </h3>
                    <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                      Generating captions for each image in this set.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--accent))]"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-6 grid min-h-0 flex-1 gap-3 overflow-y-auto pr-2">
                  {activeImages.length ? (
                    activeImages.map((image, index) => (
                      <div
                        key={image.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-4 py-3 shadow-[0_12px_28px_-20px_rgb(var(--primary-deep)/0.35)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)]"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={image.url}
                            alt={`Image ${index + 1}`}
                            className="h-10 w-10 rounded-xl border border-[rgb(var(--gloss)/0.7)] object-cover shadow-[0_6px_16px_-10px_rgb(var(--primary-deep)/0.45)] dark:border-[rgb(var(--gloss)/0.1)]"
                          />
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                              Image {index + 1}
                            </p>
                            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
                              {formatAdditionalContext(
                                image.additional_context
                              )}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.7)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--primary-deep))] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--primary-bright))]">
                          {requestStatuses[image.id] === 'done'
                            ? 'Done!'
                            : 'Loading...'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[rgb(var(--muted))]">
                      No images mapped to this set yet.
                    </p>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={captionHref}
                    className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] shadow-[0_18px_35px_-24px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-24px_rgb(var(--primary-deep)/0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.1)]"
                  >
                    View Captions
                  </Link>
                  <span className="text-xs uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                    {isSending ? 'Requests running' : 'Requests complete'}
                  </span>
                </div>
              </div>
            </div>,
            portalTarget
          )
        : null}
    </>
  )
}
