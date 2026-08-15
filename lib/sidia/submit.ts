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
  | { ok: true }
  | { ok: false; reason: "session_expired" }
  | { ok: false; reason: "rejected"; detail: string };

export type FinalizeOutcome =
  | { ok: true }
  | { ok: false; reason: "session_expired" }
  | { ok: false; reason: "rejected"; detail: string };

/**
 * After a validation-failure redirect, Laravel flashes the error bag into the
 * session; the re-rendered create page shows it. Fetch it to surface the real
 * reason instead of a generic "rejected".
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
 * Step 1 of 2: POST /jadwal/store — creates the record as a DRAFT.
 *
 * Deliberately does not try to identify the row it just created. POST /store
 * redirects rather than returning the new id, and the only way to recover it
 * is a full ajax_index scan that races against replica lag. Since finalizing
 * is now a separate user-driven step that reads its drafts back from SIDIA
 * (see fetchDrafts), the uuid simply isn't needed here.
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

  return { ok: true };
}

/**
 * Step 2 of 2: GET /jadwal/kirim_ke_penyuluh?uuid=... — finalizes a draft.
 * Confirmed from the live action-menu markup in ajax_index's "action" field;
 * it is a plain GET with no request body / token, triggered via onclick in
 * the real UI.
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
      // Non-JSON 200 — treat as success since the status was OK. The send
      // step re-reads drafts from SIDIA afterwards, so a false positive here
      // shows up as an entry still sitting in Draft rather than silently
      // passing as sent.
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: "rejected",
    detail: `Unexpected status ${res.status} from kirim_ke_penyuluh`,
  };
}
