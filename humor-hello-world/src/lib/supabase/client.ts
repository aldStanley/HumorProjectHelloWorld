import { createClient } from "@supabase/supabase-js";
import { getSupabasePublishableKey, getSupabaseUrl } from "./config";

/** Public database client. Table access is governed by Supabase RLS policies. */
export const supabase = createClient(
  getSupabaseUrl(),
  getSupabasePublishableKey(),
);
