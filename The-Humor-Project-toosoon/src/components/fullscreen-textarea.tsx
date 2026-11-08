'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'

type FullscreenTextareaProps = {
  id: string
  name: string
  defaultValue?: string | null
  className?: string
  placeholder?: string
  overlayLabel?: string
  variant?: 'inline' | 'button'
  triggerLabel?: string
  triggerClassName?: string
}

export default function FullscreenTextarea({
  id,
  name,
  defaultValue,
  className,
  placeholder,
  overlayLabel,
  variant = 'inline',
  triggerLabel = 'Edit',
  triggerClassName,
}: FullscreenTextareaProps) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [isOpen, setIsOpen] = useState(false)
  const inlineRef = useRef<HTMLTextAreaElement | null>(null)
  const overlayRef = useRef<HTMLTextAreaElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const ignoreFocusRef = useRef(false)
  const titleId = useId()

  useEffect(() => {
    setValue(defaultValue ?? '')
  }, [defaultValue])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const timer = window.setTimeout(() => {
      overlayRef.current?.focus()
      const length = overlayRef.current?.value.length ?? 0
      overlayRef.current?.setSelectionRange(length, length)
    }, 0)

    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  const close = () => {
    setIsOpen(false)
    if (variant === 'inline') {
      ignoreFocusRef.current = true
      requestAnimationFrame(() => {
        inlineRef.current?.focus()
      })
      return
    }

    requestAnimationFrame(() => {
      triggerRef.current?.focus()
    })
  }

  const handleInlineFocus = () => {
    if (ignoreFocusRef.current) {
      ignoreFocusRef.current = false
      return
    }
    setIsOpen(true)
  }

  const handleOverlayKeyDown = (
    event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <>
      {variant === 'inline' ? (
        <textarea
          ref={inlineRef}
          id={id}
          name={name}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onFocus={handleInlineFocus}
          className={className}
        />
      ) : (
        <>
          <textarea
            name={name}
            value={value}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
          />
          <button
            ref={triggerRef}
            id={id}
            type="button"
            onClick={() => setIsOpen(true)}
            className={triggerClassName ?? className}
          >
            {triggerLabel}
          </button>
        </>
      )}
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
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
                      {overlayLabel ?? 'Full screen editor'}
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
            </div>,
            document.body
          )
        : null}
    </>
  )
}
