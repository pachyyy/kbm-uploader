import * as cheerio from "cheerio";
import type { Teacher } from "../types";
import { SIDIA_URLS } from "./config";
import { cookieHeader, mergeSetCookies, isLoginPage, USER_AGENT } from "./session";
import type { getSession } from "./session";

/**
 * Captured from the live <select name="pendidik_id"> options on
 * /sidia/kbm/jadwal/create on 2026-07-30. These IDs are what SIDIA expects
 * in the "pendidik_id" field of POST /store — they must match exactly.
 *
 * This list is fetched fresh from SIDIA at runtime (see fetchTeachers) and
 * this hardcoded copy is only a fallback / reference for the class-mapping
 * UI before the first live fetch succeeds.
 */
export const KNOWN_TEACHERS: Teacher[] = [
  { id: "23853", name: "BONITA DWI ARYANI" },
  { id: "10753", name: "ELISABET SUTANDIJO, SE." },
  { id: "10748", name: "FENNY OKTAVINA" },
  { id: "24888", name: "HANNY SOETRISNO, DRH" },
  { id: "23852", name: "KURNIAWAN SANTOSO" },
  { id: "24105", name: "LAU,STEPHANIE LEO" },
  { id: "10759", name: "LINDA ANGGRAINI" },
  { id: "10746", name: "MARIANA SOEPITNO" },
  { id: "10768", name: "NING HERIAWATI" },
  { id: "23859", name: "RICHARD AUDIE T." },
  { id: "24107", name: "SELVY HERLIM" },
  { id: "10756", name: "SIE LIAN ING" },
  { id: "10763", name: "SRI NINGSIH" },
  { id: "10765", name: "SUTJININSE GONDOWIYONO" },
  { id: "23851", name: "VERAWATI" },
];

/**
 * Fetches the live teacher list from /jadwal/create's <select name="pendidik_id">
 * options. This is the source of truth — KNOWN_TEACHERS above is a static
 * fallback only. Using a stale hardcoded ID would attach a record to the
 * wrong teacher, so this is preferred whenever the session is available.
 */
export async function fetchTeachers(
  session: Awaited<ReturnType<typeof getSession>>
): Promise<Teacher[]> {
  const res = await fetch(SIDIA_URLS.create, {
    redirect: "manual",
    headers: {
      accept: "text/html",
      cookie: cookieHeader(session.cookies),
      "user-agent": USER_AGENT,
    },
  });
  mergeSetCookies(res, session.cookies);

  const html = await res.text();
  if (isLoginPage(html)) {
    throw new Error("SIDIA_SESSION_EXPIRED");
  }

  const $ = cheerio.load(html);
  const teachers: Teacher[] = [];

  $('select[name="pendidik_id"] option').each((_, el) => {
    const value = $(el).attr("value");
    if (!value) return; // skips the "- Pilih -" placeholder option
    const label = $(el).text().trim().replace(/\s*-\s*Pendidik$/i, "");
    teachers.push({ id: value, name: label });
  });

  if (teachers.length === 0) {
    throw new Error(
      "Parsed zero teachers from /jadwal/create — the <select name=\"pendidik_id\"> markup may have changed."
    );
  }

  return teachers;
}
