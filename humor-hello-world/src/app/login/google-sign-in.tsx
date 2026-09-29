"use client";

import Script from "next/script";
import { useRef, useState } from "react";
import { googleClientId } from "@/lib/google";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: {
            client_id: string;
            ux_mode: "redirect";
            login_uri: string;
            auto_select: boolean;
          }): void;
          renderButton(element: HTMLElement, options: {
            type: "standard";
            theme: "outline";
            size: "large";
            text: "continue_with";
          }): void;
        };
      };
    };
  }
}

export function GoogleSignIn() {
  const button = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  return (
    <div className="google-sign-in">
      <Script
        src="https://accounts.google.com/gsi/client"
        onReady={() => {
          if (!window.google || !button.current) {
            setFailed(true);
            return;
          }
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            ux_mode: "redirect",
            // Google posts the ID token here. No secret, next parameter, or query string.
            login_uri: `${window.location.origin}/auth/callback`,
            auto_select: false,
          });
          window.google.accounts.id.renderButton(button.current, {
            type: "standard", theme: "outline", size: "large", text: "continue_with",
          });
          setReady(true);
        }}
        onError={() => setFailed(true)}
      />
      <div ref={button} />
      {!ready && !failed && <p role="status">Loading Google sign-in…</p>}
      {failed && <p role="alert">Google sign-in couldn’t load. Please refresh to try again.</p>}
    </div>
  );
}
