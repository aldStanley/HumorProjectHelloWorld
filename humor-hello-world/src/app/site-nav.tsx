"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home", key: "home" },
  { href: "/jokes", label: "Caption Lab", key: "jokes" },
  { href: "/jokes/mine", label: "My creations", key: "mine" },
  { href: "/profile", label: "Profile", key: "profile" },
] as const;

export function SiteNav({ active }: { active?: "home" | "jokes" | "profile" }) {
  const pathname = usePathname();
  const current = pathname === "/jokes/mine" ? "mine" : active;
  return <nav className="site-nav" aria-label="Main navigation">
    <Link href="/" className="brand">THE HUMOR PROJECT</Link>
    <div className="nav-links">
      {links.map((link) => <Link key={link.key} href={link.href} className={current === link.key ? "nav-current" : undefined} aria-current={current === link.key ? "page" : undefined}>{link.label}</Link>)}
    </div>
  </nav>;
}
