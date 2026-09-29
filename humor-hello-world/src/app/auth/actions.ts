"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const client = await createClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error("Unable to sign out. Please try again.");
  redirect("/login");
}

export async function completeProfile(formData: FormData) {
  await saveProfile(formData, "/onboarding", false);
  redirect("/jokes");
}

export async function updateProfile(formData: FormData) {
  await saveProfile(formData, "/profile", true);
  redirect("/profile?saved=1");
}

async function saveProfile(formData: FormData, errorPath: string, allowAvatar: boolean) {
  const firstName = formData.get("firstName");
  const lastName = formData.get("lastName");
  if (typeof firstName !== "string" || typeof lastName !== "string") redirect(`${errorPath}?error=invalid`);

  const first = firstName.trim();
  const last = lastName.trim();
  if (!first || !last || first.length > 50 || last.length > 50) redirect(`${errorPath}?error=invalid`);

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const photo = formData.get("photo");
  let avatarPath: string | undefined;
  let previousAvatar: string | null = null;
  if (allowAvatar && photo instanceof File && photo.size > 0) {
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const extension = extensions[photo.type];
    if (!extension || photo.size > 5 * 1024 * 1024) redirect(`${errorPath}?error=photo`);

    const { data: currentProfile } = await client.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle();
    previousAvatar = currentProfile?.avatar_path ?? null;
    avatarPath = `${user.id}/avatar-${randomUUID()}.${extension}`;
    const { error: uploadError } = await client.storage.from("avatars").upload(avatarPath, photo, { contentType: photo.type, upsert: false });
    if (uploadError) redirect(`${errorPath}?error=upload`);
  }

  const updates: { first_name: string; last_name: string; avatar_path?: string; updated_at: string } = {
    first_name: first,
    last_name: last,
    updated_at: new Date().toISOString(),
  };
  if (avatarPath) updates.avatar_path = avatarPath;

  const { error } = await client.from("profiles").update(updates).eq("id", user.id).select("id").single();
  if (error) {
    if (avatarPath) await client.storage.from("avatars").remove([avatarPath]);
    redirect(`${errorPath}?error=save`);
  }
  if (avatarPath && previousAvatar) await client.storage.from("avatars").remove([previousAvatar]);
}
