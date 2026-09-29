import { SiteNav } from "@/app/site-nav";

export default function JokesLayout({ children }: { children: React.ReactNode }) {
  return <main className="collection"><SiteNav active="jokes" />{children}<footer>Stanley Chung <span>Columbia · Fall 2026</span></footer></main>;
}
