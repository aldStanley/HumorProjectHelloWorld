"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="collection-message" role="alert"><h1>We couldn’t load the jokes.</h1><p>Your account is still signed in. Try loading the collection again.</p><div className="message-actions"><button className="primary-action" onClick={reset}>Try again</button><Link className="secondary-action" href="/">Back home</Link></div></section>;
}
