"use client";
/* eslint-disable @next/next/no-img-element -- Signed Storage URLs and existing illustrations render directly. */
import { useState } from "react";

export function JuryPhoto({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return !src || failed ? <div className="jury-photo-missing">The photo is unavailable.<br />The punchline lives on.</div> : <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
