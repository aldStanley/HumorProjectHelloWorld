import Link from "next/link";

export default function JokesLayout({ children }: { children: React.ReactNode }) {
  return <main className="collection"><nav aria-label="Main navigation"><Link href="/" className="brand">THE HUMOR PROJECT</Link><Link href="/jokes" aria-current="page">Jokes</Link></nav>{children}<footer>Stanley Chung <span>Columbia · Fall 2026</span></footer></main>;
}
