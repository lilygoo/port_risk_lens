import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
