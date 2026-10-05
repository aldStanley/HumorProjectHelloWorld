import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/captions/request";
import { validateBallot } from "@/lib/jury/types";

function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return reply({ error: "Invalid request origin." }, 403);
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return reply({ error: "Sign in to join the jury." }, 401);
  if (Number(request.headers.get("content-length")) > 4096) return reply({ error: "Invalid ballot." }, 413);
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: "Invalid ballot." }, 400); }
  if (!validateBallot(body)) return reply({ error: "Rate all five captions and choose your pick to win." }, 400);
  const { error } = await client.rpc("submit_jury_ballot", { target_day: body.roundDay, new_ratings: body.ratings, winner_pick: body.pickId });
  if (error) {
    if (["P0001", "P0002", "23505"].includes(error.code)) return reply({ error: error.code === "P0001" ? "This round has closed. Refresh for today’s jury." : "Your verdict is already sealed. Refresh to see it." }, 409);
    if (["22023", "22008", "22007"].includes(error.code)) return reply({ error: "Rate all five captions and choose a valid pick." }, 400);
    console.error("Jury ballot could not be saved", error.code);
    return reply({ error: "Your verdict could not be saved. Please try again." }, 500);
  }
  return reply({ sealed: true }, 201);
}
