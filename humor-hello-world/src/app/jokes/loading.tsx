export default function Loading() {
  return <section aria-busy="true" aria-label="Loading jokes">
    <div className="collection-meta"><h2>Finding your next laugh…</h2></div>
    <div className="joke-grid">
      {[1, 2].map((item) => <div className="joke-card skeleton-card" key={item}><div className="skeleton-picture" /><div className="skeleton-copy"><div className="skeleton-line" /><div className="skeleton-line short" /></div></div>)}
    </div>
  </section>;
}
