import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./server";

// Verify with Supabase Auth rather than trusting a client-supplied session cookie.
export const getUser = cache(async () => {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
});

export function hasCompletedProfile(user: { user_metadata?: Record<string, unknown> }) {
  return user.user_metadata?.profile_completed === true;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireCompletedProfile() {
  const user = await requireUser();
  if (!hasCompletedProfile(user)) redirect("/onboarding");
  return user;
}
