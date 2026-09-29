import { redirect } from "next/navigation";
import { requireUser } from "./auth";
import { createClient } from "./server";

export type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
};

export function isProfileComplete(profile: Profile | null) {
  return Boolean(profile?.first_name?.trim() && profile?.last_name?.trim());
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const client = await createClient();
  const { data, error } = await client.from("profiles").select("id,first_name,last_name,avatar_path").eq("id", userId).maybeSingle();
  if (error) throw new Error("Unable to load your profile.");
  return data;
}

export async function requireCompletedProfile() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  if (!isProfileComplete(profile)) redirect("/onboarding");
  return { user, profile: profile as Profile };
}

export async function getAvatarUrl(path: string | null) {
  if (!path) return null;
  const client = await createClient();
  return client.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}
