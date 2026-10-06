import { isSameOrigin } from "@/lib/captions/request";
import { createClient } from "@/lib/supabase/server";
import { generateCaptions } from "@/lib/captions/generate";
import { imageExtension, MAX_IMAGE_BYTES } from "@/lib/captions/validation";

export const runtime = "nodejs";
export const maxDuration = 120;
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail("Invalid request origin.", 403);
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail("Sign in to generate captions.", 401);
  if (!process.env.GEMINI_API_KEY?.trim()) return fail("Caption generation is not configured yet. The site owner needs to add the Gemini API key.", 503);
  if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES + 65536) return fail("Choose an image smaller than 3 MB.", 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return fail("Invalid upload.", 400); }
  const photo = form.get("photo");
  if (!(photo instanceof File) || !photo.size || photo.size > MAX_IMAGE_BYTES) return fail("Choose a JPG, PNG, or WebP image up to 3 MB.", 400);
  const bytes = Buffer.from(await photo.arrayBuffer());
  const extension = imageExtension(bytes, photo.type);
  if (!extension) return fail("This file is not a supported JPG, PNG, or WebP image.", 400);
  const { data: image, error: reserveError } = await client.rpc("reserve_caption_image", { extension }).single<{ id: string; storage_path: string }>();
  if (reserveError || !image) return fail(reserveError?.message.includes("Daily limit") ? "You’ve used today’s 10 uploads. Come back tomorrow." : "Could not prepare your upload. Please try again later.", reserveError?.message.includes("Daily limit") ? 429 : 500);
  try {
    const { error: uploadError } = await client.storage.from("caption-images").upload(image.storage_path, bytes, { contentType: photo.type, upsert: false });
    if (uploadError) throw new Error("Your photo could not be saved. Please try again.");
    const { description, captions } = await generateCaptions(bytes, photo.type);
    const { error: saveError } = await client.rpc("save_caption_draft", { target_id: image.id, image_description: description, alternatives: captions });
    if (saveError) throw new Error("Your captions could not be saved. Please try again.");
    return Response.json({ imageId: image.id, captions }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Deletion policy cannot remove published photos, even after an ambiguous network failure.
    const { error: cleanupError } = await client.storage.from("caption-images").remove([image.storage_path]);
    const { error: statusError } = await client.rpc("fail_caption_image", { target_id: image.id });
    if (cleanupError || statusError) console.error("Caption cleanup incomplete", image.id);
    return fail(error instanceof Error && error.name !== "TimeoutError" ? error.message : "The writer took too long. Please try again.", 502);
  }
}
