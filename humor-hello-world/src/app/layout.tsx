import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Columbia Caption Lab | The Humor Project",
  description: "Columbia and NYC laughs. Browse captions, vote for your favorites, and turn your photos into punchlines.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth"><body>{children}</body></html>;
}
