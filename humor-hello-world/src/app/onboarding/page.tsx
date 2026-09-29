import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { completeProfile, signOut } from "@/app/auth/actions";
import { getUser, hasCompletedProfile } from "@/lib/supabase/auth";
import { ProfileSubmitButton } from "./profile-submit-button";

export const metadata: Metadata = { title: "Complete your profile | The Humor Project" };

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (hasCompletedProfile(user)) redirect("/jokes");

  const { error } = await searchParams;
  const metadata = user.user_metadata ?? {};
  const firstName = typeof metadata.given_name === "string" ? metadata.given_name : "";
  const lastName = typeof metadata.family_name === "string" ? metadata.family_name : "";

  return <main className="collection onboarding-page">
    <nav aria-label="Main navigation"><Link href="/" className="brand">THE HUMOR PROJECT</Link><form action={signOut}><button className="nav-button" type="submit">Use another account</button></form></nav>
    <section className="profile-card">
      <p className="eyebrow">ONE LAST STEP</p>
      <h1>Tell us your name<span>.</span></h1>
      <p className="collection-intro">Confirm your details to finish setting up your profile.</p>
      {error && <p className="auth-error" role="alert">{error === "save" ? "We couldn’t save your profile. Please try again." : "Enter a first and last name using 50 characters or fewer."}</p>}
      <form className="profile-form" action={completeProfile}>
        <div className="field-group"><label htmlFor="firstName">First name</label><input id="firstName" name="firstName" type="text" autoComplete="given-name" defaultValue={firstName} maxLength={50} required autoFocus /></div>
        <div className="field-group"><label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" type="text" autoComplete="family-name" defaultValue={lastName} maxLength={50} required /></div>
        <ProfileSubmitButton />
      </form>
      <p className="auth-note">This information is saved securely with your Supabase account.</p>
    </section>
    <footer>Stanley Chung <span>Columbia · Fall 2026</span></footer>
  </main>;
}
