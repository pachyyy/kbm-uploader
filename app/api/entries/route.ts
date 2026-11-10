import { NextResponse } from "next/server";
import { withSession } from "@/lib/sidia/session";
import { fetchEntriesForDate } from "@/lib/sidia/entries";

/**
 * All entries SIDIA holds for one date, any status. Read by the upload page
 * right before a draft run so it never files a second entry for a teacher who
 * already has one.
 */
export async function GET(req: Request) {
  const tanggal = new URL(req.url).searchParams.get("tanggal");
  if (!tanggal || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return NextResponse.json({ error: "Missing ?tanggal=yyyy-mm-dd" }, { status: 400 });
  }

  try {
    const entries = await withSession((session) => fetchEntriesForDate(session, tanggal));
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
