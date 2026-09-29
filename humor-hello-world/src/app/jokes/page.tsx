import type { Metadata } from "next";
import { connection } from "next/server";
import { getJokes } from "@/lib/supabase/jokes";
import { JokePicture } from "./joke-picture";
import { getAvatarUrl, requireCompletedProfile } from "@/lib/supabase/profiles";
import { signOut } from "@/app/auth/actions";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Jokes | The Humor Project" };

export default async function JokesPage() {
  await connection();
  const { user, profile } = await requireCompletedProfile();
  const jokes = await getJokes();
  const identity = `${profile.first_name} ${profile.last_name}`;
  const initial = profile.first_name?.charAt(0).toUpperCase();
  const avatarUrl = await getAvatarUrl(profile.avatar_path);
  return (
    <>
      <div className="account-bar">
        <div className="account-identity"><span className={`account-avatar${avatarUrl ? " has-photo" : ""}`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined} role={avatarUrl ? "img" : undefined} aria-label={avatarUrl ? `${identity}’s profile photo` : undefined} aria-hidden={avatarUrl ? undefined : "true"}>{avatarUrl ? null : initial}</span><p>You’re signed in<strong>{identity}</strong><span>{user.email}</span></p></div>
        <form action={signOut}><SignOutButton /></form>
      </div>
      <header className="collection-heading">
        <p className="eyebrow">A PICTURE. A PUNCHLINE.</p>
        <h1>The joke collection<span>.</span></h1>
        <p className="collection-intro">A little absurdity for your day.</p>
      </header>
      <div className="collection-meta"><h2>All jokes</h2><span className="count-pill">{jokes.length} {jokes.length === 1 ? "joke" : "jokes"}</span></div>
      {jokes.length ? (
        <ul className="joke-grid">
          {jokes.map((joke, index) => (
            <li key={joke.id} className="joke-card">
              <JokePicture key={joke.picture} src={joke.picture} />
              <div className="joke-copy"><span className="joke-number">JOKE {String(index + 1).padStart(2, "0")}</span><p>{joke.text}</p></div>
            </li>
          ))}
        </ul>
      ) : (
        <section className="collection-message"><h2>The first laugh is on its way.</h2><p>No jokes have been added yet. Check back soon.</p></section>
      )}
    </>
  );
}
