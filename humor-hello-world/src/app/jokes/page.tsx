import type { Metadata } from "next";
import { connection } from "next/server";
import { getJokes } from "@/lib/supabase/jokes";
import { JokePicture } from "./joke-picture";

export const metadata: Metadata = { title: "Jokes | The Humor Project" };

export default async function JokesPage() {
  await connection();
  const jokes = await getJokes();
  return (
    <>
      <header className="collection-heading">
        <p className="eyebrow">A PICTURE. A PUNCHLINE.</p>
        <h1>The joke collection<span>.</span></h1>
        <p className="collection-intro">A little absurdity for your day.</p>
      </header>
      <div className="collection-meta"><h2>All jokes</h2><span>{jokes.length} {jokes.length === 1 ? "joke" : "jokes"}</span></div>
      {jokes.length ? (
        <ul className="joke-grid">
          {jokes.map((joke) => (
            <li key={joke.id} className="joke-card">
              <JokePicture key={joke.picture} src={joke.picture} />
              <p>{joke.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <section className="collection-message"><h2>The first laugh is on its way.</h2><p>No jokes have been added yet. Check back soon.</p></section>
      )}
    </>
  );
}
