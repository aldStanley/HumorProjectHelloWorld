// The moment analysis prompts in docs/prompts/analyses/: one folder per
// analysis, dated versions inside. The page knows the "student-read" folder:
// it runs once per selected moment with {{EVENT}} filled.
import { loadVersionedPrompts, type VersionedPrompt } from './versioned-prompts'

export const ANALYSIS_PROMPT_DIR = 'docs/prompts/analyses'
export const STUDENT_READ_FOLDER = 'student-read'
// The catalog of comic moves, {{COMIC_MOVES}} in a flavor's analyzer (step
// 3) and refiner (step 4). Never sent to the joke writer.
export const COMIC_MOVES_FOLDER = 'comic-moves'

export type AnalysisPrompt = VersionedPrompt

export async function loadStudentReadPrompt(): Promise<AnalysisPrompt | null> {
  const prompts = await loadVersionedPrompts(ANALYSIS_PROMPT_DIR)
  return prompts.find((p) => p.folder === STUDENT_READ_FOLDER) ?? null
}

export async function loadComicMovesPrompt(): Promise<AnalysisPrompt | null> {
  const prompts = await loadVersionedPrompts(ANALYSIS_PROMPT_DIR)
  return prompts.find((p) => p.folder === COMIC_MOVES_FOLDER) ?? null
}
