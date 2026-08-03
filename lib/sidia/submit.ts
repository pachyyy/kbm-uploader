import * as cheerio from "cheerio";
import { SIDIA_URLS } from "./config";
import {
  cookieHeader,
  mergeSetCookies,
  isLoginPage,
  fetchCreateFormContext,
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
  | { ok: false; reason: "rejected"; detail: string }
  // Store succeeded (302 away from the form) but the record could not be
  // located afterwards, so there is no uuid to finalize with. The record
  // very likely exists — callers must NOT treat this as a retryable failure.
  | { ok: false; reason: "created_but_not_found"; detail: string };

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
  // length=-1 returns every row in one response. This matters: ajax_index
  // does NOT sort newest-first (rows come back in an arbitrary DB order), so
  // a just-created record can land anywhere in the full result set. Paging a
  // fixed window would find it only intermittently. Server-side search is no
  // help either — the searchable date column is the formatted `tgl_short`
  // ("Minggu<br>02 Agt 2026"), so querying a raw yyyy-mm-dd matches nothing.
  const params = new URLSearchParams({
    draw: "1",
    "columns[0][data]": "DT_RowIndex",
    "columns[1][data]": "tgl_short",
    "start": "0",
    "length": "-1",
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
    data?: Array<{
      id: number;
      uuid: string;
      pendidik_id: number | string;
      tanggal: string;
    }>;
  };

  if (!Array.isArray(json.data)) return null;

  const matches = json.data.filter(
    (row) =>
      String(row.pendidik_id) === String(pendidikId) &&
      row.tanggal === tanggal
  );
  if (matches.length === 0) return null;

  // Highest id = most recently created. Sorting on `id` rather than
  // `created_at` because the latter only has second precision, which can't
  // separate two entries for the same teacher/date made in the same second.
  matches.sort((a, b) => b.id - a.id);
  return matches[0].uuid;
}

/**
 * Retries findUuidOf with a short backoff. SIDIA's 302 can arrive before the
 * new row is visible to ajax_index (replica lag / caching), so a single
 * immediate lookup misses it intermittently.
 */
async function findUuidWithRetry(
  session: Session,
  pendidikId: string,
  tanggal: string
): Promise<string | null> {
  const delaysMs = [0, 700, 1500, 3000];
  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const uuid = await findUuidOf(session, pendidikId, tanggal);
    if (uuid) return uuid;
  }
  return null;
}

/**
 * After a validation-failure redirect, Laravel flashes the error bag into the
 * session; the re-rendered create page shows it. Fetch it to surface the real
 * reason instead of a generic "could not locate record".
 */
async function readFlashedValidationErrors(
  session: Session
): Promise<string | null> {
  const res = await fetch(SIDIA_URLS.create, {
    redirect: "manual",
    headers: {
      accept: "text/html",
      cookie: cookieHeader(session.cookies),
      "user-agent": USER_AGENT,
    },
  });
  mergeSetCookies(res, session.cookies);
  if (res.status !== 200) return null;

  const $ = cheerio.load(await res.text());
  const errors = $(".alert-danger, .help-block.text-danger, .invalid-feedback")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .join("; ");
  return errors || null;
}

/**
 * Step 1: POST /jadwal/store — creates the record as a DRAFT.
 * Returns the new record's uuid (via findUuidOf) so it can be finalized.
 */
export async function storeEntry(
  session: Session,
  input: StoreInput
): Promise<StoreOutcome> {
  const ctx = await fetchCreateFormContext(session).catch((err) => {
    if (err instanceof Error && err.message === "SIDIA_SESSION_EXPIRED") {
      return null;
    }
    throw err;
  });
  if (ctx === null) return { ok: false, reason: "session_expired" };

  const form = new FormData();
  form.set("_token", ctx.token);
  // Identity fields the create form renders pre-filled. SIDIA's store
  // controller 500s if they're missing, so they must be echoed back.
  form.set("npsn", ctx.npsn);
  form.set("nama", ctx.nama);
  form.set("kecamatan", ctx.kecamatan);
  form.set("tanggal", input.tanggal);
  form.set("pendidik_id", input.pendidikId);
  form.set("kelompok", input.kelompok);
  form.set("jenis_pembelajaran", input.jenisPembelajaran);
  form.set("materi", input.materi);
  form.set("catatan", input.catatan);
  form.set("foto1", input.foto1, "foto1.jpg");
  form.set("foto2", input.foto2, "foto2.jpg");
  form.set("foto3", input.foto3, "foto3.jpg");
  // Optional in the real form; send empty so the field is always present.
  form.set("link_laporan", "");

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
    // A 500 renders Laravel's error page rather than the form, so the
    // validation selectors above find nothing. Surface the exception
    // message instead of a bare status code.
    const laravelError =
      $(".exception_title, .exception-message, h1, title").first().text().trim() ||
      $("body").text().trim().slice(0, 300);

    return {
      ok: false,
      reason: "rejected",
      detail:
        errors ||
        `SIDIA returned ${res.status}${laravelError ? `: ${laravelError}` : ""}`,
    };
  }

  // A 302 back to /create means Laravel rejected the input and is redirecting
  // with validation errors in the session — no record was created. Only a
  // redirect away from the form indicates a successful store.
  const location = res.headers.get("location") ?? "";
  if (location.includes("/jadwal/create")) {
    const errors = await readFlashedValidationErrors(session);
    return {
      ok: false,
      reason: "rejected",
      detail: errors
        ? `SIDIA rejected the entry: ${errors}`
        : "SIDIA redirected back to the create form (validation failed) but gave no error detail.",
    };
  }

  // The row is not always queryable the instant the 302 arrives. Retry a few
  // times before concluding it is missing.
  const uuid = await findUuidWithRetry(session, input.pendidikId, input.tanggal);
  if (!uuid) {
    return {
      ok: false,
      reason: "created_but_not_found",
      detail: `The entry was created in SIDIA but could not be located to send it to the penyuluh. Check this teacher in Riwayat — if it shows "Verifikasi Penyuluh" it is already done; if it is still a draft, send it manually. Do NOT re-upload, that would create a duplicate. (pendidik_id=${input.pendidikId}, tanggal=${input.tanggal})`,
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
