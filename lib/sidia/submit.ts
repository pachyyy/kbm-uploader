import * as cheerio from "cheerio";
import { SIDIA_URLS } from "./config";
import {
  cookieHeader,
  mergeSetCookies,
  isLoginPage,
  refreshCsrfToken,
  USER_AGENT,
} from "./session";
import type { getSession } from "./session";

type Session = Awaited<ReturnType<typeof getSession>>;

export interface StoreInput {
  tanggal: string; // yyyy-mm-dd — confirmed format from the live datepicker config
  pendidikId: string;
  kelompok: string;
  jenisPembelajaran: string;
  materi: string;
  catatan: string;
  foto1: Blob;
  foto2: Blob;
  foto3: Blob;
}

export type StoreOutcome =
  | { ok: true; uuid: string }
  | { ok: false; reason: "session_expired" }
  | { ok: false; reason: "rejected"; detail: string };

export type FinalizeOutcome =
  | { ok: true }
  | { ok: false; reason: "session_expired" }
  | { ok: false; reason: "rejected"; detail: string };

/**
 * Finds the just-created record's uuid by matching the newest ajax_index
 * row on pendidik_id + tanggal. POST /store redirects rather than returning
 * JSON, so there is no id/uuid in the store response itself — this lookup
 * is the only way to obtain it for the finalize step.
 */
async function findUuidOf(
  session: Session,
  pendidikId: string,
  tanggal: string
): Promise<string | null> {
  const params = new URLSearchParams({
    draw: "1",
    "columns[0][data]": "DT_RowIndex",
    "columns[1][data]": "tgl_short",
    "start": "0",
    "length": "25",
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

  if (!res.ok) return null;

  const json = (await res.json()) as {
    data: Array<{
      uuid: string;
      pendidik_id: number | string;
      tanggal: string;
      created_at: string;
    }>;
  };

  const matches = json.data.filter(
    (row) =>
      String(row.pendidik_id) === String(pendidikId) &&
      row.tanggal === tanggal
  );
  if (matches.length === 0) return null;

  // Most recently created match — guards against picking up an older entry
  // for the same teacher/date if one already existed.
  matches.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return matches[0].uuid;
}

/**
 * Step 1: POST /jadwal/store — creates the record as a DRAFT.
 * Returns the new record's uuid (via findUuidOf) so it can be finalized.
 */
export async function storeEntry(
  session: Session,
  input: StoreInput
): Promise<StoreOutcome> {
  const token = await refreshCsrfToken(session).catch((err) => {
    if (err instanceof Error && err.message === "SIDIA_SESSION_EXPIRED") {
      return null;
    }
    throw err;
  });
  if (token === null) return { ok: false, reason: "session_expired" };

  const form = new FormData();
  form.set("_token", token);
  form.set("tanggal", input.tanggal);
  form.set("pendidik_id", input.pendidikId);
  form.set("kelompok", input.kelompok);
  form.set("jenis_pembelajaran", input.jenisPembelajaran);
  form.set("materi", input.materi);
  form.set("catatan", input.catatan);
  form.set("foto1", input.foto1, "foto1.jpg");
  form.set("foto2", input.foto2, "foto2.jpg");
  form.set("foto3", input.foto3, "foto3.jpg");

  const res = await fetch(SIDIA_URLS.store, {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "text/html",
      cookie: cookieHeader(session.cookies),
      referer: SIDIA_URLS.create,
      "user-agent": USER_AGENT,
    },
    body: form,
  });
  mergeSetCookies(res, session.cookies);

  if (res.status !== 302) {
    const html = await res.text().catch(() => "");
    if (isLoginPage(html)) return { ok: false, reason: "session_expired" };

    // Laravel validation failures re-render the create form with errors.
    const $ = cheerio.load(html);
    const errors = $(".alert-danger, .help-block.text-danger, .invalid-feedback")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join("; ");
    return {
      ok: false,
      reason: "rejected",
      detail: errors || `Unexpected status ${res.status}`,
    };
  }

  const uuid = await findUuidOf(session, input.pendidikId, input.tanggal);
  if (!uuid) {
    return {
      ok: false,
      reason: "rejected",
      detail:
        "Store appeared to succeed (302 redirect) but the new record could not be located in ajax_index to finalize it.",
    };
  }

  return { ok: true, uuid };
}

/**
 * Step 2: GET /jadwal/kirim_ke_penyuluh?uuid=... — finalizes the draft.
 * Confirmed from the live action-menu markup in ajax_index's "action" field;
 * it is a plain GET with no request body / token, triggered via onclick in
 * the real UI. Behavior should be verified against a real draft before
 * relying on this for a batch run.
 */
export async function finalizeEntry(
  session: Session,
  uuid: string
): Promise<FinalizeOutcome> {
  const url = `${SIDIA_URLS.kirimKePenyuluh}?uuid=${encodeURIComponent(uuid)}`;
  const res = await fetch(url, {
    redirect: "manual",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      cookie: cookieHeader(session.cookies),
      "x-requested-with": "XMLHttpRequest",
      referer: SIDIA_URLS.ajaxIndex,
      "user-agent": USER_AGENT,
    },
  });
  mergeSetCookies(res, session.cookies);

  if (res.status === 302) {
    const html = await res.text().catch(() => "");
    if (isLoginPage(html)) return { ok: false, reason: "session_expired" };
    return { ok: true };
  }

  if (res.ok) {
    // Some SweetAlert-driven endpoints return 200 + JSON {status:true/false}
    // rather than a redirect. Handle both shapes defensively.
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { status?: boolean; message?: string };
      if (json.status === false) {
        return {
          ok: false,
          reason: "rejected",
          detail: json.message || "kirim_ke_penyuluh reported failure",
        };
      }
      return { ok: true };
    } catch {
      // Non-JSON 200 — treat as success since status was OK, but this is
      // exactly the ambiguous case verification step 4/5 in the plan exists
      // to catch. Do not trust this blindly.
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: "rejected",
    detail: `Unexpected status ${res.status} from kirim_ke_penyuluh`,
  };
}
