import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hello World | The Humor Project",
  description: "Stanley Chung's first Next.js app for The Humor Project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
