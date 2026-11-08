// The joke evaluator prompts in docs/prompts/evaluators/: one folder per
// persona, named like the persona's folder in docs/prompts/personas/
// (07-sad-girl), holding dated versions. A persona with no folder here has
// no scoring step.
import { loadVersionedPrompts, type VersionedPrompt } from './versioned-prompts'

export const EVALUATOR_PROMPT_DIR = 'docs/prompts/evaluators'

export type EvaluatorPrompt = VersionedPrompt & {
  // The persona folder this evaluator belongs to, e.g. "07-sad-girl".
  personaFolder: string
}

export async function loadEvaluatorPrompts(): Promise<EvaluatorPrompt[]> {
  const prompts = await loadVersionedPrompts(EVALUATOR_PROMPT_DIR)
  return prompts.map((p) => ({ ...p, personaFolder: p.folder }))
}
