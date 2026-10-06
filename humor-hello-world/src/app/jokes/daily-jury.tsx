"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { juryDate, type JuryBallot, type JuryReveal, type JuryState } from "@/lib/jury/types";
import { JuryPhoto } from "./jury-photo";

export function Reveal({ reveal, trophyHref = "/jokes/trophies" }: { reveal: JuryReveal; trophyHref?: string }) {
  const { winner, pick, round, earned, support } = reveal;
  if (!winner) return <section className="jury-reveal quiet-verdict"><span className="jury-kicker">LAST VERDICT · {juryDate(round.round_day)}</span><h2>A quiet day in court.</h2><p>No sealed ballots came in, so no winner or trophy was awarded. Today’s jury needs your verdict.</p></section>;
  return <section className={`jury-reveal ${earned ? "winning-verdict" : ""}`} aria-labelledby="verdict-title">
    <div className="verdict-art"><JuryPhoto src={winner.picture} alt={winner.description} /><span className="verdict-ribbon">THE JURY’S WINNER</span></div>
    <div className="verdict-copy"><span className="jury-kicker">THE VERDICT IS IN · {juryDate(round.round_day)}</span>
      <h2 id="verdict-title">{earned ? <>You called it! <span aria-hidden="true">✦</span></> : pick ? "The jury had other ideas." : "The crowd has spoken."}</h2>
      <blockquote>“{winner.caption_text}”</blockquote>
      {earned ? <><p className="golden-award"><span aria-hidden="true">✹</span> +1 Golden Laugh</p><p>Your pick won the crowd over. This joke now has a place in your collection.</p><Link className="jury-text-link" href={trophyHref}>See your trophy →</Link></> : pick ? <p>You backed “{pick.caption_text}”<br /><strong>{support}% of the jury picked it too.</strong> New evidence awaits below.</p> : <p>You weren’t on this jury. Take your seat in today’s round below.</p>}
      <small>{round.ballot_count} sealed {round.ballot_count === 1 ? "ballot" : "ballots"} · Winner chosen by Funny / Meh ratings</small>
    </div>
  </section>;
}

export function DailyJury({ state }: { state: JuryState }) {
  const router = useRouter();
  const [ratings, setRatings] = useState<Record<string, number>>(state.ballot?.ratings ?? {});
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
  const rated = state.entries.filter(entry => ratings[entry.caption_id] === 1 || ratings[entry.caption_id] === -1).length;
  const closed = remaining === 0;
  const locked = Boolean(sealed) || busy || closed;
  const pick = state.entries.find(entry => entry.caption_id === (sealed?.pick_id ?? pickId));
  const timeLabel = remaining === null ? "Closes at midnight ET" : closed ? "Round closed" : `${Math.floor(remaining / 3600000)}h ${Math.floor(remaining % 3600000 / 60000)}m left`;

  async function submit() {
    if (sending.current || sealed || rated !== 5 || !pickId || closed) return;
    sending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/jury", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roundDay: state.today, ratings, pickId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not seal your verdict. Please try again.");
      setSealed({ ratings, pick_id: pickId });
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Connection lost. Your verdict hasn’t been confirmed. Please try again."); }
    finally { sending.current = false; setBusy(false); }
  }

  return <div className="daily-jury">
    <div className="jury-member-bar"><span>YOUR DAILY COMEDY RITUAL</span><Link href="/jokes/trophies"><span aria-hidden="true">✹</span> {state.rewardCount} Golden {state.rewardCount === 1 ? "Laugh" : "Laughs"} <span aria-hidden="true">↗</span></Link></div>
    {state.reveal && <Reveal reveal={state.reveal} />}
    <section className="jury-court" aria-labelledby="jury-title">
      <header className="jury-heading"><div><span className="jury-kicker">COMEDY COURT · {juryDate(state.today)}</span><h2 id="jury-title">The floor is yours,<br /><em>your humor.</em></h2><p>Five exhibits. Your honest ratings. One prediction.<br />Return tomorrow to see whether your pick wins a Golden Laugh.</p></div><div className="jury-seal" aria-hidden="true">THE<br /><strong>COMEDY<br />JURY</strong><span>IN SESSION</span></div></header>
      <div className="jury-round-meta"><span>{timeLabel}</span><span>{sealed ? "VERDICT SEALED" : `${rated} / 5 EXHIBITS RATED`}</span></div>
      {!state.round ? <div className="jury-waiting"><h3>The evidence is still coming in.</h3><p>We need five different images to open the first round. Add a photo below, then check back.</p></div> : <>
        <p className="jury-instructions"><strong>01 / Rate what makes you laugh.</strong> Hover over a witness or tap their photo to hear the testimony. Then pick who wins the crowd.</p>
        <div className="courtroom-scene"><div className="courtroom-sign" aria-hidden="true"><span>⚖</span> THE PEOPLE v. BAD JOKES <small>FIVE WITNESSES · ONE VERDICT</small></div><div className="jury-exhibits">{state.entries.map(entry => <article className={`jury-exhibit ${openWitness === entry.caption_id ? "testifying" : ""} ${pickId === entry.caption_id ? "picked-exhibit" : ""}`} key={entry.caption_id}>
          <div className="witness-stage">
            <div className="witness-testimony" id={`testimony-${entry.caption_id}`}><span>THE WITNESS SAYS…</span><p>“{entry.caption_text}”</p></div>
            <button type="button" className="witness-portrait" aria-label={`Hear witness ${entry.position}: ${entry.caption_text}`} aria-pressed={openWitness === entry.caption_id} onClick={() => setOpenWitness(current => current === entry.caption_id ? null : entry.caption_id)}>
              <JuryPhoto src={entry.picture} alt={entry.description} />
            </button>
            <div className="witness-stand" aria-hidden="true"><div className="stand-rail" /><div className="stand-spindles">{[0,1,2,3,4].map(n => <i key={n} />)}</div><div className="stand-plaque">WITNESS {String(entry.position).padStart(2, "0")}</div><div className="stand-base" /></div>
          </div>
          <div className="jury-exhibit-copy"><div className="jury-rating" role="group" aria-label={`Rate exhibit ${entry.position}`}><button type="button" disabled={locked} aria-pressed={ratings[entry.caption_id] === 1} onClick={() => setRatings(current => ({ ...current, [entry.caption_id]: 1 }))}>↑ Funny</button><button type="button" disabled={locked} aria-pressed={ratings[entry.caption_id] === -1} onClick={() => setRatings(current => ({ ...current, [entry.caption_id]: -1 }))}>↓ Meh</button></div>
            <label className="jury-pick"><input type="radio" name={`winner-${state.today}`} value={entry.caption_id} checked={pickId === entry.caption_id} disabled={locked} onChange={() => setPickId(entry.caption_id)} /><span>{pickId === entry.caption_id ? "My pick to win ✦" : "Pick to win"}</span></label>
          </div>
        </article>)}</div><div className="courtroom-floor-label" aria-hidden="true">YOUR SEAT ON THE JURY</div></div>
        <div className={`jury-submit ${sealed ? "is-sealed" : ""}`}>
          {sealed ? <><span className="sealed-mark" aria-hidden="true">✓</span><div role="status"><h3>Your verdict is sealed.</h3><p>You backed “{pick?.caption_text}”</p><p>Come back after midnight ET for the reveal. A winning pick earns one Golden Laugh automatically.</p></div></> : <><div><span className="jury-kicker">02 / MAKE YOUR PREDICTION OFFICIAL</span><h3>{pick ? `Exhibit ${String(pick.position).padStart(2, "0")} is your pick.` : "Who will win the crowd?"}</h3><p>Rate all five and select one pick. Your ratings and pick are final once sealed.</p></div><button className="seal-verdict-button" disabled={busy || rated !== 5 || !pickId || closed} onClick={submit}>{busy ? "Sealing…" : closed ? "Round closed" : "Seal my verdict ↗"}</button></>}
        </div>
        {error && <div className="jury-error" role="alert"><p>{error}</p><button onClick={() => router.refresh()}>Refresh round</button></div>}
      </>}
      <details className="jury-rules"><summary>How does the jury work?</summary><p>Everyone gets the same five exhibits for the day. Funny adds one point; Meh subtracts one. Only complete, sealed ballots count. The highest score wins. Ties go to the earlier exhibit number. Predictions don’t affect the score.</p><p>Rounds close at midnight in America/New_York, including daylight saving time. Results appear on the first visit after closing. No ballots means no winner. A correct prediction earns exactly one Golden Laugh, saved automatically even if you miss the next day.</p></details>
    </section>
  </div>;
}
