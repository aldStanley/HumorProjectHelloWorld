"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="collection-message" role="alert"><h1>We couldn’t load the jokes.</h1><p>Please try again in a moment.</p><button className="browse-link" onClick={reset}>Try again</button></section>;
}
