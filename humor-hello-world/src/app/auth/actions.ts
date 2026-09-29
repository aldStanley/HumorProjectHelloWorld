"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const client = await createClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error("Unable to sign out. Please try again.");
  redirect("/login");
}

export async function completeProfile(formData: FormData) {
  const firstName = formData.get("firstName");
  const lastName = formData.get("lastName");
  if (typeof firstName !== "string" || typeof lastName !== "string") redirect("/onboarding?error=invalid");

  const first = firstName.trim();
  const last = lastName.trim();
  if (!first || !last || first.length > 50 || last.length > 50) redirect("/onboarding?error=invalid");

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await client.auth.updateUser({ data: {
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`,
    profile_completed: true,
  } });
  if (error) redirect("/onboarding?error=save");
  redirect("/jokes");
}
