import Link from "next/link";
import type { Metadata } from "next";
import { getGoldenLaughs } from "@/lib/jury/server";
import { juryDate } from "@/lib/jury/types";
import { JuryPhoto } from "../jury-photo";

export const metadata: Metadata = { title: "Golden Laughs | The Humor Project" };
export default async function Trophies({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.page) || 1)));
  const { entries, count, hasMore } = await getGoldenLaughs(page);
  return <section className="trophy-cabinet"><Link className="jury-text-link" href="/jokes">← Back to today’s jury</Link><header><span className="trophy-emblem" aria-hidden="true">✹</span><p className="jury-kicker">GOOD TASTE. GOLDEN PROOF.</p><h1>Your Golden Laughs<span>.</span></h1><p>{count} winning {count === 1 ? "prediction" : "predictions"}. Every trophy keeps the joke you called.</p></header>
    {entries.length ? <div className="trophy-grid">{entries.map(entry => <article className="trophy-card" key={entry.round_day}><div className="trophy-photo"><JuryPhoto src={entry.picture} alt={entry.description} /><span aria-hidden="true">✹</span></div><div><span className="jury-kicker">{juryDate(entry.round_day)}</span><p>“{entry.caption_text}”</p><strong>You called it.</strong></div></article>)}</div> : <div className="trophy-empty"><h2>{count ? "No trophies on this page." : "Your first Golden Laugh is waiting."}</h2><p>Rate today’s five captions and pick a winner. If the crowd crowns your pick, its photo and punchline land right here.</p><Link className="seal-verdict-button" href="/jokes">Take your jury seat ↗</Link></div>}
    <nav className="caption-pagination" aria-label="Trophy pages">{page > 1 && <Link href={`/jokes/trophies?page=${page - 1}`}>← Newer trophies</Link>}<span>PAGE {page}</span>{hasMore && <Link href={`/jokes/trophies?page=${page + 1}`}>Older trophies →</Link>}</nav>
  </section>;
}
