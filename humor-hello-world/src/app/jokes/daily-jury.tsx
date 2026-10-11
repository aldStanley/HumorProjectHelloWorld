"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { juryDate, type JuryBallot, type JuryReveal, type JuryState } from "@/lib/jury/types";
import { JuryPhoto } from "./jury-photo";
import { CaptionSourceTag } from "./caption-source";

export function Reveal({ reveal, trophyHref = "/jokes/trophies" }: { reveal: JuryReveal; trophyHref?: string }) {
  const { winners, pick, round, earned, support } = reveal;
  if (!winners.length) return <section className="jury-reveal quiet-verdict"><span className="jury-kicker">LAST VERDICT · {juryDate(round.round_day)}</span><h2>A quiet day in court.</h2><p>No sealed ballots came in, so no winner or trophy was awarded. Today’s jury needs your verdict.</p></section>;
  const tied = winners.length > 1;
  return <section className={`jury-reveal ${earned ? "winning-verdict" : ""}`} aria-labelledby="verdict-title">
    <div className="verdict-art"><JuryPhoto src={(earned ? pick : null)?.picture ?? winners[0].picture} alt={(earned ? pick : null)?.description ?? winners[0].description} /><span className="verdict-ribbon">{tied ? "THE JURY’S CO-WINNERS" : "THE JURY’S WINNER"}</span></div>
    <div className="verdict-copy"><span className="jury-kicker">THE VERDICT IS IN · {juryDate(round.round_day)}</span>
      <h2 id="verdict-title">{earned ? <>You called it! <span aria-hidden="true">✦</span></> : pick ? "The jury had other ideas." : "The crowd has spoken."}</h2>
      {tied ? <><p>{winners.length} jokes tied for the highest score. They share the win.</p><div className="verdict-co-winners">{winners.map(winner => <article className="verdict-co-winner" key={winner.caption_id}><div className="co-winner-photo"><JuryPhoto src={winner.picture} alt={winner.description} /></div><div><span className="jury-kicker">EXHIBIT {String(winner.position).padStart(2, "0")} · CO-WINNER</span><CaptionSourceTag source={winner.caption_source} /><blockquote>“{winner.caption_text}”</blockquote></div></article>)}</div></> : <><CaptionSourceTag source={winners[0].caption_source} /><blockquote>“{winners[0].caption_text}”</blockquote></>}
      {earned ? <><p className="golden-award"><span aria-hidden="true">✹</span> +1 Golden Laugh</p><p>{tied ? "Your pick is a co-winner." : "Your pick won the crowd over."} This joke now has a place in your collection.</p><Link className="jury-text-link" href={trophyHref}>See your trophy →</Link></> : pick ? <p>You backed “{pick.caption_text}”<br /><strong>{support}% of the jury picked it too.</strong> New evidence awaits below.</p> : <p>You weren’t on this jury. Take your seat in today’s round below.</p>}
      <small>{round.ballot_count} sealed {round.ballot_count === 1 ? "ballot" : "ballots"} · {tied ? "Co-winners" : "Winner"} chosen by jury votes</small>
    </div>
  </section>;
}

export function DailyJury({ state, signedIn = true }: { state: JuryState; signedIn?: boolean }) {
  const router = useRouter();
  const [pickId, setPickId] = useState(state.ballot?.pick_id ?? "");
  const [sealed, setSealed] = useState<JuryBallot | null>(state.ballot);
  const [openWitness, setOpenWitness] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const sending = useRef(false);
  const closesAt = state.round?.closes_at;
  useEffect(() => {
    if (!closesAt) return;
    const end = new Date(closesAt).getTime();
    const timer = setInterval(() => setRemaining(Math.max(0, end - Date.now())), 1000);
    const rollover = setTimeout(() => router.refresh(), Math.max(0, end - Date.now()) + 1000);
    return () => { clearInterval(timer); clearTimeout(rollover); };
  }, [closesAt, router]);
  const closed = remaining === 0;
  const locked = Boolean(sealed) || busy || closed;
  const pick = state.entries.find(entry => entry.caption_id === (sealed?.pick_id ?? pickId));
  const timeLabel = remaining === null ? "Closes at midnight ET" : closed ? "Round closed" : `${Math.floor(remaining / 3600000)}h ${Math.floor(remaining % 3600000 / 60000)}m left`;

  async function submit() {
    if (sending.current || sealed || !pickId || closed) return;
    sending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/jury", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roundDay: state.today, pickId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not seal your verdict. Please try again.");
      setSealed({ ratings: { [pickId]: 1 }, pick_id: pickId });
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Connection lost. Your verdict hasn’t been confirmed. Please try again."); }
    finally { sending.current = false; setBusy(false); }
  }

  return <div className="daily-jury">
    <div className="jury-member-bar"><span>YOUR DAILY COMEDY RITUAL</span><Link href="/jokes/trophies"><span aria-hidden="true">✹</span> {state.rewardCount} Golden {state.rewardCount === 1 ? "Laugh" : "Laughs"} <span aria-hidden="true">↗</span></Link></div>
    {state.reveal && <Reveal reveal={state.reveal} />}
    <section className="jury-court" aria-labelledby="jury-title">
      <header className="jury-heading"><div><span className="jury-kicker">COMEDY COURT · {juryDate(state.today)}</span><h2 id="jury-title">The floor is yours,<br /><em>your humor.</em></h2><p>Five exhibits. One joke. One vote.<br />Choose your favorite and return tomorrow to see whether it wins a Golden Laugh.</p></div><div className="jury-seal" aria-hidden="true">THE<br /><strong>COMEDY<br />JURY</strong><span>IN SESSION</span></div></header>
      <div className="jury-round-meta"><span>{timeLabel}</span><span>{sealed ? "VERDICT SEALED" : pickId ? "1 JOKE SELECTED" : "CHOOSE 1 JOKE"}</span></div>
      {!state.round ? <div className="jury-waiting"><h3>The evidence is still coming in.</h3><p>We need five captions to open the first round. Add a photo below, then check back.</p></div> : <>
        <p className="jury-instructions"><strong>01 / Choose the joke that makes you laugh.</strong> Hover over a witness or tap their photo to hear the testimony. You can select only one joke.</p>
        <div className="courtroom-scene"><div className="courtroom-sign" aria-hidden="true"><span>⚖</span> THE PEOPLE v. BAD JOKES <small>FIVE WITNESSES · ONE VERDICT</small></div><div className="jury-exhibits">{state.entries.map(entry => <article className={`jury-exhibit ${openWitness === entry.caption_id ? "testifying" : ""} ${pickId === entry.caption_id ? "picked-exhibit" : ""}`} key={entry.caption_id}>
          <div className="witness-stage">
            <div className="witness-testimony" id={`testimony-${entry.caption_id}`}><span>THE WITNESS SAYS…</span><p>“{entry.caption_text}”</p></div>
            <button type="button" className="witness-portrait" aria-label={`Hear witness ${entry.position}: ${entry.caption_text}`} aria-pressed={openWitness === entry.caption_id} onClick={() => setOpenWitness(current => current === entry.caption_id ? null : entry.caption_id)}>
              <JuryPhoto src={entry.picture} alt={entry.description} />
            </button>
            <div className="witness-stand" aria-hidden="true"><div className="stand-rail" /><div className="stand-spindles">{[0,1,2,3,4].map(n => <i key={n} />)}</div><div className="stand-plaque">WITNESS {String(entry.position).padStart(2, "0")}</div><div className="stand-base" /></div>
          </div>
          <div className="jury-exhibit-copy"><CaptionSourceTag source={entry.caption_source} />
            <label className="jury-pick"><input type="radio" name={`winner-${state.today}`} value={entry.caption_id} checked={pickId === entry.caption_id} disabled={locked} onChange={() => signedIn ? setPickId(entry.caption_id) : router.push("/login")} /><span>{pickId === entry.caption_id ? "My vote ✦" : "Vote for this joke"}</span></label>
          </div>
        </article>)}</div><div className="courtroom-floor-label" aria-hidden="true">YOUR SEAT ON THE JURY</div></div>
        <div className={`jury-submit ${sealed ? "is-sealed" : ""}`}>
          {sealed ? <><span className="sealed-mark" aria-hidden="true">✓</span><div role="status"><h3>Your verdict is sealed.</h3><p>You backed “{pick?.caption_text}”</p><p>Come back after midnight ET for the reveal. A winning pick earns one Golden Laugh automatically.</p></div></> : <><div><span className="jury-kicker">02 / MAKE YOUR VOTE OFFICIAL</span><h3>{pick ? `Exhibit ${String(pick.position).padStart(2, "0")} is your pick.` : "Which joke gets your vote?"}</h3><p>Select one joke. You can change your selection before sealing; your vote is final once sealed.</p></div><button className="seal-verdict-button" disabled={busy || !pickId || closed} onClick={submit}>{busy ? "Sealing…" : closed ? "Round closed" : "Seal my verdict ↗"}</button></>}
        </div>
        {error && <div className="jury-error" role="alert"><p>{error}</p><button onClick={() => router.refresh()}>Refresh round</button></div>}
      </>}
      <details className="jury-rules"><summary>How does the jury work?</summary><p>Everyone gets the same five exhibits for the day. Each user can vote for one joke per daily round. Only sealed votes count, and each adds one point to the selected joke. The most votes wins. Every joke tied for the most votes is a co-winner.</p><p>Rounds close at midnight in America/New_York, including daylight saving time. Results appear on the first visit after closing. No ballots means no winner. Picking any winner or co-winner earns exactly one Golden Laugh, saved automatically even if you miss the next day.</p></details>
    </section>
  </div>;
}
