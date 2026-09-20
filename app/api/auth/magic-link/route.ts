import { NextResponse, type NextRequest } from "next/server";
export async function POST(_request: NextRequest) {
  return NextResponse.json({ message: "Supabase login is disabled; this deployment is protected by Vercel Authentication." }, { status: 410 });
}
