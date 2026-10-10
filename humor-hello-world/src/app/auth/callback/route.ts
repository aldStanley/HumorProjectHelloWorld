import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isProfileComplete } from "@/lib/supabase/profiles";

function redirect(request: NextRequest, destination: string) {
  // Only fixed local destinations: never redirect to a user-supplied next URL.
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || request.nextUrl.searchParams.has("error")) {
    return redirect(request, "/login?error=signin");
  }

  const client = await createClient();
  // The exchange requires the verifier saved on the deployment that started login.
  // The server client writes the authenticated session into that host's cookies.
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");
  const { data, error } = await client.auth.exchangeCodeForSession(code,
    flowId === null ? undefined : { flowId });
  if (error || !data.user) return redirect(request, "/login?error=signin");

  const { data: profile } = await client.from("profiles")
    .select("id,first_name,last_name,avatar_path").eq("id", data.user.id).maybeSingle();
  return redirect(request, isProfileComplete(profile) ? "/" : "/onboarding");
}

export async function POST(request: NextRequest) {
  return redirect(request, "/login?error=signin");
}
