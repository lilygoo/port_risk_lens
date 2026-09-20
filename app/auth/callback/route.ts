import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = request.nextUrl.clone();
  destination.pathname = code ? "/" : "/login";
  destination.search = code ? "" : "error=invalid_link";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      destination.pathname = "/login";
      destination.search = "error=invalid_link";
    }
  }
  return NextResponse.redirect(destination);
}
