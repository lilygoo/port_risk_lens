import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const genericMessage = "If this email is authorized, a sign-in link is on its way.";

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ message: "Supabase is not configured." }, { status: 503 });
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return NextResponse.json({ message: "Owner access is not configured." }, { status: 503 });
  const { email } = await request.json().catch(() => ({ email: "" }));
  if (String(email).trim().toLowerCase() !== ownerEmail) return NextResponse.json({ message: genericMessage });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: ownerEmail,
    options: { emailRedirectTo: `${siteUrl.replace(/\/$/, "")}/auth/callback`, shouldCreateUser: false },
  });
  if (error) return NextResponse.json({ message: "The sign-in link could not be sent." }, { status: 500 });
  return NextResponse.json({ message: genericMessage });
}
