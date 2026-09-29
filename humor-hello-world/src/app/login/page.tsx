import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { getProfile, isProfileComplete } from "@/lib/supabase/profiles";
import { GoogleSignIn } from "./google-sign-in";
import { SiteNav } from "@/app/site-nav";

export const metadata: Metadata = { title: "Sign in | The Humor Project" };

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getUser();
  if (user) redirect(isProfileComplete(await getProfile(user.id)) ? "/jokes" : "/onboarding");
  const { error } = await searchParams;
  return (
    <main className="collection auth-page">
      <SiteNav />
      <section className="auth-card">
        <p className="eyebrow">A LITTLE LAUGHTER, JUST FOR YOU</p>
        <h1>Good jokes.<br />Great company<span>.</span></h1>
        <p className="collection-intro">Sign in with Google to open your private joke collection.</p>
        <ul className="auth-benefits" aria-label="What to expect">
          <li>One quick step</li>
          <li>Come back anytime</li>
        </ul>
        {error && <p className="auth-error" role="alert">We couldn’t complete your sign-in. Please try again.</p>}
        <GoogleSignIn />
        <p className="auth-note">Google handles your sign-in securely. This app never sees your Google password.</p>
      </section>
      <footer>Stanley Chung <span>Columbia · Fall 2026</span></footer>
    </main>
  );
}
