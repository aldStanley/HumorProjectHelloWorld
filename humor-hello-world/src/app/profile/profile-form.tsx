"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateProfile } from "@/app/auth/actions";
import type { Profile } from "@/lib/supabase/profiles";

function SaveButton() {
  const { pending } = useFormStatus();
  return <button className="primary-action profile-submit" type="submit" disabled={pending}>{pending ? "Saving changes…" : "Save profile"}</button>;
}

export function ProfileForm({ profile, avatarUrl, email }: { profile: Profile; avatarUrl: string | null; email: string }) {
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [temporaryPreview, setTemporaryPreview] = useState<string | null>(null);

  useEffect(() => () => { if (temporaryPreview) URL.revokeObjectURL(temporaryPreview); }, [temporaryPreview]);

  return <form className="profile-editor" action={updateProfile}>
    <section className="photo-section" aria-labelledby="photo-heading">
      <div className="profile-photo" aria-live="polite">
        {preview ? <img src={preview} alt="Profile photo preview" /> : <span aria-hidden="true">{profile.first_name?.charAt(0).toUpperCase()}</span>}
      </div>
      <div><h2 id="photo-heading">Profile photo</h2><p>Optional · JPG, PNG, or WebP · 5 MB maximum</p><label className="secondary-action upload-label" htmlFor="photo">Choose a photo</label><input className="visually-hidden" id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (temporaryPreview) URL.revokeObjectURL(temporaryPreview);
        const nextPreview = URL.createObjectURL(file);
        setTemporaryPreview(nextPreview);
        setPreview(nextPreview);
      }} /></div>
    </section>
    <div className="profile-fields">
      <div className="field-group"><label htmlFor="firstName">First name</label><input id="firstName" name="firstName" type="text" autoComplete="given-name" defaultValue={profile.first_name ?? ""} maxLength={50} required /></div>
      <div className="field-group"><label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" type="text" autoComplete="family-name" defaultValue={profile.last_name ?? ""} maxLength={50} required /></div>
      <div className="field-group email-field"><label htmlFor="email">Google email</label><input id="email" type="email" value={email} disabled /><span>Managed by your Google account</span></div>
    </div>
    <SaveButton />
  </form>;
}
