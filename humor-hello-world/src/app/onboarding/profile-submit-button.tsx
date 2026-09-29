"use client";

import { useFormStatus } from "react-dom";

export function ProfileSubmitButton() {
  const { pending } = useFormStatus();
  return <button className="primary-action profile-submit" type="submit" disabled={pending}>{pending ? "Saving your profile…" : "Continue to the jokes"}</button>;
}
