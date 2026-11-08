'use client'

import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

type StepPromptModalProps = {
  stepLabel: string
  systemPrompt: string | null
  userPrompt: string | null
}

export default function StepPromptModal({
  stepLabel,
  systemPrompt,
  userPrompt,
}: StepPromptModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    setPortalRoot(document.body)
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  const close = () => {
    setIsOpen(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const systemValue = systemPrompt?.trim()
  const userValue = userPrompt?.trim()

  const modal = isOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.75)] px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={close}
      onKeyDown={handleKeyDown}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.45)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.28),rgb(var(--primary)/0.14))]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p
              id={titleId}
              className="text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]"
            >
              {stepLabel}
            </p>
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">
              System and user prompts for this step.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--accent))]"
          >
            Close
          </button>
        </div>
        <div className="mt-6 grid min-h-0 flex-1 gap-4 overflow-y-auto pr-2">
          <div className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.9)] p-4 text-sm text-[rgb(var(--ink))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--shadow-strong)/0.9)] dark:text-[rgb(var(--ink)/0.9)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--muted))]">
              System prompt
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm">
              {systemValue ?? 'No system prompt yet.'}
            </p>
          </div>
          <div className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.9)] p-4 text-sm text-[rgb(var(--ink))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--shadow-strong)/0.9)] dark:text-[rgb(var(--ink)/0.9)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--muted))]">
              User prompt
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm">
              {userValue ?? 'No user prompt yet.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setIsOpen(true)
        }}
        draggable={false}
        aria-label={`View prompts for ${stepLabel}`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--accent))]"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {portalRoot && modal ? createPortal(modal, portalRoot) : null}
    </>
  )
}
