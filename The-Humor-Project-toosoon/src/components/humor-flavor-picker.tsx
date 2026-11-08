'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { saveFlavorFavorite } from '@/app/humor-flavor/[humorFlavorId]/actions'

export type HumorFlavor = {
  id: number
  slug: string
  description: string | null
  created_datetime_utc?: string | null
  modified_datetime_utc?: string | null
  is_pinned?: boolean | null
  is_favorite?: boolean
  direction?: 'text-first' | 'image-first'
}

type HumorFlavorPickerProps = {
  flavors: HumorFlavor[]
  // When provided, clicking a card selects it (for the tool menu alongside)
  // instead of navigating to the flavor page.
  selectedId?: number | null
  onSelect?: (flavor: HumorFlavor) => void
}

type SortKey = 'newest' | 'edited' | 'alpha' | 'pinned' | 'favorites'

type KindFilter = 'all' | 'image-first' | 'text-first'

const KIND_OPTIONS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All kinds' },
  { key: 'image-first', label: '🖼 image-first' },
  { key: 'text-first', label: '📝 text-first' },
]

const isKindFilter = (v: unknown): v is KindFilter =>
  KIND_OPTIONS.some((o) => o.key === v)

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'edited', label: 'Recently edited' },
  { key: 'alpha', label: 'A–Z' },
  { key: 'pinned', label: 'Pinned first' },
  { key: 'favorites', label: 'Favorites first' },
]

const timeOf = (s?: string | null) => (s ? Date.parse(s) : 0)

// Search/sort/favorites-filter choices survive navigation and refresh.
const PICKER_STATE_KEY = 'flavor-picker-state'

const isSortKey = (v: unknown): v is SortKey =>
  SORT_OPTIONS.some((o) => o.key === v)

export default function HumorFlavorPicker({
  flavors,
  selectedId,
  onSelect,
}: HumorFlavorPickerProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [kind, setKind] = useState<KindFilter>('all')
  const [onlyFavorites, setOnlyFavorites] = useState(false)

  // Restore after mount (localStorage is unavailable during SSR); then mirror
  // every change back so the choices survive navigating away and refreshes.
  const [pickerStateLoaded, setPickerStateLoaded] = useState(false)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PICKER_STATE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as {
          query?: unknown
          sort?: unknown
          kind?: unknown
          onlyFavorites?: unknown
        }
        if (typeof saved.query === 'string') setQuery(saved.query)
        if (isSortKey(saved.sort)) setSort(saved.sort)
        if (isKindFilter(saved.kind)) setKind(saved.kind)
        if (typeof saved.onlyFavorites === 'boolean')
          setOnlyFavorites(saved.onlyFavorites)
      }
    } catch {
      // Corrupt/unavailable storage: fall back to defaults.
    }
    setPickerStateLoaded(true)
  }, [])
  useEffect(() => {
    if (!pickerStateLoaded) return
    try {
      window.localStorage.setItem(
        PICKER_STATE_KEY,
        JSON.stringify({ query, sort, kind, onlyFavorites })
      )
    } catch {
      // Best-effort only.
    }
  }, [pickerStateLoaded, query, sort, kind, onlyFavorites])

  // Hearts live in local state so toggles reflect instantly; seeded from the
  // server-fetched per-user favorites.
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(
    () => new Set(flavors.filter((f) => f.is_favorite).map((f) => f.id))
  )
  const [favoritePendingId, setFavoritePendingId] = useState<number | null>(null)

  const toggleFavorite = async (flavorId: number) => {
    const next = !favoriteIds.has(flavorId)
    setFavoriteIds((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(flavorId)
      else copy.delete(flavorId)
      return copy
    })
    setFavoritePendingId(flavorId)
    // Heart-only toggle: comment omitted so an existing comment is preserved.
    const res = await saveFlavorFavorite({ flavorId, isFavorite: next })
    setFavoritePendingId(null)
    if (!res.ok) {
      setFavoriteIds((prev) => {
        const copy = new Set(prev)
        if (next) copy.delete(flavorId)
        else copy.add(flavorId)
        return copy
      })
    }
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filteredFlavors = useMemo(() => {
    let matching = normalizedQuery
      ? flavors.filter((flavor) => {
          const slug = flavor.slug.toLowerCase()
          const description = flavor.description?.toLowerCase() ?? ''
          const direction = flavor.direction ?? ''
          return (
            slug.includes(normalizedQuery) ||
            description.includes(normalizedQuery) ||
            direction.includes(normalizedQuery)
          )
        })
      : [...flavors]

    if (kind !== 'all') {
      matching = matching.filter((flavor) => flavor.direction === kind)
    }

    if (onlyFavorites) {
      matching = matching.filter((flavor) => favoriteIds.has(flavor.id))
    }

    switch (sort) {
      case 'alpha':
        matching.sort((a, b) => a.slug.localeCompare(b.slug))
        break
      case 'edited':
        matching.sort(
          (a, b) => timeOf(b.modified_datetime_utc) - timeOf(a.modified_datetime_utc)
        )
        break
      case 'pinned':
        matching.sort(
          (a, b) =>
            Number(b.is_pinned ?? false) - Number(a.is_pinned ?? false) ||
            timeOf(b.created_datetime_utc) - timeOf(a.created_datetime_utc)
        )
        break
      case 'favorites':
        matching.sort(
          (a, b) =>
            Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)) ||
            timeOf(b.created_datetime_utc) - timeOf(a.created_datetime_utc)
        )
        break
      default:
        matching.sort(
          (a, b) => timeOf(b.created_datetime_utc) - timeOf(a.created_datetime_utc)
        )
    }
    return matching
  }, [flavors, normalizedQuery, sort, kind, onlyFavorites, favoriteIds])

  const handleSelect = (flavor: HumorFlavor) => {
    if (onSelect) {
      onSelect(flavor)
      return
    }
    router.push(`/humor-flavor/${flavor.id}`)
  }

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Pick a Humor Flavor</h2>

      {flavors.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <input
                id="humor-flavor-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or description"
                className="w-full rounded-md border border-[rgb(var(--ink)/0.2)] bg-white px-2.5 py-1.5 text-[13px] text-[rgb(var(--ink))] placeholder:text-[rgb(var(--muted))] focus:border-[rgb(var(--primary)/0.6)] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--primary)/0.35)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--ink)/0.95)] dark:placeholder:text-[rgb(var(--ink)/0.6)]"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-[rgb(var(--muted))] hover:text-[rgb(var(--ink))]"
                >
                  ✕
                </button>
              ) : null}
            </div>
            <select
              id="humor-flavor-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as KindFilter)}
              aria-label="Filter by kind"
              className="rounded-md border border-[rgb(var(--ink)/0.2)] bg-white px-2 py-1.5 text-[13px] text-[rgb(var(--ink))] focus:border-[rgb(var(--primary)/0.6)] focus:outline-none dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--ink)/0.95)]"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              id="humor-flavor-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="rounded-md border border-[rgb(var(--ink)/0.2)] bg-white px-2 py-1.5 text-[13px] text-[rgb(var(--ink))] focus:border-[rgb(var(--primary)/0.6)] focus:outline-none dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--ink)/0.95)]"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setOnlyFavorites((v) => !v)}
              aria-pressed={onlyFavorites}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[13px] transition ${
                onlyFavorites
                  ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.15)] text-[rgb(var(--accent-strong))]'
                  : 'border-[rgb(var(--ink)/0.2)] bg-white text-[rgb(var(--muted))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]'
              }`}
            >
              <span aria-hidden>{onlyFavorites ? '♥' : '♡'}</span>
              Favorites
            </button>
            <span className="text-xs text-[rgb(var(--muted))]">
              {filteredFlavors.length} of {flavors.length}
            </span>
          </div>

          {filteredFlavors.length ? (
            <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0">
              {filteredFlavors.map((flavor) => {
                const isSelected = flavor.id === selectedId
                const cardClasses = isSelected
                  ? 'border-[rgb(var(--accent-strong))] ring-1 ring-[rgb(var(--accent-strong))] bg-white text-[rgb(var(--ink))] shadow-sm dark:bg-[rgb(var(--panel)/0.15)] dark:text-[rgb(var(--ink)/0.95)]'
                  : 'border-[rgb(var(--ink)/0.15)] bg-white text-[rgb(var(--ink))] shadow-sm hover:border-[rgb(var(--ink)/0.3)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--ink)/0.95)]'

                const isFavorite = favoriteIds.has(flavor.id)

                return (
                  <div key={flavor.id} className="relative h-full">
                    <button
                      type="button"
                      onClick={() => handleSelect(flavor)}
                      className={`group flex h-full w-full flex-col justify-between gap-1.5 rounded-lg border p-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] ${cardClasses}`}
                    >
                      <span className="pr-6 text-[13px] font-medium leading-snug">
                        {flavor.is_pinned ? <span aria-hidden>📌 </span> : null}
                        {flavor.slug}
                      </span>
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                        {flavor.direction ? (
                          <span
                            className={
                              flavor.direction === 'text-first'
                                ? 'font-medium text-sky-700 dark:text-sky-300'
                                : 'font-medium text-emerald-700 dark:text-emerald-300'
                            }
                          >
                            {flavor.direction === 'text-first'
                              ? '📝 text-first'
                              : '🖼 image-first'}
                          </span>
                        ) : null}
                        {flavor.created_datetime_utc ? (
                          <span className="text-[rgb(var(--muted)/0.85)]">
                            {flavor.created_datetime_utc.slice(0, 10)}
                            {flavor.modified_datetime_utc &&
                            flavor.modified_datetime_utc.slice(0, 10) !==
                              flavor.created_datetime_utc.slice(0, 10)
                              ? ` · edited ${flavor.modified_datetime_utc.slice(0, 10)}`
                              : ''}
                          </span>
                        ) : null}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(flavor.id)}
                      disabled={favoritePendingId === flavor.id}
                      aria-pressed={isFavorite}
                      aria-label={
                        isFavorite
                          ? `Remove ${flavor.slug} from favorites`
                          : `Add ${flavor.slug} to favorites`
                      }
                      title={isFavorite ? 'Unfavorite' : 'Favorite'}
                      className={`absolute right-1.5 top-1.5 px-1 py-0.5 text-sm leading-none transition disabled:opacity-50 ${
                        isFavorite
                          ? 'text-[rgb(var(--accent-strong))]'
                          : 'text-[rgb(var(--muted)/0.6)] hover:text-[rgb(var(--accent-strong))]'
                      }`}
                    >
                      <span aria-hidden>{isFavorite ? '♥' : '♡'}</span>
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-[rgb(var(--muted))]">
              No flavors match that search yet.
            </p>
          )}

        </>
      ) : (
        <p className="text-sm text-[rgb(var(--muted))]">
          No humor flavors are available yet.
        </p>
      )}
    </div>
  )
}
