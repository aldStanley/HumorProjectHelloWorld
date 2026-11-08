// Runs one flavor step with a fresh auth cookie.
//
// Step calls take a minute or more and run three at a time, so a batch can
// straddle the hour at which the Supabase access token expires. The refresh
// that fixes the cookie only reaches the browser on a response, and a step
// call's response is a minute away; every call started in that minute still
// carries the old, already-rotated refresh token, which Supabase rejects
// after ten seconds. That surfaced as "You must be signed in to run a step"
// on the fourth of six moments. The fix is to refresh through a call that
// returns at once, right before the long one, and to retry once if the long
// one still comes back unauthenticated.
import {
  runStepAction,
  touchSessionAction,
  type RunStepInput,
  type RunStepResult,
} from '../chiltrix/actions'

const isSignedOut = (res: RunStepResult): boolean =>
  !res.ok && /signed in/i.test(res.error ?? '')

export async function runStepWithSession(
  input: RunStepInput
): Promise<RunStepResult> {
  await touchSessionAction().catch(() => undefined)
  let res = await runStepAction(input)
  if (isSignedOut(res)) {
    await touchSessionAction().catch(() => undefined)
    res = await runStepAction(input)
  }
  return res
}
