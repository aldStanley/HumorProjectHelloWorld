import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getJokes } from "@/lib/supabase/jokes";
import { requireCompletedProfile } from "@/lib/supabase/profiles";
import { getJuryState } from "@/lib/jury/server";
import { DailyJury } from "./daily-jury";
import { CaptionCard, UploadStudio } from "./caption-lab";

export const metadata: Metadata = { title: "Caption Lab | The Humor Project" };
export default async function JokesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  const { profile } = await requireCompletedProfile();
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.page) || 1)));
  const [{ jokes, hasMore }, jury] = await Promise.all([getJokes(page), getJuryState().catch(() => null)]);
  return <>
    <header className="lab-heading"><div><p className="eyebrow"><span className="live-dot" /> THE INTERNET NEEDS BETTER PUNCHLINES</p><h1>Serious photos.<br /><em>Unserious</em> captions<span>✳</span></h1><p className="lab-intro">Five jokes. One daily verdict. A little glory for your good taste.<br /> Take your jury seat and find out tomorrow if you called it.</p></div><div className="lab-stamp" aria-hidden="true">100%<br /><span>SUBJECTIVELY<br />FUNNY</span>☺</div></header>
    <div className="lab-welcome"><span>THE LAB IS OPEN</span><p>Welcome back, {profile.first_name}. Your taste is the algorithm.</p></div>
    {jury ? <DailyJury key={`${jury.today}:${jury.ballot?.pick_id ?? "open"}`} state={jury} /> : <section className="jury-unavailable"><h2>The daily jury is getting ready.</h2><p>Please try again shortly. You can still enjoy the caption board below.</p></section>}
    <details className="after-hours"><summary>Keep the laughs coming <span>Upload a photo or browse the caption board ↓</span></summary>
    <UploadStudio />
    <section className="caption-collection" aria-labelledby="collection-title"><div className="caption-collection-heading"><div><p className="eyebrow">THE CROWD HAS THE LAST LAUGH</p><h2 id="collection-title">The punchline board<span>↘</span></h2></div><span className="board-filter">● LATEST DROPS</span></div>
      {jokes.length ? <div className="caption-grid">{jokes.map((joke, index) => <CaptionCard key={`${joke.id}:${joke.vote}:${joke.score}`} joke={joke} index={(page - 1) * 30 + index} />)}</div> : <div className="empty-lab"><span aria-hidden="true">☻</span><h3>{page === 1 ? "The mic is yours." : "You’ve reached the end."}</h3><p>{page === 1 ? "Drop a photo above to start the first round of captions." : "Head back to the latest drops for more laughs."}</p></div>}
      <nav className="caption-pagination" aria-label="Caption pages">{page > 1 && <Link href={`/jokes?page=${page - 1}`}>← Newer captions</Link>}<span>PAGE {page}</span>{hasMore && <Link href={`/jokes?page=${page + 1}`}>Older captions →</Link>}</nav>
    </section>
    </details>
  </>;
}
