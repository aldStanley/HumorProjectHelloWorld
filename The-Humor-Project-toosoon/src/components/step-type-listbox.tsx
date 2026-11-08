'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'

type StepTypeOption = {
  id: number
  label: string
}

type StepTypeListboxProps = {
  id: string
  name: string
  defaultValue: number
  options: StepTypeOption[]
  buttonClassName: string
  onChange?: (optionId: number) => void
}

export default function StepTypeListbox({
  id,
  name,
  defaultValue,
  options,
  buttonClassName,
  onChange,
}: StepTypeListboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(() => {
    const match = options.find((option) => option.id === defaultValue)
    return match?.id ?? options[0]?.id ?? defaultValue
  })
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const listboxId = useId()

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
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    const match = options.find((option) => option.id === defaultValue)
    setSelectedId(match?.id ?? options[0]?.id ?? defaultValue)
  }, [defaultValue, options])

  const selectedOption = useMemo(
    () => options.find((option) => option.id === selectedId) ?? options[0],
    [options, selectedId]
  )

  const handleSelect = (optionId: number) => {
    setSelectedId(optionId)
    setIsOpen(false)
    onChange?.(optionId)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input type="hidden" name={name} value={selectedId} />
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`${buttonClassName} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">
          {selectedOption?.label ?? 'Select a step type'}
        </span>
        <span className="text-[rgb(var(--muted))]">
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
        </span>
      </button>
      {isOpen ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-labelledby={id}
          className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.95)] p-1 text-sm shadow-[0_24px_45px_-36px_rgb(var(--shadow)/0.45)] backdrop-blur dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--shadow-strong)/0.95)]"
        >
          {options.map((option) => {
            const isSelected = option.id === selectedId
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.id)}
                  className={`w-full rounded-xl px-3 py-2 text-left transition ${
                    isSelected
                      ? 'bg-[rgb(var(--accent-strong))] text-[rgb(var(--on-primary))]'
                      : 'text-[rgb(var(--ink))] hover:bg-[rgb(var(--primary)/0.12)] dark:text-[rgb(var(--ink)/0.9)] dark:hover:bg-[rgb(var(--panel)/0.1)]'
                  }`}
                >
                  {option.label}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
