import "server-only";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { juryWinnerIds } from "./types";
import type { JuryBallot, JuryEntry, JuryRound, JuryState } from "./types";

async function withPhotos(entries: JuryEntry[]): Promise<JuryEntry[]> {
  const paths = [...new Set(entries.filter(entry => entry.private_image).map(entry => entry.picture))];
  if (!paths.length) return entries;
  const client = await createClient();
  const { data, error } = await client.storage.from("caption-images").createSignedUrls(paths, 3600);
  if (error) throw new Error("Unable to load jury photos.");
  const urls = new Map(data.map(image => [image.path, image.signedUrl]));
  return entries.map(entry => ({ ...entry, picture: entry.private_image ? urls.get(entry.picture) ?? "" : entry.picture }));
}

export async function getJuryState(): Promise<JuryState> {
  const user = await requireUser();
  const client = await createClient();
  const prepared = await client.rpc("prepare_daily_jury");
  if (prepared.error || typeof prepared.data !== "string") {
    console.error("Daily jury preparation failed", prepared.error?.code);
    throw new Error("The daily jury is temporarily unavailable.");
  }
  const today = prepared.data;
  const [round, entries, ballot, previous, rewards] = await Promise.all([
    client.from("jury_rounds").select("*").eq("round_day", today).maybeSingle<JuryRound>(),
    client.from("jury_entries").select("*").eq("round_day", today).order("position").returns<JuryEntry[]>(),
    client.from("jury_ballots").select("ratings,pick_id").eq("round_day", today).eq("user_id", user.id).maybeSingle<JuryBallot>(),
    client.from("jury_rounds").select("*").lt("round_day", today).not("finalized_at", "is", null).order("round_day", { ascending: false }).limit(1).maybeSingle<JuryRound>(),
    client.from("golden_laughs").select("round_day", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  if ([round.error, entries.error, ballot.error, previous.error, rewards.error].some(Boolean)) throw new Error("Unable to load the daily jury.");
  let reveal: JuryState["reveal"] = null;
  if (previous.data) {
    const previousRound = previous.data;
    const [myBallot, exhibits, reward] = await Promise.all([
      client.from("jury_ballots").select("ratings,pick_id").eq("round_day", previousRound.round_day).eq("user_id", user.id).maybeSingle<JuryBallot>(),
      client.from("jury_entries").select("*").eq("round_day", previousRound.round_day).returns<JuryEntry[]>(),
      client.from("golden_laughs").select("round_day").eq("round_day", previousRound.round_day).eq("user_id", user.id).maybeSingle(),
    ]);
    if (myBallot.error || exhibits.error || reward.error) throw new Error("Unable to load the last verdict.");
    const winnerIds = new Set(juryWinnerIds(previousRound));
    const winners = (exhibits.data ?? []).filter(entry => winnerIds.has(entry.caption_id)).sort((a, b) => a.position - b.position);
    const pick = exhibits.data?.find(entry => entry.caption_id === myBallot.data?.pick_id) ?? null;
    const photos = await withPhotos([...winners, ...(pick ? [pick] : [])]);
    const picks = previousRound.results?.find(result => result.caption_id === pick?.caption_id)?.picks ?? 0;
    reveal = {
      round: previousRound,
      winners: photos.slice(0, winners.length),
      pick: photos.find(entry => entry.caption_id === pick?.caption_id) ?? null,
      support: pick && previousRound.ballot_count ? Math.round(picks / previousRound.ballot_count * 100) : null,
      earned: Boolean(reward.data),
    };
  }
  return { today, round: round.data, entries: await withPhotos(entries.data ?? []), ballot: ballot.data, reveal, rewardCount: rewards.count ?? 0 };
}

export async function getGoldenLaughs(page = 1) {
  const user = await requireUser();
  const client = await createClient();
  // Returning directly to the trophy cabinet also settles any missed rounds.
  const { error: prepareError } = await client.rpc("prepare_daily_jury");
  if (prepareError) throw new Error("Unable to open your Golden Laugh collection.");
  const { data, error, count } = await client.from("golden_laughs")
    .select("round_day,jury_entries(*)", { count: "exact" }).eq("user_id", user.id)
    .order("round_day", { ascending: false }).range((page - 1) * 12, page * 12 - 1);
  if (error) throw new Error("Unable to load your Golden Laughs.");
  const entries = (data ?? []).map(row => row.jury_entries as unknown as JuryEntry);
  return { entries: await withPhotos(entries), count: count ?? 0, hasMore: (count ?? 0) > page * 12 };
}
