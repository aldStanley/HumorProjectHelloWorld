import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./server";

// Verify with Supabase Auth rather than trusting a client-supplied session cookie.
export const getUser = cache(async () => {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
