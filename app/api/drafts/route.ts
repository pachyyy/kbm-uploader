import { NextResponse } from "next/server";
import { withSession } from "@/lib/sidia/session";
import { fetchDrafts } from "@/lib/sidia/entries";

/**
 * The drafts still awaiting "kirim ke penyuluh" for one date. Drives the
 * count on the send button, so the page reflects SIDIA rather than whatever
 * this browser happens to remember doing.
 */
export async function GET(req: Request) {
  const tanggal = new URL(req.url).searchParams.get("tanggal");
  if (!tanggal) {
    return NextResponse.json({ error: "Missing ?tanggal=yyyy-mm-dd" }, { status: 400 });
  }

  try {
    const drafts = await withSession((session) => fetchDrafts(session, tanggal));
    return NextResponse.json({ drafts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
