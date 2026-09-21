import { createClient } from "@supabase/supabase-js";
import { getSupabasePublishableKey, getSupabaseUrl } from "./config";

export type Joke = { id: string; picture: string; text: string };

export async function getJokes(): Promise<Joke[]> {
  const client = createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client
    .from("jokes")
    .select("id,picture,text")
    .order("id")
    .abortSignal(AbortSignal.timeout(10000));

  if (error) {
    console.error("Could not read jokes:", error.code, error.message);
    throw new Error("Unable to load jokes.");
  }
  return data ?? [];
}
