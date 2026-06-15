import { NextResponse } from "next/server";
import { refreshStoredSession } from "@/lib/auth/session-store";
import { isLocalAuthDisabled, MOCK_USER_SESSION } from "@/lib/auth/local-mode";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  // Local-dev mode: always return mock session.
  if (isLocalAuthDisabled()) {
    return NextResponse.json({ session: MOCK_USER_SESSION });
  }

  const session = await refreshStoredSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Session expired" } },
      { status: 401 }
    );
  }
  return NextResponse.json({ session: session.session });
}
