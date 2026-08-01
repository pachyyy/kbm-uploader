import { NextResponse } from "next/server";
import { getSession, invalidateSession, cookieHeader, USER_AGENT } from "@/lib/sidia/session";
import { SIDIA_URLS } from "@/lib/sidia/config";

interface HistoryRow {
  uuid: string;
  tanggal: string;
  tgl_long: string;
  nama_pendidik: string;
  kelompok: string;
  jenis_pembelajaran: string;
  status: string;
}

async function fetchPage(session: Awaited<ReturnType<typeof getSession>>) {
  const params = new URLSearchParams({
    draw: "1",
    "columns[0][data]": "DT_RowIndex",
    "columns[1][data]": "tgl_short",
    "columns[2][data]": "nama_pendidik",
    "columns[3][data]": "kelompok",
    "columns[4][data]": "jenis_pembelajaran",
    "columns[7][data]": "status",
    start: "0",
    length: "50",
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

  if (!res.ok) {
    throw new Error(`ajax_index returned ${res.status}`);
  }

  const json = (await res.json()) as {
    data: Array<{
      uuid: string;
      tanggal: string;
      tgl_long: string;
      nama_pendidik: string;
      kelompok: string;
      jenis_pembelajaran: string;
      status: string;
    }>;
  };

  const rows: HistoryRow[] = json.data.map((r) => ({
    uuid: r.uuid,
    tanggal: r.tanggal,
    tgl_long: r.tgl_long,
    // nama_pendidik comes as "NAME<br>(Pendidik)" from SIDIA — strip the tag.
    nama_pendidik: r.nama_pendidik.replace(/<br\s*\/?>.*/i, "").trim(),
    kelompok: r.kelompok,
    jenis_pembelajaran: r.jenis_pembelajaran,
    // status comes as an HTML <span class="label ..."> — strip tags, keep text.
    status: r.status.replace(/<[^>]+>/g, "").trim(),
  }));

  return rows;
}

export async function GET() {
  try {
    const session = await getSession();
    const rows = await fetchPage(session);
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof Error && err.message === "SIDIA_SESSION_EXPIRED") {
      invalidateSession();
      try {
        const session = await getSession();
        const rows = await fetchPage(session);
        return NextResponse.json({ rows });
      } catch (retryErr) {
        return NextResponse.json({ error: (retryErr as Error).message }, { status: 502 });
      }
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
