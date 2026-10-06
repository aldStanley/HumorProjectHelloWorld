import { notFound } from "next/navigation";
import JuryDemo from "./jury-demo";

export const metadata = { title: "Winner reveal demo | Comedy Jury", robots: { index: false, follow: false } };

export default function JuryDemoPage() {
  // Never expose fixtures in a production build, including Vercel previews.
  if (process.env.NODE_ENV !== "development") notFound();
  return <JuryDemo />;
}
