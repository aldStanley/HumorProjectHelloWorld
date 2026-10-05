import { isSameOrigin } from "@/lib/captions/request";
import { createClient } from "@/lib/supabase/server";
import { UUID } from "@/lib/captions/validation";

const fail = (error: string, status: number) => Response.json({ error }, { status });
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail("Invalid request origin.", 403);
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail("Sign in to vote.", 401);
  let payload;
  try { payload = await request.json(); } catch { return fail("Invalid vote.", 400); }
  if (!payload || typeof payload.captionId !== "string" || !UUID.test(payload.captionId) || ![-1, 1].includes(payload.value)) return fail("Choose an upvote or a downvote.", 400);
  // First vote creates a row. A changed vote edits only this user's existing value.
  const { error } = await client.from("caption_votes").upsert({ caption_id: payload.captionId, user_id: user.id, value: payload.value }, { onConflict: "caption_id,user_id", ignoreDuplicates: true });
  if (error) return fail(error.code === "23503" ? "This caption no longer exists." : "Your vote could not be saved.", error.code === "23503" ? 404 : 500);
  const { error: updateError } = await client.from("caption_votes").update({ value: payload.value }).eq("caption_id", payload.captionId).eq("user_id", user.id);
  if (updateError) return fail("Your vote could not be saved.", 500);
  const { data: scores, error: scoreError } = await client.rpc("caption_scores", { caption_ids: [payload.captionId] });
  return Response.json({ value: payload.value, score: scoreError ? null : Number(scores?.[0]?.score ?? 0) }, { headers: { "Cache-Control": "no-store" } });
}
