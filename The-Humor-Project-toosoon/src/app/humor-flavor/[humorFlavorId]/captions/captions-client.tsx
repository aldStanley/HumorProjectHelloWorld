'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'

import { useTimeZone } from '@/components/timezone-context'

import { PAGE_SIZE } from './constants'
import type { CaptionRow } from './types'

type CaptionsClientProps = {
  flavorId: number
  flavorSlug: string
  flavorDescription: string | null
  initialCaptions: CaptionRow[]
  initialPage: number
  initialTotalCount: number | null
  initialError: string | null
}

const formatDate = (value: string, timeZone: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }

  if (timeZone) {
    options.timeZone = timeZone
  }

  return new Intl.DateTimeFormat('en-US', options).format(date)
}

const buildPageLabel = (page: number, totalPages: number | null) =>
  totalPages ? `${page} / ${totalPages}` : `${page}`

const updatePageUrl = (page: number) => {
  if (typeof window === 'undefined') {
    return
  }

  const url = new URL(window.location.href)
  if (page <= 1) {
    url.searchParams.delete('page')
  } else {
    url.searchParams.set('page', String(page))
  }
  window.history.replaceState({}, '', url)
}

export default function CaptionsClient({
  flavorId,
  flavorSlug,
  flavorDescription,
  initialCaptions,
  initialPage,
  initialTotalCount,
  initialError,
}: CaptionsClientProps) {
  const [captions, setCaptions] = useState(initialCaptions)
  const [page, setPage] = useState(initialPage)
  const [pageInput, setPageInput] = useState(String(initialPage))
  const [totalCount, setTotalCount] = useState(initialTotalCount)
  const [errorMessage, setErrorMessage] = useState(initialError)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingAction, setLoadingAction] = useState<
    'next' | 'previous' | null
  >(null)
  const requestIdRef = useRef(0)
  const { timeZone } = useTimeZone()

  const totalPages = useMemo(() => {
    if (!totalCount || totalCount <= 0) {
      return null
    }
    return Math.ceil(totalCount / PAGE_SIZE)
  }, [totalCount])
  const hasPreviousPage = page > 1
  const hasNextPage = totalPages ? page < totalPages : captions.length === PAGE_SIZE
  const pageLabel = buildPageLabel(page, totalPages)

  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  const loadPage = async (
    nextPage: number,
    source?: 'next' | 'previous' | 'jump'
  ) => {
    if (isLoading || nextPage === page) {
      return
    }

    setIsLoading(true)
    setLoadingAction(source === 'next' || source === 'previous' ? source : null)
    setErrorMessage(null)
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    try {
      const response = await fetch(
        `/api/humor-flavor-captions?flavorId=${flavorId}&page=${nextPage}`,
        { cache: 'no-store' }
      )

      if (!response.ok) {
        throw new Error('Failed to fetch captions.')
      }

      const payload = (await response.json()) as {
        captions?: CaptionRow[]
        count?: number | null
        page?: number
      }

      if (requestIdRef.current !== requestId) {
        return
      }

      const resolvedPage =
        typeof payload.page === 'number' && Number.isFinite(payload.page)
          ? payload.page
          : nextPage
      setCaptions(Array.isArray(payload.captions) ? payload.captions : [])
      setPage(resolvedPage)
      setTotalCount(typeof payload.count === 'number' ? payload.count : null)
      updatePageUrl(resolvedPage)
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setErrorMessage('Unable to load captions right now.')
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false)
        setLoadingAction(null)
      }
    }
  }

  const handleGoToPage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isLoading) {
      return
    }

    const parsedPage = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(parsedPage)) {
      setPageInput(String(page))
      return
    }

    let nextPage = parsedPage
    if (nextPage < 1) {
      nextPage = 1
    }
    if (totalPages) {
      nextPage = Math.min(nextPage, totalPages)
    }

    setPageInput(String(nextPage))
    loadPage(nextPage, 'jump')
  }

  const handlePreviousClick = () => {
    loadPage(page - 1, 'previous')
  }

  const handleNextClick = () => {
    loadPage(page + 1, 'next')
  }

  const primaryButtonClasses =
    'inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--ink))] shadow-[0_16px_30px_-22px_rgb(var(--ink)/0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_36px_-24px_rgb(var(--ink)/0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] disabled:cursor-not-allowed disabled:opacity-70 dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--on-primary))]'
  const disabledButtonClasses =
    'inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.4)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))] shadow-[0_10px_20px_-16px_rgb(var(--ink)/0.2)] opacity-70 dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--ink)/0.5)]'
  const inputClasses =
    'w-20 rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--ink))] shadow-[0_12px_24px_-20px_rgb(var(--ink)/0.2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] disabled:cursor-not-allowed disabled:opacity-70 dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--on-primary))]'

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-start px-6 py-16">
      <div className="flex w-full flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl space-y-4">
          <Link
            href={`/humor-flavor/${flavorId}`}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
          >
            Back to flavor
          </Link>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Captions
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl md:text-5xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent drop-shadow-[0_6px_22px_rgb(var(--headline-accent-strong)/0.35)]">
              {flavorSlug}
            </span>
          </h1>
          <p className="text-base text-[rgb(var(--muted))] sm:text-lg">
            {flavorDescription ?? 'All captions tied to this flavor.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--accent))]">
            {totalCount ?? captions.length} captions
          </span>
          <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.7)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.4)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--muted))]">
            Page {pageLabel}
          </span>
        </div>
      </div>

      <section className="gloss-panel mt-10 rounded-[32px] border border-[rgb(var(--ambient-spot-3)/0.7)] bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.9),rgb(var(--ambient-spot-1)/0.5))] p-6 shadow-[0_30px_70px_-48px_rgb(var(--ambient-spot-2)/0.55)] backdrop-blur dark:border-[rgb(var(--ambient-spot-2)/0.2)] dark:bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.2),rgb(var(--ambient-base-3)/0.3))]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
              Flavor captions
            </p>
            <h2 className="mt-3 text-2xl font-semibold">
              Latest caption entries
            </h2>
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">
              Ordered by newest first with images attached to each caption.
            </p>
          </div>
        </div>

        {errorMessage ? (
          <p className="mt-4 text-sm text-[rgb(var(--muted))]">
            {errorMessage}
          </p>
        ) : captions.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {captions.map((caption) => {
              const image = Array.isArray(caption.image)
                ? caption.image[0] ?? null
                : caption.image
              const imageUrl = image?.url ?? null

              return (
                <Link
                  key={caption.id}
                  href={`/caption/${caption.id}`}
                  className="group rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-4 shadow-[0_18px_40px_-30px_rgb(var(--accent-strong)/0.35)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-28px_rgb(var(--accent-strong)/0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)]"
                  aria-label="View caption details"
                >
                  <div className="flex items-start gap-4">
                    <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] shadow-[0_12px_24px_-18px_rgb(var(--accent-strong)/0.45)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt="Caption image"
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgb(var(--ambient-orb-right-1)/0.3),rgb(var(--ambient-orb-bottom-1)/0.6))] text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))/0.8] dark:text-[rgb(var(--muted))/0.7]">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                        {formatDate(caption.created_datetime_utc, timeZone)}
                      </p>
                      <p className="mt-2 text-sm text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                        {caption.content ?? 'No caption text provided.'}
                      </p>
                      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-[rgb(var(--accent-strong))]">
                        {`${caption.caption_request_id ?? 'N/A'} <> ${
                          caption.llm_prompt_chain_id ?? 'N/A'
                        }`}
                      </p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-[rgb(var(--muted))]">
            No captions are available for this flavor yet.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {hasPreviousPage ? (
              <button
                type="button"
                onClick={handlePreviousClick}
                disabled={isLoading}
                className={primaryButtonClasses}
              >
                {loadingAction === 'previous' ? 'Loading' : 'Previous'}
              </button>
            ) : (
              <span className={disabledButtonClasses}>Previous</span>
            )}
            {hasNextPage ? (
              <button
                type="button"
                onClick={handleNextClick}
                disabled={isLoading}
                className={primaryButtonClasses}
              >
                {loadingAction === 'next' ? 'Loading' : 'Next'}
              </button>
            ) : null}
          </div>
          <form onSubmit={handleGoToPage} className="flex items-center gap-2">
            <label htmlFor="caption-page-input" className="sr-only">
              Go to page
            </label>
            <input
              id="caption-page-input"
              type="number"
              min={1}
              max={totalPages ?? undefined}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              className={inputClasses}
              inputMode="numeric"
              disabled={isLoading}
            />
            <button type="submit" className={primaryButtonClasses}>
              Go to page
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}
