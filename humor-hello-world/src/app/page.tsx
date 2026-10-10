import { CaptionLab } from "./jokes/caption-lab-page";
import { SiteNav } from "./site-nav";

export default function Home({ searchParams }: { searchParams: Promise<{ page?: string; filter?: string }> }) {
  return <main className="collection"><SiteNav active="jokes" /><CaptionLab searchParams={searchParams} baseHref="/" /><footer>Stanley Chung <span>Columbia · Fall 2026</span></footer></main>;
}
