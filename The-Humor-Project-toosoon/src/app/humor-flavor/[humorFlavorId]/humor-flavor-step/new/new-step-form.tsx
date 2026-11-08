'use client'

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import PromptTextarea from '@/components/prompt-textarea'
import StepTypeListbox from '@/components/step-type-listbox'

type Option = {
  id: number
  label: string
}

type ModelOption = Option & {
  isTemperatureSupported: boolean
}

type NewHumorFlavorStepFormProps = {
  flavorId: number
  action: (formData: FormData) => void
  stepTypeOptions: Option[]
  inputTypeOptions: Option[]
  outputTypeOptions: Option[]
  modelOptions: ModelOption[]
  defaultStepTypeId: number | null
  defaultInputTypeId: number | null
  defaultOutputTypeId: number | null
  defaultModelId: number | null
  inputClassName: string
  labelClassName: string
  listboxButtonClassName: string
  userPromptVariables: string[]
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  const isDisabled = disabled || pending

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="inline-flex items-center justify-center rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] shadow-[0_14px_28px_-22px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_30px_-22px_rgb(var(--primary-deep)/0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] disabled:cursor-not-allowed disabled:opacity-70 dark:border-[rgb(var(--gloss)/0.1)]"
    >
      {pending ? 'Adding step' : 'Add step'}
    </button>
  )
}

export default function NewHumorFlavorStepForm({
  flavorId,
  action,
  stepTypeOptions,
  inputTypeOptions,
  outputTypeOptions,
  modelOptions,
  defaultStepTypeId,
  defaultInputTypeId,
  defaultOutputTypeId,
  defaultModelId,
  inputClassName,
  labelClassName,
  listboxButtonClassName,
  userPromptVariables,
}: NewHumorFlavorStepFormProps) {
  const [selectedModelId, setSelectedModelId] = useState(
    defaultModelId ?? modelOptions[0]?.id ?? 0
  )

  const supportsTemperature = useMemo(() => {
    return (
      modelOptions.find((model) => model.id === selectedModelId)
        ?.isTemperatureSupported ?? false
    )
  }, [modelOptions, selectedModelId])

  const canSubmit =
    stepTypeOptions.length > 0 &&
    inputTypeOptions.length > 0 &&
    outputTypeOptions.length > 0 &&
    modelOptions.length > 0

  return (
    <form
      action={action}
      className="mt-5 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-4 shadow-[0_18px_40px_-28px_rgb(var(--primary-deep)/0.45)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.2)]"
    >
      <input type="hidden" name="flavorId" value={flavorId} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
            New step
          </p>
          <p className="mt-1 text-xs text-[rgb(var(--muted))]">
            Add a step to this flavor pipeline.
          </p>
        </div>
        <SubmitButton disabled={!canSubmit} />
      </div>

      {!canSubmit ? (
        <p className="mt-4 text-sm text-[rgb(var(--muted))]">
          Step, model, and input/output types must be available to add a new
          step.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="input-type">
            Input type
          </label>
          {inputTypeOptions.length ? (
            <StepTypeListbox
              id="input-type"
              name="llm_input_type_id"
              defaultValue={defaultInputTypeId ?? inputTypeOptions[0].id}
              options={inputTypeOptions}
              buttonClassName={listboxButtonClassName}
            />
          ) : (
            <div className="rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
              Input types are unavailable right now.
            </div>
          )}
        </div>
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="output-type">
            Output type
          </label>
          {outputTypeOptions.length ? (
            <StepTypeListbox
              id="output-type"
              name="llm_output_type_id"
              defaultValue={defaultOutputTypeId ?? outputTypeOptions[0].id}
              options={outputTypeOptions}
              buttonClassName={listboxButtonClassName}
            />
          ) : (
            <div className="rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
              Output types are unavailable right now.
            </div>
          )}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <label className={labelClassName} htmlFor="llm-model">
            LLM model
          </label>
          {modelOptions.length ? (
            <StepTypeListbox
              id="llm-model"
              name="llm_model_id"
              defaultValue={defaultModelId ?? modelOptions[0].id}
              options={modelOptions}
              buttonClassName={listboxButtonClassName}
              onChange={setSelectedModelId}
            />
          ) : (
            <div className="rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
              LLM models are unavailable right now.
            </div>
          )}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <label className={labelClassName} htmlFor="step-type">
            Step type
          </label>
          {stepTypeOptions.length ? (
            <StepTypeListbox
              id="step-type"
              name="humor_flavor_step_type_id"
              defaultValue={defaultStepTypeId ?? stepTypeOptions[0].id}
              options={stepTypeOptions}
              buttonClassName={listboxButtonClassName}
            />
          ) : (
            <div className="rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
              Step types are unavailable right now.
            </div>
          )}
        </div>
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="temperature">
            Temperature
          </label>
          <input
            id="temperature"
            name="llm_temperature"
            type="number"
            step="0.05"
            min="0"
            max="2"
            defaultValue=""
            disabled={!supportsTemperature}
            className={`${inputClassName} disabled:cursor-not-allowed disabled:opacity-70`}
          />
          {!supportsTemperature ? (
            <p className="text-xs text-[rgb(var(--muted))]">
              Temperature is disabled for this model.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-2 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
          <PromptTextarea
            id="system-prompt"
            name="llm_system_prompt"
            label="System prompt"
            placeholder="Write system-level instructions..."
            overlayLabel="System prompt"
            labelClassName={labelClassName}
            inputClassName={`${inputClassName} min-h-[180px] resize-y`}
          />
        </div>
        <div className="space-y-2 rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)]">
          <PromptTextarea
            id="user-prompt"
            name="llm_user_prompt"
            label="User prompt"
            placeholder="Write user-facing instructions..."
            overlayLabel="User prompt"
            helperTitle="Prompt variables"
            helperDescription="Use these placeholders to pull in pipeline outputs, image details, and community context."
            helperItems={userPromptVariables}
            helperButtonLabel="Prompt Variables"
            labelClassName={labelClassName}
            inputClassName={`${inputClassName} min-h-[180px] resize-y`}
          />
        </div>
      </div>
    </form>
  )
}
