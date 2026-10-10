"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function GoogleSignIn() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setPending(true);
    setFailed(false);
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          // Supabase handles Google's fixed callback, then returns to this deployment.
          // The SSR browser client saves the PKCE verifier in same-origin cookies.
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="google-sign-in">
      <button className="primary-action" type="button" disabled={pending} onClick={signIn}>
        {pending ? "Opening Google…" : "Continue with Google"}
      </button>
      {failed && <p role="alert">Google sign-in couldn’t start. Please try again.</p>}
    </div>
  );
}
