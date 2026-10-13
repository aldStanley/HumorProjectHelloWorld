import Link from "next/link";
import { connection } from "next/server";
import { getJokes } from "@/lib/supabase/jokes";
import { getUser } from "@/lib/supabase/auth";
import { getJuryState } from "@/lib/jury/server";
import { CaptionCard, UploadStudio } from "./caption-lab";
import { DailyJury } from "./daily-jury";

export async function CaptionLab({ searchParams, baseHref = "/jokes" }: { searchParams: Promise<{ page?: string; filter?: string }>; baseHref?: string }) {
  await connection();
  const [user, jury] = await Promise.all([getUser(), getJuryState().catch(() => null)]);
  const params = await searchParams;
  const mineOnly = params.filter === "mine";
  const boardUrl = (number: number) => `${baseHref}?page=${number}${mineOnly ? "&filter=mine" : ""}#collection-title`;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.page) || 1)));
  const { jokes, hasMore } = await getJokes(page, mineOnly);
  return <>
    <header className="lab-heading lab-heading-compact"><div><h1>Campus photos.<br className="mobile-break" /> <em>City punchlines.</em></h1><p className="lab-intro">Turn your photos into Columbia & NYC memes. Vote for the ones that make you laugh.</p></div></header>
    <UploadStudio signedIn={Boolean(user)} />
    <section id="daily-jury" className="jury-page" aria-label="Daily comedy jury">
      {jury ? <DailyJury key={`${jury.today}:${jury.ballot?.pick_id ?? "open"}`} state={jury} signedIn={Boolean(user)} /> : <section className="jury-unavailable"><h2>The daily challenge is getting ready.</h2><p>Try again shortly, or browse the punchline board below.</p></section>}
    </section>
    <section className="caption-collection" aria-labelledby="collection-title"><div className="caption-collection-heading"><div><h2 id="collection-title">The punchline board</h2><p className="board-intro">See a good joke? Give it a vote.</p></div><nav className="caption-filters" aria-label="Caption collection filter"><Link href={`${baseHref}#collection-title`} aria-current={!mineOnly ? "page" : undefined}>All captions</Link><Link href={user ? `${baseHref}?filter=mine#collection-title` : "/login"} aria-current={mineOnly ? "page" : undefined}>My creations</Link></nav></div>
      {jokes.length ? <div className="caption-grid">{jokes.map((joke, index) => <CaptionCard key={`${joke.id}:${joke.vote}:${joke.score}`} joke={joke} signedIn={Boolean(user)} index={(page - 1) * 30 + index} />)}</div> : <div className="empty-lab"><span aria-hidden="true">☻</span><h3>{page === 1 ? (mineOnly ? "Your first creation is waiting." : "The mic is yours.") : "You’ve reached the end."}</h3><p>{page === 1 ? (mineOnly ? "Upload a photo above. Your published caption will appear here." : "Drop a photo above to start the first round of captions.") : "Head back to the latest drops for more laughs."}</p></div>}
      <nav className="caption-pagination" aria-label="Caption pages">{page > 1 && <Link href={boardUrl(page - 1)}>← Newer captions</Link>}<span>PAGE {page}</span>{hasMore && <Link href={boardUrl(page + 1)}>Older captions →</Link>}</nav>
    </section>
  </>;
}
