export type CaptionSource = "ai" | "human" | "unknown";

export function CaptionSourceTag({ source }: { source?: CaptionSource }) {
  if (!source || source === "unknown") return null;
  return <span className="caption-source-tag">{source === "ai" ? "AI-generated" : "Human-written"}</span>;
}
