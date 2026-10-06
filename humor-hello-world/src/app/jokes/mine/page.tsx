import type { Metadata } from "next";
import Link from "next/link";
import { requireCompletedProfile } from "@/lib/supabase/profiles";
import { getJokes } from "@/lib/supabase/jokes";
import { CaptionCard } from "../caption-lab";

export const metadata: Metadata = { title: "My creations | The Humor Project" };

export default async function MyCreations({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireCompletedProfile();
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.page) || 1)));
  const { jokes, hasMore } = await getJokes(page, true);
  return <section className="caption-collection" aria-labelledby="my-creations-title">
    <div className="caption-collection-heading"><div><p className="eyebrow">YOUR PHOTOS. YOUR PUNCHLINES.</p><h1 id="my-creations-title">My creations<span>✦</span></h1><p>Every caption generated from your photos, newest first.</p></div><Link className="jury-text-link" href="/jokes?upload=1#upload-studio">Add a photo ↗</Link></div>
    {jokes.length ? <div className="caption-grid">{jokes.map((joke, index) => <CaptionCard key={`${joke.id}:${joke.vote}:${joke.score}`} joke={joke} index={(page - 1) * 30 + index} />)}</div> : <div className="empty-lab"><h2>{page === 1 ? "Your first creation is waiting." : "You’ve reached the end."}</h2><p>{page === 1 ? "Upload a photo and choose your first punchline." : "Head back to your newest creations."}</p><Link className="jury-text-link" href={page === 1 ? "/jokes?upload=1#upload-studio" : "/jokes/mine"}>{page === 1 ? "Add a photo →" : "Back to page one →"}</Link></div>}
    <nav className="caption-pagination" aria-label="My creations pages">{page > 1 && <Link href={`/jokes/mine?page=${page - 1}`}>← Newer captions</Link>}<span>PAGE {page}</span>{hasMore && <Link href={`/jokes/mine?page=${page + 1}`}>Older captions →</Link>}</nav>
  </section>;
}
