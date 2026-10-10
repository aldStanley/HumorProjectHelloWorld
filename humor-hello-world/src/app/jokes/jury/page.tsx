import type { Metadata } from "next";
import Link from "next/link";
import { getJuryState } from "@/lib/jury/server";
import { getUser } from "@/lib/supabase/auth";
import { DailyJury } from "../daily-jury";

export const metadata: Metadata = { title: "Daily challenge | The Humor Project" };

export default async function JuryPage() {
  const [user, jury] = await Promise.all([getUser(), getJuryState().catch(() => null)]);
  return <section className="jury-page">
    <Link className="jury-text-link" href="/">← Back to the punchline board</Link>
    {jury ? <DailyJury key={`${jury.today}:${jury.ballot?.pick_id ?? "open"}`} state={jury} signedIn={Boolean(user)} /> : <section className="jury-unavailable"><h1>The daily challenge is getting ready.</h1><p>Try again shortly, or browse the punchline board.</p></section>}
  </section>;
}
