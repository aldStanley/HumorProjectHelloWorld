import type { Metadata } from "next";
import { SiteNav } from "@/app/site-nav";
import { signOut } from "@/app/auth/actions";
import { requireCompletedProfile, getAvatarUrl } from "@/lib/supabase/profiles";
import { ProfileForm } from "./profile-form";
import { SignOutButton } from "@/app/jokes/sign-out-button";

export const metadata: Metadata = { title: "Profile | The Humor Project" };

export default async function ProfilePage({ searchParams }: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { user, profile } = await requireCompletedProfile();
  const avatarUrl = await getAvatarUrl(profile.avatar_path);
  const { error, saved } = await searchParams;

  const errorMessage = error === "photo"
    ? "Choose a JPG, PNG, or WebP image smaller than 5 MB."
    : error === "upload"
      ? "Your photo couldn’t be uploaded. Please try again."
      : error
        ? "Your changes couldn’t be saved. Check both names and try again."
        : null;

  return <main className="collection">
    <SiteNav active="profile" />
    <header className="collection-heading profile-heading">
      <p className="eyebrow">YOUR ACCOUNT</p>
      <h1>Your profile<span>.</span></h1>
      <p className="collection-intro">Keep your name and optional profile photo up to date.</p>
    </header>
    {saved && <p className="success-message" role="status">Your profile has been saved.</p>}
    {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
    <ProfileForm profile={profile} avatarUrl={avatarUrl} email={user.email ?? ""} />
    <div className="profile-account-actions"><span>Signed in as {user.email}</span><form action={signOut}><SignOutButton /></form></div>
    <footer>Stanley Chung <span>Columbia · Fall 2026</span></footer>
  </main>;
}
