import { NextResponse } from "next/server";
import { withSession } from "@/lib/sidia/session";
import { fetchEntries, groupByDate } from "@/lib/sidia/entries";

// The five most recent dates that have entries — roughly the last five weeks
// of classes, and counted in dates rather than calendar days so a skipped
// Sunday (libur) doesn't quietly shrink the list to four.
//
// This trims the response to the browser, not the read from SIDIA: ajax_index
// returns rows in arbitrary order with no usable date filter, so the full
// table still has to be pulled and sliced here. See fetchEntries.
const MAX_DATES = 5;

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
