"use client";
/* eslint-disable @next/next/no-img-element -- Private signed URLs and local preview URLs bypass the image optimizer. */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Joke } from "@/lib/supabase/jokes";
import { MAX_IMAGE_BYTES } from "@/lib/captions/validation";

export function UploadStudio() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const studio = useRef<HTMLElement>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upload") !== "1") return;
    const section = studio.current?.closest("details");
    if (section) { section.open = true; section.scrollIntoView({ block: "start" }); }
  }, []);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ imageId: string; captions: string[] } | null>(null);
  const [selection, setSelection] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function choose(file?: File) {
    if (busy || draft || !file) return;
    setError(""); setMessage("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_IMAGE_BYTES || !file.size) {
      setError("Choose a JPG, PNG, or WebP photo up to 3 MB."); return;
    }
    setPhoto(file); setPreview(URL.createObjectURL(file));
  }
  async function generate() {
    if (!photo || busy) return;
    setBusy(true); setError(""); setMessage("Reading your photo and writing three punchlines. This can take about a minute…");
    try {
      const body = new FormData(); body.set("photo", photo);
      const response = await fetch("/api/captions", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The writer is unavailable. Try again.");
      setDraft(result); setSelection(null); setCustom("");
      setMessage("Pick one punchline below, or write your own. Nothing is published yet.");
    } catch (err) { setMessage(""); setError(err instanceof Error ? err.message : "Connection lost. Please try again."); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!draft || selection === null || busy) return;
    const text = selection === 3 ? custom.trim() : draft.captions[selection];
    if (!text || text.length > 240) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/captions/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageId: draft.imageId, text }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not publish your joke.");
      setDraft(null); setSelection(null); setCustom(""); setPhoto(null); setPreview("");
      if (input.current) input.current.value = "";
      setMessage("Your joke is published!");
      router.push("/jokes/mine"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Connection lost. Please try again."); }
    finally { setBusy(false); }
  }
  return <section ref={studio} className="upload-studio" aria-labelledby="studio-title">
    <div className="studio-copy"><span className="lab-tag">THE CAPTION MACHINE</span><h2 id="studio-title">Your photo.<br />Our questionable humor.</h2><p>One photo. Three ideas. Your final punchline.<br />Pick a suggestion or write your own, then let the crowd judge.</p><div className="recipe"><span>01 / DROP</span><i>↗</i><span>02 / CAPTION</span><i>↗</i><span>03 / JUDGE</span></div></div>
    <div className="studio-controls">
      <button type="button" className={`drop-zone ${dragging ? "dragging" : ""} ${preview ? "with-preview" : ""}`} disabled={busy || Boolean(draft)} onClick={() => input.current?.click()}
        onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }} aria-label={photo ? "Change selected photo" : "Choose or drop a photo"}>
        {preview ? <>{/* Private signed URLs and local object URLs are intentionally rendered directly. */}
          <img src={preview} alt="Your selected photo" /><span className="preview-label">{photo?.name}{draft ? " · choose your punchline below" : " · click to change"}</span></> : <><span className="upload-symbol" aria-hidden="true">↥</span><strong>Drop something funny here</strong><span>or click to choose a photo</span><small>JPG, PNG, WEBP · UP TO 3 MB</small></>}
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" tabIndex={-1} aria-label="Photo upload" disabled={busy || Boolean(draft)} onChange={event => choose(event.target.files?.[0])} />
      {!draft && <button className="generate-button" disabled={!photo || busy} onClick={generate}>{busy ? <><span className="little-spinner" /> Cooking up captions…</> : <>Make it funny <span aria-hidden="true">↗</span></>}</button>}
      {draft && <fieldset className="caption-choices" disabled={busy}><legend>Choose your one punchline</legend><p>Only your chosen joke will be published.</p>{draft.captions.map((caption, index) => <label className="caption-choice" key={index}><input type="radio" name="caption-choice" checked={selection === index} onChange={() => setSelection(index)} /><span><small>OPTION {index + 1}</small>{caption}</span></label>)}<label className="caption-choice"><input type="radio" name="caption-choice" checked={selection === 3} onChange={() => setSelection(3)} /><span><small>OPTION 4</small>Write my own joke</span></label>{selection === 3 && <label className="custom-caption">Your joke<textarea value={custom} maxLength={240} rows={3} onChange={event => setCustom(event.target.value)} placeholder="Your photo deserves your best punchline…" /><small>{custom.length} / 240</small></label>}<button className="generate-button" disabled={selection === null || (selection === 3 && !custom.trim()) || busy} onClick={publish}>{busy ? "Publishing…" : "Publish this joke ↗"}</button></fieldset>}
      <p className="upload-consent">Photos are sent to Google Gemini for captioning and shared with signed-in members. Google may use free-tier content to improve its products. 10 uploads per 24 hours.</p>
      <p className="studio-status" role="status">{message}</p>{error && <p className="studio-error" role="alert">{error}</p>}
    </div>
  </section>;
}

export function CaptionCard({ joke, index }: { joke: Joke; index: number }) {
  const [vote, setVote] = useState(joke.vote);
  const [score, setScore] = useState(joke.score);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [broken, setBroken] = useState(false);
  async function cast(value: number) {
    if (busy || vote === value) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/votes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captionId: joke.id, value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your vote.");
      setScore(result.score ?? score - vote + value); setVote(result.value);
    } catch (err) { setError(err instanceof Error ? err.message : "Connection lost. Try again."); }
    finally { setBusy(false); }
  }
  return <article className={`caption-card${joke.isOwn ? " own-caption" : ""}`}>
    <div className="caption-photo"><span className="photo-label">{joke.isOwn ? <><span aria-hidden="true">✦ </span>From your photo</> : joke.image_id ? "FRESH FROM THE LAB" : "THE ORIGINALS"}</span>
      {broken || !joke.picture ? <div className="photo-missing">Photo unavailable</div> : <><img src={joke.picture} alt={joke.description} loading="lazy" onError={() => setBroken(true)} /></>}
      <span className="photo-index">/{String(index + 1).padStart(2, "0")}</span>
    </div>
    <div className="caption-body"><p className="caption-text">{joke.text}</p><div className="vote-bar"><div className="vote-buttons"><button disabled={busy} aria-pressed={vote === 1} aria-label="Upvote caption" className={vote === 1 ? "vote-up selected" : "vote-up"} onClick={() => cast(1)}>↑ <span>Funny</span></button><button disabled={busy} aria-pressed={vote === -1} aria-label="Downvote caption" className={vote === -1 ? "vote-down selected" : "vote-down"} onClick={() => cast(-1)}>↓ <span>Meh</span></button></div><span className="caption-score" aria-live="polite">{score > 0 ? "+" : ""}{score}<small>SCORE</small></span></div><p className="vote-status" role="status">{busy ? "Saving your vote…" : vote ? "Your vote is in. You can change your mind." : "Be the judge."}</p>{error && <p className="studio-error" role="alert">{error}</p>}</div>
  </article>;
}
