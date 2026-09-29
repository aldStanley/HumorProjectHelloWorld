import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { completeProfile, signOut } from "@/app/auth/actions";
import { getUser } from "@/lib/supabase/auth";
import { getProfile, isProfileComplete } from "@/lib/supabase/profiles";
import { SiteNav } from "@/app/site-nav";
import { ProfileSubmitButton } from "./profile-submit-button";

export const metadata: Metadata = { title: "Complete your profile | The Humor Project" };

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");
  const profile = await getProfile(user.id);
  if (isProfileComplete(profile)) redirect("/jokes");

  const { error } = await searchParams;

  return <main className="collection onboarding-page">
    <SiteNav />
    <section className="profile-card">
      <p className="eyebrow">ONE LAST STEP</p>
      <h1>Tell us your name<span>.</span></h1>
      <p className="collection-intro">Confirm your details to finish setting up your profile.</p>
      {error && <p className="auth-error" role="alert">{error === "save" ? "We couldn’t save your profile. Please try again." : "Enter a first and last name using 50 characters or fewer."}</p>}
      <form className="profile-form" action={completeProfile}>
        <div className="field-group"><label htmlFor="firstName">First name</label><input id="firstName" name="firstName" type="text" autoComplete="given-name" maxLength={50} required autoFocus /></div>
        <div className="field-group"><label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" type="text" autoComplete="family-name" maxLength={50} required /></div>
        <ProfileSubmitButton />
      </form>
      <p className="auth-note">This information is saved securely with your Supabase account.</p>
      <form action={signOut}><button className="text-button" type="submit">Use another Google account</button></form>
    </section>
    <footer>Stanley Chung <span>Columbia · Fall 2026</span></footer>
  </main>;
}
