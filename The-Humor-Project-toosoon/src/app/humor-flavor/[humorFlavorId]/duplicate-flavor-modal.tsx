'use client'

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useFormStatus } from 'react-dom'

type DuplicateFlavorModalProps = {
  flavorId: number
  defaultSlug: string
  defaultDescription: string
  action: (
    state: { message: string },
    formData: FormData
  ) => Promise<{ message: string }>
  triggerClassName?: string
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] shadow-[0_18px_35px_-24px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-24px_rgb(var(--primary-deep)/0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] disabled:cursor-not-allowed disabled:opacity-70 dark:border-[rgb(var(--gloss)/0.1)]"
    >
      <span className="inline-flex items-center gap-2">
        {pending ? (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-[rgb(var(--gloss)/0.8)] border-t-transparent"
          />
        ) : null}
        <span>{pending ? 'Creating duplicate' : 'Create duplicate'}</span>
      </span>
    </button>
  )
}

export default function DuplicateFlavorModal({
  flavorId,
  defaultSlug,
  defaultDescription,
  action,
  triggerClassName,
}: DuplicateFlavorModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const slugRef = useRef<HTMLInputElement | null>(null)
  const titleId = useId()
  const [state, formAction] = useActionState(action, { message: '' })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const timer = window.setTimeout(() => {
      const input = slugRef.current
      if (!input) {
        return
      }
      input.focus()
      const length = input.value.length
      input.setSelectionRange(length, length)
    }, 0)

    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  const close = () => {
    setIsOpen(false)
  }

  const handleOverlayKeyDown = (
    event: KeyboardEvent<HTMLDivElement | HTMLFormElement>
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const inputClasses =
    'w-full rounded-2xl border border-[rgb(var(--gloss)/0.8)] bg-[rgb(var(--panel)/0.9)] px-3 py-2 text-sm text-[rgb(var(--ink))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] transition focus:border-[rgb(var(--primary)/0.6)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--primary)/0.35)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--ink)/0.95)] dark:focus:border-[rgb(var(--primary-bright)/0.5)] dark:focus:ring-[rgb(var(--primary-bright)/0.25)]'
  const labelClasses =
    'text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--muted))]'

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          triggerClassName ??
          'inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] shadow-[0_18px_35px_-24px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-24px_rgb(var(--primary-deep)/0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.1)]'
        }
      >
        Duplicate
      </button>
      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.75)] px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onMouseDown={close}
          onKeyDown={handleOverlayKeyDown}
        >
          <div
            className="w-full max-w-2xl rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.45)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.28),rgb(var(--primary)/0.14))]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p
                  id={titleId}
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]"
                >
                  Duplicate
                </p>
                <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                  Choose a new slug and description for the copy.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--primary-deep))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--primary-bright))]"
              >
                Close
              </button>
            </div>
            <form
              action={formAction}
              className="mt-6 grid gap-4"
              onKeyDown={handleOverlayKeyDown}
            >
              <input type="hidden" name="flavorId" value={flavorId} />
              <div className="space-y-2">
                <label htmlFor="duplicate-slug" className={labelClasses}>
                  Slug
                </label>
                <input
                  ref={slugRef}
                  id="duplicate-slug"
                  name="slug"
                  required
                  defaultValue={defaultSlug}
                  className={inputClasses}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="duplicate-description" className={labelClasses}>
                  Description
                </label>
                <textarea
                  id="duplicate-description"
                  name="description"
                  defaultValue={defaultDescription}
                  className={`${inputClasses} min-h-[96px] resize-y`}
                />
              </div>
              {state.message ? (
                <p
                  aria-live="polite"
                  className="rounded-2xl border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--accent)/0.12)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--accent-strong))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--accent)/0.25)] dark:bg-[rgb(var(--accent-strong)/0.18)] dark:text-[rgb(var(--accent))]"
                >
                  {state.message}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--primary-deep))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--primary-bright))]"
                >
                  Cancel
                </button>
                <SubmitButton />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
