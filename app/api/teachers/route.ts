import { NextResponse } from "next/server";
import { withSession } from "@/lib/sidia/session";
import { fetchTeachers } from "@/lib/sidia/teachers";

export async function GET() {
  try {
    const teachers = await withSession(fetchTeachers);
    return NextResponse.json({ teachers });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
