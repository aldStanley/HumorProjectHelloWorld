'use client'

import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

import StepPromptModal from './step-prompt-modal'

type StepSummary = {
  id: number
  order: number
  stepTypeLabel: string
  description: string | null
  descriptionPreview: string | null
  systemPrompt: string | null
  userPrompt: string | null
}

type HumorFlavorStepListProps = {
  flavorId: number
  steps: StepSummary[]
  reorderAction: (formData: FormData) => void
  deleteAction: (formData: FormData) => void
}

type ConfirmDeleteModalProps = {
  stepId: number
  stepLabel: string
  stepDescription: string | null
  onConfirmDelete: () => void
}

function ConfirmDeleteModal({
  stepId,
  stepLabel,
  stepDescription,
  onConfirmDelete,
}: ConfirmDeleteModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionValue = stepDescription?.trim()

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

  const modal = isOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.75)] px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={close}
    >
      <div
        className="w-full max-w-lg rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.45)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.28),rgb(var(--primary)/0.14))]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p
              id={titleId}
              className="text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]"
            >
              Delete step
            </p>
            <p className="mt-2 text-base font-semibold text-[rgb(var(--ink))]">
              Remove {stepLabel}?
            </p>
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">
              This will delete the step and reindex the steps that follow.
            </p>
            {descriptionValue ? (
              <div className="mt-4 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.85)] p-4 text-sm text-[rgb(var(--ink))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--shadow-strong)/0.85)] dark:text-[rgb(var(--ink)/0.9)]">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--muted))]">
                  Description
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {descriptionValue}
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--accent))]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirmDelete()
              close()
            }}
            className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--accent-strong)),rgb(var(--accent)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-[0_18px_35px_-24px_rgb(var(--accent-strong)/0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-24px_rgb(var(--accent-strong)/0.75)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
          >
            Delete step
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        type="button"
        draggable={false}
        aria-label={`Delete ${stepLabel}`}
        onClick={(event) => {
          event.stopPropagation()
          setIsOpen(true)
        }}
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
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </button>
      {portalRoot && modal ? createPortal(modal, portalRoot) : null}
    </>
  )
}

const reorderSteps = (
  steps: StepSummary[],
  sourceId: number,
  targetId: number
) => {
  const fromIndex = steps.findIndex((step) => step.id === sourceId)
  const toIndex = steps.findIndex((step) => step.id === targetId)

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return steps
  }

  const next = [...steps]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)

  return next.map((step, index) => ({
    ...step,
    order: index + 1,
  }))
}

export default function HumorFlavorStepList({
  flavorId,
  steps,
  reorderAction,
  deleteAction,
}: HumorFlavorStepListProps) {
  const [orderedSteps, setOrderedSteps] = useState(() =>
    [...steps].sort((a, b) => a.order - b.order)
  )
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const formId = useId()
  const reorderSubmitRef = useRef<HTMLButtonElement | null>(null)
  const deleteSubmitRef = useRef<HTMLButtonElement | null>(null)
  const orderInputRef = useRef<HTMLInputElement | null>(null)
  const deleteInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    setOrderedSteps([...steps].sort((a, b) => a.order - b.order))
  }, [steps])

  useEffect(() => {
    if (!orderInputRef.current) {
      return
    }

    orderInputRef.current.value = JSON.stringify(
      orderedSteps.map((step) => step.id)
    )
  }, [orderedSteps])

  const persistOrder = (nextSteps: StepSummary[]) => {
    if (!orderInputRef.current) {
      return
    }

    orderInputRef.current.value = JSON.stringify(
      nextSteps.map((step) => step.id)
    )
    if (formRef.current && reorderSubmitRef.current) {
      formRef.current.requestSubmit(reorderSubmitRef.current)
      return
    }

    formRef.current?.requestSubmit()
  }

  const submitDelete = (stepId: number) => {
    if (!formRef.current || !deleteInputRef.current) {
      return
    }

    deleteInputRef.current.value = String(stepId)
    if (deleteSubmitRef.current) {
      formRef.current.requestSubmit(deleteSubmitRef.current)
      return
    }

    formRef.current.requestSubmit()
  }

  const handleDrop = (targetId: number) => (event: DragEvent) => {
    event.preventDefault()
    const payload = event.dataTransfer.getData('text/plain')
    const sourceId = Number.parseInt(payload, 10)
    const resolvedSourceId = Number.isFinite(sourceId) ? sourceId : draggedId

    if (!resolvedSourceId || resolvedSourceId === targetId) {
      return
    }

    const next = reorderSteps(orderedSteps, resolvedSourceId, targetId)

    if (next === orderedSteps) {
      return
    }

    setOrderedSteps(next)
    persistOrder(next)
    setDraggedId(null)
    setDragOverId(null)
  }

  return (
    <form
      ref={formRef}
      id={formId}
      action={reorderAction}
      className="mt-5 space-y-3"
    >
      <input type="hidden" name="flavorId" value={flavorId} />
      <input
        ref={deleteInputRef}
        type="hidden"
        name="deleteStepId"
        defaultValue=""
      />
      <input
        ref={orderInputRef}
        type="hidden"
        name="stepOrder"
        defaultValue={JSON.stringify(orderedSteps.map((step) => step.id))}
      />
      <button
        ref={reorderSubmitRef}
        type="submit"
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
      />
      <button
        ref={deleteSubmitRef}
        type="submit"
        tabIndex={-1}
        aria-hidden="true"
        formAction={deleteAction}
        className="hidden"
      />
      {orderedSteps.map((step, index) => {
        const displayOrder = index + 1
        const isDragOver = dragOverId === step.id
        const isDragging = draggedId === step.id
        const cardClasses = isDragOver
          ? 'border-[rgb(var(--primary)/0.4)] bg-[linear-gradient(135deg,rgb(var(--primary-bright)/0.35),rgb(var(--primary)/0.2))]'
          : 'border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)]'

        return (
          <div
            key={step.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(step.id))
              setDraggedId(step.id)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              if (dragOverId !== step.id) {
                setDragOverId(step.id)
              }
            }}
            onDragLeave={() => {
              if (dragOverId === step.id) {
                setDragOverId(null)
              }
            }}
            onDrop={handleDrop(step.id)}
            onDragEnd={() => {
              setDraggedId(null)
              setDragOverId(null)
            }}
            className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left shadow-[0_18px_40px_-28px_rgb(var(--primary-deep)/0.45)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_45px_-36px_rgb(var(--primary-deep)/0.55)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] ${cardClasses} ${isDragging ? 'opacity-70' : ''} dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]`}
          >
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--accent))]">
                Step {displayOrder}
              </span>
              <p className="text-sm font-semibold text-[rgb(var(--ink))]">
                {step.stepTypeLabel}
                {step.descriptionPreview ? (
                  <span className="ml-2 text-xs font-normal text-[rgb(var(--muted))]">
                    - {step.descriptionPreview}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StepPromptModal
                stepLabel={`Step ${displayOrder} · ${step.stepTypeLabel}`}
                systemPrompt={step.systemPrompt}
                userPrompt={step.userPrompt}
              />
              <Link
                href={`/humor-flavor-step/${step.id}`}
                draggable={false}
                aria-label={`Edit ${step.stepTypeLabel}`}
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
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </Link>
              <ConfirmDeleteModal
                stepId={step.id}
                stepLabel={step.stepTypeLabel}
                stepDescription={step.description}
                onConfirmDelete={() => submitDelete(step.id)}
              />
            </div>
          </div>
        )
      })}
    </form>
  )
}
