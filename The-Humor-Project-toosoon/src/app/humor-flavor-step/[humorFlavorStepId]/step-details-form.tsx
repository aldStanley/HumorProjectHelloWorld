'use client'

import {
  useActionState,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'

import PromptTextarea from '@/components/prompt-textarea'
import StepTypeListbox from '@/components/step-type-listbox'

import {
  updateHumorFlavorStep,
  type UpdateHumorFlavorStepState,
} from '../../humor-flavor/[humorFlavorId]/actions'

type StepOption = {
  id: number
  label: string
}

type StepDetailsFormProps = {
  stepId: number
  flavorId: number
  stepOrder: number
  maxStepOrder: number
  flavorSlug: string | null
  stepTypeId: number
  inputTypeId: number
  outputTypeId: number
  modelId: number
  temperature: number | null
  systemPrompt: string | null
  userPrompt: string | null
  description: string | null
  supportsTemperature: boolean
  stepTypeOptions: StepOption[]
  inputTypeOptions: StepOption[]
  outputTypeOptions: StepOption[]
  modelOptions: StepOption[]
  userPromptVariables: string[]
}

const successMessage = 'Your changes to this step have been saved!'

export default function StepDetailsForm({
  stepId,
  flavorId,
  stepOrder,
  maxStepOrder,
  flavorSlug,
  stepTypeId,
  inputTypeId,
  outputTypeId,
  modelId,
  temperature,
  systemPrompt,
  userPrompt,
  description,
  supportsTemperature,
  stepTypeOptions,
  inputTypeOptions,
  outputTypeOptions,
  modelOptions,
  userPromptVariables,
}: StepDetailsFormProps) {
  const [formState, formAction, isPending] = useActionState(
    updateHumorFlavorStep,
    {
      status: 'idle',
    } satisfies UpdateHumorFlavorStepState
  )
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    setPortalRoot(document.body)
  }, [])

  useEffect(() => {
    if (isPending) {
      setIsModalOpen(false)
    }
  }, [isPending])

  useEffect(() => {
    if (formState?.status === 'success') {
      setIsModalOpen(true)
    }
  }, [formState?.status, formState?.submittedAt])

  const closeModal = () => {
    setIsModalOpen(false)
  }

  const handleModalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeModal()
    }
  }

  const inputClasses =
    'w-full rounded-2xl border border-[rgb(var(--gloss)/0.8)] bg-[rgb(var(--panel)/0.9)] px-3 py-2 text-sm text-[rgb(var(--ink))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] transition focus:border-[rgb(var(--primary)/0.6)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--primary)/0.35)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--ink)/0.95)] dark:focus:border-[rgb(var(--primary-bright)/0.5)] dark:focus:ring-[rgb(var(--primary-bright)/0.25)]'
  const labelClasses =
    'text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--muted))]'
  const listboxButtonClasses = `${inputClasses} pr-10`
  const modalMessage = formState?.message ?? successMessage

  return (
    <>
      <form
        action={formAction}
        className="mt-5 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-4 shadow-[0_18px_40px_-28px_rgb(var(--primary-deep)/0.45)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.2)]"
      >
        <input type="hidden" name="stepId" value={stepId} />
        <input type="hidden" name="flavorId" value={flavorId} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
              Step {stepOrder}
            </p>
            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
              Flavor: {flavorSlug ?? 'Unknown'}
            </p>
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] shadow-[0_14px_28px_-22px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_30px_-22px_rgb(var(--primary-deep)/0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] disabled:cursor-not-allowed disabled:opacity-70 dark:border-[rgb(var(--gloss)/0.1)]"
          >
            Save step
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className={labelClasses} htmlFor="input-type">
              Input type
            </label>
            {inputTypeOptions.length ? (
              <StepTypeListbox
                id="input-type"
                name="llm_input_type_id"
                defaultValue={inputTypeId}
                options={inputTypeOptions}
                buttonClassName={listboxButtonClasses}
              />
            ) : (
              <>
                <input
                  type="hidden"
                  name="llm_input_type_id"
                  value={inputTypeId}
                />
                <div className="rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
                  Input types are unavailable right now.
                </div>
              </>
            )}
          </div>
          <div className="space-y-2">
            <label className={labelClasses} htmlFor="output-type">
              Output type
            </label>
            {outputTypeOptions.length ? (
              <StepTypeListbox
                id="output-type"
                name="llm_output_type_id"
                defaultValue={outputTypeId}
                options={outputTypeOptions}
                buttonClassName={listboxButtonClasses}
              />
            ) : (
              <>
                <input
                  type="hidden"
                  name="llm_output_type_id"
                  value={outputTypeId}
                />
                <div className="rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
                  Output types are unavailable right now.
                </div>
              </>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className={labelClasses} htmlFor="llm-model">
              LLM model
            </label>
            {modelOptions.length ? (
              <StepTypeListbox
                id="llm-model"
                name="llm_model_id"
                defaultValue={modelId}
                options={modelOptions}
                buttonClassName={listboxButtonClasses}
              />
            ) : (
              <>
                <input
                  type="hidden"
                  name="llm_model_id"
                  value={modelId}
                />
                <div className="rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
                  LLM models are unavailable right now.
                </div>
              </>
            )}
          </div>
          <div className="space-y-2">
            <label className={labelClasses} htmlFor="order">
              Order
            </label>
            <input
              id="order"
              name="order_by"
              type="number"
              min={1}
              max={maxStepOrder}
              defaultValue={stepOrder}
              className={inputClasses}
            />
          </div>
          <div className="space-y-2">
            <label className={labelClasses} htmlFor="temperature">
              Temperature
            </label>
            <input
              id="temperature"
              name="llm_temperature"
              type="number"
              step="0.05"
              min="0"
              max="2"
              defaultValue={temperature ?? ''}
              disabled={!supportsTemperature}
              className={`${inputClasses} disabled:cursor-not-allowed disabled:opacity-70`}
            />
            {!supportsTemperature ? (
              <p className="text-xs text-[rgb(var(--muted))]">
                Temperature is disabled for this model.
              </p>
            ) : null}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className={labelClasses} htmlFor="step-type">
              Step type
            </label>
            {stepTypeOptions.length ? (
              <StepTypeListbox
                id="step-type"
                name="humor_flavor_step_type_id"
                defaultValue={stepTypeId}
                options={stepTypeOptions}
                buttonClassName={listboxButtonClasses}
              />
            ) : (
              <>
                <input
                  type="hidden"
                  name="humor_flavor_step_type_id"
                  value={stepTypeId}
                />
                <div className="rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
                  Step types are unavailable right now.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="space-y-2 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
            <PromptTextarea
              id="system-prompt"
              name="llm_system_prompt"
              label="System prompt"
              defaultValue={systemPrompt ?? ''}
              placeholder="Write system-level instructions..."
              overlayLabel="System prompt"
              labelClassName={labelClasses}
              inputClassName={`${inputClasses} min-h-[180px] resize-y`}
            />
          </div>
          <div className="space-y-2 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
            <PromptTextarea
              id="user-prompt"
              name="llm_user_prompt"
              label="User prompt"
              defaultValue={userPrompt ?? ''}
              placeholder="Write user-facing instructions..."
              overlayLabel="User prompt"
              helperTitle="Prompt variables"
              helperDescription="Use these placeholders to pull in pipeline outputs, image details, and community context."
              helperItems={userPromptVariables}
              helperButtonLabel="Prompt Variables"
              labelClassName={labelClasses}
              inputClassName={`${inputClasses} min-h-[180px] resize-y`}
            />
          </div>
        </div>
        <div className="mt-4 space-y-2 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
          <label className={labelClasses} htmlFor="step-description">
            Step description
          </label>
          <textarea
            id="step-description"
            name="description"
            defaultValue={description ?? ''}
            placeholder="Add context about what this step should do..."
            className={`${inputClasses} min-h-[140px] resize-y`}
          />
        </div>
      </form>
      {portalRoot && isModalOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.75)] px-4 py-6 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onMouseDown={closeModal}
              onKeyDown={handleModalKeyDown}
            >
              <div
                className="w-full max-w-xl rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 text-center shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.45)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.28),rgb(var(--primary)/0.14))]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <p
                  id={titleId}
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]"
                >
                  Step updated
                </p>
                <p className="mt-4 text-lg font-semibold text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.95)]">
                  {modalMessage}
                </p>
                <button
                  type="button"
                  onClick={closeModal}
                  className="mt-6 inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.05)] dark:text-[rgb(var(--accent))]"
                >
                  Close
                </button>
              </div>
            </div>,
            portalRoot
          )
        : null}
    </>
  )
}
