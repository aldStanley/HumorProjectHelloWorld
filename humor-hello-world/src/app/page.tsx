import Link from "next/link";
import { SiteNav } from "./site-nav";

export default function Home() {
  return (
    <main className="hero">
      <SiteNav active="home" />
      <section className="hero-content">
        <p className="eyebrow">A LITTLE LAUGHTER, ON DEMAND</p>
        <h1>Picture<br /><span>this.</span></h1>
        <p className="intro">Your camera roll has comedy potential.<br />Turn photos into AI captions, then vote on what makes you laugh.</p>
        <div className="action-row">
          <Link href="/jokes" className="primary-action">Enter the caption lab <span aria-hidden="true">→</span></Link>
          <span className="action-hint">Google sign-in required</span>
        </div>
      </section>
      <footer>Stanley Chung <span>Columbia · Fall 2026</span></footer>
    </main>
  );
}
