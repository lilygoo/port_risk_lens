import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const destination = request.nextUrl.clone();
  destination.pathname = "/";
  destination.search = "";
  return NextResponse.redirect(destination);
}
