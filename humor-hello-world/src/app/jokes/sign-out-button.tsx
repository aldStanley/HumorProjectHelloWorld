"use client";

import { useFormStatus } from "react-dom";

export function SignOutButton() {
  const { pending } = useFormStatus();
  return <button className="sign-out" type="submit" disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>;
}
