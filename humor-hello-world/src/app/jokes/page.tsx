import type { Metadata } from "next";
import { CaptionLab } from "./caption-lab-page";

export const metadata: Metadata = { title: "Caption Lab | The Humor Project" };
export default function JokesPage({ searchParams }: { searchParams: Promise<{ page?: string; filter?: string }> }) {
  return <CaptionLab searchParams={searchParams} />;
}
