import type { EntryGroup, SidiaEntry } from "../types";
import { SIDIA_URLS } from "./config";
import { cookieHeader, mergeSetCookies, USER_AGENT } from "./session";
import type { getSession } from "./session";

type Session = Awaited<ReturnType<typeof getSession>>;

interface RawRow {
  uuid: string;
  tanggal: string;
  tgl_long: string;
  nama_pendidik: string;
  kelompok: string;
  jenis_pembelajaran: string;
  status: string;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every KBM entry visible to this account.
 *
 * `length=-1` pulls the whole table in one response, deliberately. A fixed
 * window is not an option here: ajax_index returns rows in arbitrary DB order
 * rather than newest-first, so "the first 50" is really "an arbitrary 50" —
 * which, once grouped by date, would silently show 4 of a date's 15 entries.
 * Server-side search is no help either: the searchable date column is the
 * formatted `tgl_short` ("Minggu<br>02 Agt 2026"), so a raw yyyy-mm-dd query
 * matches nothing. Filtering therefore happens here, on the full set.
 */
export async function fetchEntries(session: Session): Promise<SidiaEntry[]> {
  const params = new URLSearchParams({
    draw: "1",
    "columns[0][data]": "DT_RowIndex",
    "columns[1][data]": "tgl_short",
    "columns[2][data]": "nama_pendidik",
    "columns[3][data]": "kelompok",
    "columns[4][data]": "jenis_pembelajaran",
    "columns[7][data]": "status",
    start: "0",
    length: "-1",
    "search[value]": "",
    "search[regex]": "false",
    _: String(Date.now()),
  });

  const res = await fetch(`${SIDIA_URLS.ajaxIndex}?${params.toString()}`, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      cookie: cookieHeader(session.cookies),
      "x-requested-with": "XMLHttpRequest",
      "user-agent": USER_AGENT,
    },
  });
  mergeSetCookies(res, session.cookies);

  if (!res.ok) {
    throw new Error(`ajax_index returned ${res.status}`);
  }

  const json = (await res.json()) as { data?: RawRow[] };
  if (!Array.isArray(json.data)) {
    throw new Error("ajax_index returned no data array — response shape changed.");
  }

  return json.data.map((r) => {
    // status arrives as an HTML <span class="label ...">; nama_pendidik as
    // "NAME<br>(Pendidik)" — keep only the part before the break.
    const status = stripTags(r.status);
    return {
      uuid: r.uuid,
      tanggal: r.tanggal,
      tglLong: r.tgl_long,
      // [\s\S] rather than the dotall flag: tsconfig targets ES2017, where /s
      // is not available, and the "(Pendidik)" suffix can sit on a new line.
      namaPendidik: r.nama_pendidik.replace(/<br[\s\S]*/i, "").trim(),
      kelompok: r.kelompok,
      jenisPembelajaran: r.jenis_pembelajaran,
      status,
      isDraft: status.toLowerCase().includes("draft"),
    };
  });
}

/**
 * Every entry filed for one date, whatever its status. The duplicate guard
 * before a draft run uses this: a teacher with any entry here (draft, sent or
 * verified) must not get a second one.
 */
export async function fetchEntriesForDate(
  session: Session,
  tanggal: string
): Promise<SidiaEntry[]> {
  const entries = await fetchEntries(session);
  return entries.filter((e) => e.tanggal === tanggal);
}

/** The still-unsent entries for one date — what "Send to penyuluh" acts on. */
export async function fetchDrafts(
  session: Session,
  tanggal: string
): Promise<SidiaEntry[]> {
  const entries = await fetchEntries(session);
  return entries.filter((e) => e.tanggal === tanggal && e.isDraft);
}

/** Groups entries by date, newest date first, capped to `maxDates`. */
export function groupByDate(entries: SidiaEntry[], maxDates: number): EntryGroup[] {
  const byDate = new Map<string, SidiaEntry[]>();
  for (const entry of entries) {
    const bucket = byDate.get(entry.tanggal);
    if (bucket) bucket.push(entry);
    else byDate.set(entry.tanggal, [entry]);
  }

  return Array.from(byDate.entries())
    // tanggal is yyyy-mm-dd, so lexical sort is chronological.
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, maxDates)
    .map(([tanggal, group]) => ({
      tanggal,
      tglLong: group[0].tglLong,
      total: group.length,
      draftCount: group.filter((e) => e.isDraft).length,
      entries: [...group].sort((a, b) =>
        a.kelompok.localeCompare(b.kelompok) ||
        a.namaPendidik.localeCompare(b.namaPendidik)
      ),
    }));
}
