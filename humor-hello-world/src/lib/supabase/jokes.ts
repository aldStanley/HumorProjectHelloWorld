import { createClient } from "./server";
import { requireUser } from "./auth";

export type Joke = { id: string; picture: string; text: string; image_id: string | null; description: string; score: number; vote: number; isOwn: boolean };
export async function getJokes(page = 1, mineOnly = false): Promise<{ jokes: Joke[]; hasMore: boolean }> {
  const user = await requireUser();
  const client = await createClient();
  let query = client.from("jokes")
    .select(mineOnly ? "id,picture,text,image_id,caption_images!inner(description,user_id)" : "id,picture,text,image_id,caption_images(description,user_id)");
  if (mineOnly) query = query.eq("caption_images.user_id", user.id);
  const { data, error } = await query
    .order("created_at", { ascending: false }).order("id")
    .range((page - 1) * 30, page * 30).abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error("Unable to load captions. Please try again.");
  const rows = (data ?? []).slice(0, 30);
  if (!rows.length) return { jokes: [], hasMore: false };
  const ids = rows.map(row => row.id);
  const paths = [...new Set(rows.filter(row => row.image_id).map(row => row.picture))];
  const [votes, scores, images] = await Promise.all([
    client.from("caption_votes").select("caption_id,value").eq("user_id", user.id).in("caption_id", ids),
    client.rpc("caption_scores", { caption_ids: ids }),
    paths.length ? client.storage.from("caption-images").createSignedUrls(paths, 3600) : Promise.resolve({ data: [], error: null }),
  ]);
  if (votes.error || scores.error || images.error) throw new Error("Unable to load caption votes or photos.");
  const urls = new Map(images.data?.map(item => [item.path, item.signedUrl]));
  return { hasMore: (data?.length ?? 0) > 30, jokes: rows.map(row => {
    const related = row.caption_images as unknown as { description: string; user_id: string } | null;
    return { isOwn: related?.user_id === user.id, id: row.id, text: row.text, image_id: row.image_id,
      picture: row.image_id ? urls.get(row.picture) ?? "" : row.picture,
      description: related?.description ?? "Illustration from the original joke collection",
      score: Number(scores.data?.find((item: { caption_id: string }) => item.caption_id === row.id)?.score ?? 0),
      vote: votes.data?.find(item => item.caption_id === row.id)?.value ?? 0,
    };
  }) };
}
