import { NextResponse } from "next/server";
import { withSession } from "@/lib/sidia/session";
import { fetchEntries, groupByDate } from "@/lib/sidia/entries";

// Half a year of Sundays. Enough to look back over a term without shipping
// the school's entire history to the browser on every page load.
const MAX_DATES = 26;

export async function GET() {
  try {
    const groups = await withSession(async (session) =>
      groupByDate(await fetchEntries(session), MAX_DATES)
    );
    return NextResponse.json({ groups });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
