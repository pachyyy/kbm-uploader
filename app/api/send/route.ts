import { NextResponse } from "next/server";
import { SessionExpiredError, withSession } from "@/lib/sidia/session";
import { fetchDrafts } from "@/lib/sidia/entries";
import { finalizeEntry } from "@/lib/sidia/submit";
import type { SendResult } from "@/lib/types";

export const maxDuration = 60;

/**
 * Finalizes every draft on one date. The list is re-read from SIDIA here
 * rather than accepted from the client, so a stale page can never send a uuid
 * that has already gone out — or miss one drafted from another device.
 */
export async function POST(req: Request) {
  const { tanggal } = (await req.json().catch(() => ({}))) as { tanggal?: string };
  if (!tanggal) {
    return NextResponse.json({ error: "Missing tanggal." }, { status: 400 });
  }

  try {
    const results = await withSession(async (session) => {
      const drafts = await fetchDrafts(session, tanggal);
      const sent: SendResult[] = [];

      for (const draft of drafts) {
        const outcome = await finalizeEntry(session, draft.uuid);

        // Only replay the whole run if nothing has gone out yet. Past the
        // first success a re-login would re-finalize entries that already
        // succeeded, so surface the expiry as a per-entry failure instead and
        // let the user click Send again — by then the drafts list will have
        // shrunk to just the ones still outstanding.
        if (!outcome.ok && outcome.reason === "session_expired") {
          if (sent.length === 0) throw new SessionExpiredError();
          sent.push({
            uuid: draft.uuid,
            namaPendidik: draft.namaPendidik,
            kelompok: draft.kelompok,
            ok: false,
            message: "SIDIA session expired part-way through — click Send again.",
          });
          continue;
        }

        sent.push({
          uuid: draft.uuid,
          namaPendidik: draft.namaPendidik,
          kelompok: draft.kelompok,
          ok: outcome.ok,
          message: outcome.ok ? undefined : outcome.detail,
        });
      }

      return sent;
    });

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
