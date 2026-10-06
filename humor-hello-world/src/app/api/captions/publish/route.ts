import { isSameOrigin } from "@/lib/captions/request";
import { UUID } from "@/lib/captions/validation";
import { createClient } from "@/lib/supabase/server";
const reply = (body: object, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return reply({ error: "Invalid request origin." }, 403);
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return reply({ error: "Sign in to publish your joke." }, 401);
  let body;
  try { body = await request.json(); } catch { return reply({ error: "Invalid selection." }, 400); }
  if (!body || typeof body.imageId !== "string" || !UUID.test(body.imageId) || typeof body.text !== "string" || !body.text.trim() || body.text.trim().length > 240) return reply({ error: "Choose a joke or write 1–240 characters." }, 400);
  const { data, error } = await client.rpc("publish_selected_caption", { target_id: body.imageId, selected_text: body.text.trim() });
  if (error) return reply({ error: "Could not publish this selection. Try again, or refresh if it was already published." }, 409);
  return reply({ captionId: data }, 201);
}
