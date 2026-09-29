import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedProfile } from "@/lib/supabase/auth";

function failed(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login?error=signin", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest) {
  // Google Identity Services uses a form POST and a double-submit CSRF cookie.
  if (request.nextUrl.search || !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return failed(request);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failed(request);
  }
  const cookieToken = request.cookies.get("g_csrf_token")?.value;
  const bodyToken = form.get("g_csrf_token");
  const credential = form.get("credential");
  if (!cookieToken || typeof bodyToken !== "string" || typeof credential !== "string" || !credential) {
    return failed(request);
  }
  const expected = Buffer.from(cookieToken);
  const actual = Buffer.from(bodyToken);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return failed(request);
  }

  const client = await createClient();
  const { data, error } = await client.auth.signInWithIdToken({ provider: "google", token: credential });
  if (error) return failed(request);

  const destination = data.user && hasCompletedProfile(data.user) ? "/jokes" : "/onboarding";
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.delete("g_csrf_token");
  return response;
}

export async function GET(request: NextRequest) {
  return failed(request);
}
