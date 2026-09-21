import Link from "next/link";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">THE HUMOR PROJECT</p>
      <h1>Hello,<br /><span>World.</span></h1>
      <p className="intro">Every great project starts with a hello.</p>
      <Link href="/jokes" className="browse-link">Explore the jokes →</Link>
      <footer>Stanley Chung <span>Columbia · Fall 2026</span></footer>
    </main>
  );
}
