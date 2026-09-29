import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { GoogleSignIn } from "./google-sign-in";

export const metadata: Metadata = { title: "Sign in | The Humor Project" };

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getUser()) redirect("/jokes");
  const { error } = await searchParams;
  return (
    <main className="collection auth-page">
      <nav aria-label="Main navigation"><Link href="/" className="brand">THE HUMOR PROJECT</Link></nav>
      <section className="auth-card">
        <p className="eyebrow">A LITTLE LAUGHTER, JUST FOR YOU</p>
        <h1>Good jokes.<br />Great company<span>.</span></h1>
        <p className="collection-intro">Sign in with Google to unlock the joke collection.</p>
        {error && <p className="auth-error" role="alert">We couldn’t complete your sign-in. Please try again.</p>}
        <GoogleSignIn />
        <p className="auth-note">Your next laugh is one sign-in away.</p>
      </section>
      <footer>Stanley Chung <span>Columbia · Fall 2026</span></footer>
    </main>
  );
}
