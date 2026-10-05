export type JuryEntry = {
  round_day: string;
  caption_id: string;
  position: number;
  caption_text: string;
  picture: string;
  private_image: boolean;
  description: string;
};
export type JuryResult = { caption_id: string; position: number; score: number; funny_votes: number; picks: number };
export type JuryRound = { round_day: string; closes_at: string; finalized_at: string | null; winner_id: string | null; ballot_count: number; results: JuryResult[] | null };
export type JuryBallot = { ratings: Record<string, number>; pick_id: string };
export type JuryReveal = { round: JuryRound; winner: JuryEntry | null; pick: JuryEntry | null; support: number | null; earned: boolean };
export type JuryState = { today: string; round: JuryRound | null; entries: JuryEntry[]; ballot: JuryBallot | null; reveal: JuryReveal | null; rewardCount: number };

export function juryDate(day: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

export function validateBallot(value: unknown): value is { roundDay: string; ratings: Record<string, number>; pickId: string } {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof body.roundDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.roundDay) || Number.isNaN(Date.parse(body.roundDay))) return false;
  if (typeof body.pickId !== "string" || !uuid.test(body.pickId)) return false;
  if (!body.ratings || typeof body.ratings !== "object" || Array.isArray(body.ratings)) return false;
  const ratings = Object.entries(body.ratings);
  return ratings.length === 5 && ratings.every(([id, rating]) => uuid.test(id) && (rating === 1 || rating === -1)) && Object.hasOwn(body.ratings, body.pickId);
}
