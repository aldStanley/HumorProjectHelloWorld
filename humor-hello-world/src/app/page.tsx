import Link from "next/link";
import { SiteNav } from "./site-nav";

export default function Home() {
  return (
    <main className="hero">
      <SiteNav active="home" />
      <section className="hero-content">
        <p className="eyebrow">A LITTLE LAUGHTER, ON DEMAND</p>
        <h1>Hello,<br /><span>World.</span></h1>
        <p className="intro">Every great project starts with a hello.<br />Discover a collection of visual jokes made for a quick laugh.</p>
        <div className="action-row">
          <Link href="/jokes" className="primary-action">View the joke collection <span aria-hidden="true">→</span></Link>
          <span className="action-hint">Google sign-in required</span>
        </div>
      </section>
      <footer>Stanley Chung <span>Columbia · Fall 2026</span></footer>
    </main>
  );
}
