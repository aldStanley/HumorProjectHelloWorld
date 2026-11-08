'use client'

import { useRouter } from 'next/navigation'
import BulkModelSelect, { type ModelChoice } from '@/components/bulk-model-select'
import { updateAllStepModelsAction } from './actions'

export default function BulkModelForm({ flavorId, models }: { flavorId: number; models: ModelChoice[] }) {
  const router = useRouter()
  return <BulkModelSelect models={models} description="Save one model for every step in this flavor. Existing results are kept. You can still change individual steps afterward." onApply={async (model) => {
    const result = await updateAllStepModelsAction({ flavorId, modelId: model.id })
    if (!result.ok) throw new Error(result.error)
    router.refresh()
  }} />
}
