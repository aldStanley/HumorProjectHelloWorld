'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'

type PromptTextareaProps = {
  id: string
  name: string
  label: string
  defaultValue?: string | null
  placeholder?: string
  overlayLabel?: string
  helperTitle?: string
  helperDescription?: string
  helperItems?: string[]
  helperButtonLabel?: string
  labelClassName?: string
  inputClassName?: string
}

export default function PromptTextarea({
  id,
  name,
  label,
  defaultValue,
  placeholder,
  overlayLabel,
  helperTitle,
  helperDescription,
  helperItems,
  helperButtonLabel,
  labelClassName,
  inputClassName,
}: PromptTextareaProps) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [isOpen, setIsOpen] = useState(false)
  const [isHelperOpen, setIsHelperOpen] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const inlineRef = useRef<HTMLTextAreaElement | null>(null)
  const overlayRef = useRef<HTMLTextAreaElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const helperButtonRef = useRef<HTMLButtonElement | null>(null)
  const helperCloseRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const helperTitleId = useId()
  const hasHelper = Boolean(helperItems?.length)
  const helperSummary =
    helperDescription ??
    'Paste these placeholders into the user prompt to inject dynamic data at runtime.'
  const helperLabel = helperButtonLabel ?? 'Prompt Variables'
  const isModalOpen = isOpen || isHelperOpen

  useEffect(() => {
    setValue(defaultValue ?? '')
  }, [defaultValue])

  useEffect(() => {
    setPortalRoot(document.body)
  }, [])

  useEffect(() => {
    if (!isModalOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isModalOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const timer = window.setTimeout(() => {
      overlayRef.current?.focus()
      const length = overlayRef.current?.value.length ?? 0
      overlayRef.current?.setSelectionRange(length, length)
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isHelperOpen) {
      return
    }

    const timer = window.setTimeout(() => {
      helperCloseRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isHelperOpen])

  const close = () => {
    setIsOpen(false)
    requestAnimationFrame(() => {
      buttonRef.current?.focus()
    })
  }

  const closeHelper = () => {
    setIsHelperOpen(false)
    requestAnimationFrame(() => {
      helperButtonRef.current?.focus()
    })
  }

  const openHelper = () => {
    setIsOpen(false)
    setIsHelperOpen(true)
  }

  const openFullScreen = () => {
    setIsHelperOpen(false)
    setIsOpen(true)
  }

  const handleOverlayKeyDown = (
    event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (isOpen) {
        close()
      }
      if (isHelperOpen) {
        closeHelper()
      }
    }
  }

  const modal = isOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.75)] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={close}
      onKeyDown={handleOverlayKeyDown}
    >
      <div
        className="flex h-[95vh] w-[95vw] flex-col rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.45)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.28),rgb(var(--primary)/0.14))]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p
              id={titleId}
              className="text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]"
            >
              {overlayLabel ?? label}
            </p>
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">
              Press escape or click Done to close.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] shadow-[0_18px_35px_-24px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-24px_rgb(var(--primary-deep)/0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.1)]"
          >
            Done
          </button>
        </div>
        <textarea
          ref={overlayRef}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleOverlayKeyDown}
          className="mt-4 min-h-0 w-full flex-1 rounded-[28px] border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.9)] px-4 py-3 text-sm text-[rgb(var(--ink))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] focus:border-[rgb(var(--primary)/0.6)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--primary)/0.35)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--shadow-strong)/0.9)] dark:text-[rgb(var(--ink)/0.95)] dark:focus:border-[rgb(var(--primary-bright)/0.5)] dark:focus:ring-[rgb(var(--primary-bright)/0.25)]"
        />
      </div>
    </div>
  ) : null

  const helperModal = isHelperOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.75)] px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={helperTitleId}
      onMouseDown={closeHelper}
      onKeyDown={handleOverlayKeyDown}
    >
      <div
        className="w-full max-w-2xl rounded-[28px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.45)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.28),rgb(var(--primary)/0.14))]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p
              id={helperTitleId}
              className="text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]"
            >
              {helperTitle ?? 'Prompt variables'}
            </p>
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">
              {helperSummary}
            </p>
          </div>
          <button
            ref={helperCloseRef}
            type="button"
            onClick={closeHelper}
            className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] shadow-[0_18px_35px_-24px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-24px_rgb(var(--primary-deep)/0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.1)]"
          >
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {(helperItems ?? []).map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.85)] px-4 py-3 text-sm text-[rgb(var(--ink))] shadow-[0_12px_26px_-20px_rgb(var(--primary-deep)/0.4)] backdrop-blur dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--ink)/0.9)]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[rgb(var(--muted))]">
                Variable
              </p>
              <p className="mt-2 font-mono text-sm">{item}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-[rgb(var(--muted))]">
          Keep the placeholders exactly as shown, including the {'${'}...{'}'}.
        </p>
      </div>
    </div>
  ) : null

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label
          className={labelClassName}
          htmlFor={id}
          id={`${id}-label`}
        >
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {hasHelper ? (
            <button
              ref={helperButtonRef}
              type="button"
              onClick={openHelper}
              className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--accent))]"
              aria-haspopup="dialog"
              aria-label={`${label} prompt variables`}
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
                <path d="M3 6h18" />
                <path d="M3 12h18" />
                <path d="M3 18h18" />
              </svg>
              <span>{helperLabel}</span>
            </button>
          ) : null}
          <button
            ref={buttonRef}
            type="button"
            onClick={openFullScreen}
            className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--accent))]"
            aria-label={`${label} full screen editor`}
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
              <path d="M4 9V4h5" />
              <path d="M20 15v5h-5" />
              <path d="M15 4h5v5" />
              <path d="M9 20H4v-5" />
            </svg>
            <span>Full Screen Editor</span>
          </button>
        </div>
      </div>
      <textarea
        ref={inlineRef}
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        className={inputClassName}
      />
      {portalRoot && (modal || helperModal)
        ? createPortal(
            <>
              {modal}
              {helperModal}
            </>,
            portalRoot
          )
        : null}
    </>
  )
}
