"use client";

import { useState } from "react";
import { Reveal } from "@/app/jokes/daily-jury";
import { JuryPhoto } from "@/app/jokes/jury-photo";
import { juryDate, type JuryEntry, type JuryReveal } from "@/lib/jury/types";

const winner: JuryEntry = { round_day: "2026-10-05", caption_id: "demo-winner", position: 1, caption_text: "Why do programmers prefer dark mode? Because light attracts bugs.", picture: "/jokes/joke-3.svg", private_image: false, description: "An illustration from the joke collection" };
const other: JuryEntry = { ...winner, caption_id: "demo-other", position: 2, caption_text: "Why did the developer go broke? Because they used up all their cache.", picture: "/jokes/joke-1.svg" };
const scenarios = ["Winning pick", "Losing pick", "Didn’t participate", "No votes"] as const;
type Scenario = typeof scenarios[number];

export default function JuryDemo() {
  const [scenario, setScenario] = useState<Scenario>("Winning pick");
  const [replay, setReplay] = useState(0);
  const [revealed, setRevealed] = useState(true);
  const earned = scenario === "Winning pick";
  const quiet = scenario === "No votes";
  const reveal: JuryReveal = {
    round: { round_day: winner.round_day, closes_at: "2026-10-06T04:00:00Z", finalized_at: "2026-10-06T04:00:01Z", winner_id: quiet ? null : winner.caption_id, ballot_count: quiet ? 0 : 42, results: null },
    winner: quiet ? null : winner, pick: earned ? winner : scenario === "Losing pick" ? other : null, earned, support: earned ? 62 : 24,
  };
  return <main className="jury-demo">
    <header className="demo-toolbar"><span className="jury-kicker">LOCAL DEMO · SAMPLE RESULTS</span><h1>The verdict is ready.</h1><p>Show the next-day reveal without waiting for midnight. These examples never read or write your database.</p>
      <div className="demo-scenarios" role="group" aria-label="Reveal scenario">{scenarios.map(item => <button key={item} aria-pressed={scenario === item} onClick={() => { setScenario(item); setRevealed(true); setReplay(value => value + 1); }}>{item}</button>)}</div>
      <div className="demo-actions"><button onClick={() => setRevealed(false)}>Stage the reveal</button><button onClick={() => { setRevealed(true); setReplay(value => value + 1); }}>Replay reveal ↗</button></div>
    </header>
    {revealed ? <div key={`${scenario}-${replay}`}><Reveal reveal={reveal} trophyHref="#demo-trophy" />
      {earned && <section id="demo-trophy" className="demo-trophy"><h2>Your Golden Laugh collection</h2><p>1 sample trophy · Your winning prediction, remembered.</p><article className="trophy-card"><div className="trophy-photo"><JuryPhoto src={winner.picture} alt={winner.description} /><span aria-hidden="true">✹</span></div><div><span className="jury-kicker">{juryDate(winner.round_day)}</span><p>“{winner.caption_text}”</p><strong>You called it.</strong></div></article></section>}
    </div> : <section className="demo-envelope"><span aria-hidden="true">⚖</span><p>THE JURY HAS REACHED A VERDICT</p><h2>Did your pick win the crowd?</h2><button className="seal-verdict-button" onClick={() => { setRevealed(true); setReplay(value => value + 1); }}>Open the verdict ↗</button></section>}
    <p className="demo-footnote">Demo only. No sign-in, API key, votes, or real rewards required. Available through npm run dev; returns 404 in production.</p>
  </main>;
}
