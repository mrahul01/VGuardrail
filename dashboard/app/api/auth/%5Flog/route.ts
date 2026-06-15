import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * NextAuth's client (`next-auth/react`) POSTs diagnostic logs to
 * `/api/auth/_log`. With our custom (non-`[...nextauth]`) route layout that
 * path 404s, which surfaces in the browser console. This is a no-op sink that
 * simply acknowledges the log so the client stops erroring.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({});
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({});
}
