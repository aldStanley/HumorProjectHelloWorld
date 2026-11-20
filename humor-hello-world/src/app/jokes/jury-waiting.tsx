export function JuryWaiting({ signedIn }: { signedIn: boolean }) {
  return <div className="jury-waiting">
    <h3 id="jury-title">{signedIn ? "The evidence is still coming in." : "Take your seat on today’s jury."}</h3>
    <p>{signedIn
      ? "We need three published captions to open today’s round. Add a photo above, then check back."
      : "Today’s round opens when a member signs in. Sign in to open the jury and choose your favorite joke."}</p>
    {!signedIn && <Link className="primary-action" href="/login">Sign in to open today’s jury ↗</Link>}
  </div>;
}
import Link from "next/link";

