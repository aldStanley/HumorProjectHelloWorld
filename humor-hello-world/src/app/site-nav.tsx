import Link from "next/link";

const links = [
  { href: "/", label: "Home", key: "home" },
  { href: "/jokes", label: "Jokes", key: "jokes" },
  { href: "/profile", label: "Profile", key: "profile" },
] as const;

export function SiteNav({ active }: { active?: "home" | "jokes" | "profile" }) {
  return <nav className="site-nav" aria-label="Main navigation">
    <Link href="/" className="brand">THE HUMOR PROJECT</Link>
    <div className="nav-links">
      {links.map((link) => <Link key={link.key} href={link.href} className={active === link.key ? "nav-current" : undefined} aria-current={active === link.key ? "page" : undefined}>{link.label}</Link>)}
    </div>
  </nav>;
}
