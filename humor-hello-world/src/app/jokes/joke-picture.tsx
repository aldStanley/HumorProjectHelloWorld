"use client";

import { useState } from "react";

export function JokePicture({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const valid = /^(https?:\/\/|\/(?!\/))/.test(src);
  if (failed || !valid) {
    return <div className="picture-fallback" role="img" aria-label="Joke image unavailable">Image unavailable</div>;
  }
  // User-provided image hosts vary; a native image avoids an unrestricted image proxy.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Joke illustration" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
