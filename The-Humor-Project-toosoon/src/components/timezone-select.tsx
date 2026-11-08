'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { useTimeZone } from '@/components/timezone-context'

const formatOptionId = (listboxId: string, index: number) =>
  `${listboxId}-option-${index}`

export default function TimezoneSelect() {
  const { timeZone, timeZoneOptions, setTimeZone } = useTimeZone()
  const [query, setQuery] = useState(timeZone)
  const [isOpen, setIsOpen] = useState(false)
  const [hasTypedSinceOpen, setHasTypedSinceOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputId = useId()
  const listboxId = useId()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setQuery(timeZone)
  }, [timeZone])

  const filteredOptions = useMemo(() => {
    const normalized = hasTypedSinceOpen ? query.trim().toLowerCase() : ''
    if (!normalized) {
      return timeZoneOptions
    }
    return timeZoneOptions.filter((zone) =>
      zone.toLowerCase().includes(normalized)
    )
  }, [hasTypedSinceOpen, query, timeZoneOptions])

  useEffect(() => {
    if (isOpen) {
      setHasTypedSinceOpen(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    if (filteredOptions.length === 0) {
      setHighlightedIndex(0)
      return
    }

    const selectedIndex = filteredOptions.findIndex((zone) => zone === timeZone)
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [filteredOptions, isOpen, timeZone])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current) {
        return
      }

      if (wrapperRef.current.contains(event.target as Node)) {
        return
      }

      setIsOpen(false)
      setQuery(timeZone)
    }

    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
        setQuery(timeZone)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleDocumentKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleDocumentKeyDown)
    }
  }, [isOpen, timeZone])

  const handleSelect = (zone: string) => {
    setTimeZone(zone)
    setQuery(zone)
    setIsOpen(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredOptions.length === 0) {
        return
      }
      if (!isOpen) {
        setIsOpen(true)
        setHasTypedSinceOpen(false)
        setHighlightedIndex(0)
        return
      }
      setHighlightedIndex((prev) => (prev + 1) % filteredOptions.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredOptions.length === 0) {
        return
      }
      if (!isOpen) {
        setIsOpen(true)
        setHasTypedSinceOpen(false)
        setHighlightedIndex(filteredOptions.length - 1)
        return
      }
      setHighlightedIndex(
        (prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length
      )
      return
    }

    if (event.key === 'Enter') {
      if (filteredOptions.length === 0) {
        return
      }
      event.preventDefault()
      const zone = filteredOptions[highlightedIndex] ?? filteredOptions[0]
      handleSelect(zone)
      return
    }

    if (event.key === 'Tab') {
      setIsOpen(false)
      setQuery(timeZone)
    }
  }

  const activeDescendant =
    isOpen && filteredOptions[highlightedIndex]
      ? formatOptionId(listboxId, highlightedIndex)
      : undefined

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="sr-only">
        Timezone
      </label>
      <div className="flex h-8 w-48 items-center gap-2 rounded-full border border-[rgb(var(--muted)/0.4)] bg-[rgb(var(--panel)/0.85)] px-3 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[rgb(var(--accent-strong))] dark:bg-[rgb(var(--panel)/0.1)]">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHasTypedSinceOpen(true)
            setIsOpen(true)
            setHighlightedIndex(0)
          }}
          onFocus={(event) => {
            event.target.select()
            setIsOpen(true)
            setHasTypedSinceOpen(false)
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-[10px] font-semibold tracking-[0.18em] text-[rgb(var(--ink))] placeholder:text-[rgb(var(--muted))] focus:outline-none dark:text-[rgb(var(--on-primary))]"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          placeholder="Timezone"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          aria-label="Toggle timezone list"
          onClick={() => {
            setIsOpen((prev) => {
              if (!prev) {
                setHasTypedSinceOpen(false)
              }
              return !prev
            })
            inputRef.current?.focus()
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 8l4 4 4-4" />
          </svg>
        </button>
      </div>

      {isOpen ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-labelledby={inputId}
          className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.95)] p-1 text-[10px] font-semibold tracking-[0.16em] text-[rgb(var(--ink))] shadow-[0_24px_45px_-36px_rgb(var(--shadow)/0.45)] backdrop-blur dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--shadow-strong)/0.95)] dark:text-[rgb(var(--ink)/0.9)]"
        >
          {filteredOptions.length ? (
            filteredOptions.map((zone, index) => {
              const isSelected = zone === timeZone
              const isActive = index === highlightedIndex
              let optionClasses =
                'w-full rounded-xl px-3 py-2 text-left transition'

              if (isSelected) {
                optionClasses +=
                  ' bg-[rgb(var(--accent-strong))] text-[rgb(var(--on-primary))]'
              } else if (isActive) {
                optionClasses +=
                  ' bg-[rgb(var(--primary)/0.15)] text-[rgb(var(--ink))] dark:bg-[rgb(var(--panel)/0.2)]'
              } else {
                optionClasses +=
                  ' hover:bg-[rgb(var(--primary)/0.12)] dark:hover:bg-[rgb(var(--panel)/0.1)]'
              }

              return (
                <li key={zone}>
                  <button
                    id={formatOptionId(listboxId, index)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(zone)}
                    className={optionClasses}
                  >
                    {zone}
                  </button>
                </li>
              )
            })
          ) : (
            <li className="px-3 py-2 text-[rgb(var(--muted))]">
              No matches found.
            </li>
          )}
        </ul>
      ) : null}
    </div>
  )
}
