import { NextResponse } from "next/server";
import { getSession, invalidateSession } from "@/lib/sidia/session";
import { fetchTeachers } from "@/lib/sidia/teachers";

export async function GET() {
  try {
    const session = await getSession();
    const teachers = await fetchTeachers(session);
    return NextResponse.json({ teachers });
  } catch (err) {
    if (err instanceof Error && err.message === "SIDIA_SESSION_EXPIRED") {
      invalidateSession();
      try {
        const session = await getSession();
        const teachers = await fetchTeachers(session);
        return NextResponse.json({ teachers });
      } catch (retryErr) {
        return NextResponse.json(
          { error: (retryErr as Error).message },
          { status: 502 }
        );
      }
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
