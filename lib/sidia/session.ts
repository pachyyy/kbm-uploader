import * as cheerio from "cheerio";
import { SIDIA_URLS } from "./config";

// SIDIA's server appears to 500 on requests with no recognizable
// User-Agent (observed: identical requests succeeded via curl with a UA
// set, failed with Node's default/absent UA). Sent on every request.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

interface SessionState {
  cookies: Map<string, string>;
  csrfToken: string;
}

// Module-scope cache so warm serverless invocations reuse the session
// instead of logging in on every request.
let cached: SessionState | null = null;

function cookieHeader(cookies: Map<string, string>): string {
  return Array.from(cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function mergeSetCookies(res: Response, cookies: Map<string, string>) {
  // Node/undici expose multiple Set-Cookie headers via getSetCookie().
  const raw = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
    ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : res.headers.get("set-cookie")
      ? [res.headers.get("set-cookie") as string]
      : [];

  for (const line of raw) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    cookies.set(name, value);
  }
}

function scrapeCsrfToken(html: string): string {
  const $ = cheerio.load(html);
  const token = $('meta[name="csrf-token"]').attr("content");
  if (!token) {
    throw new Error(
      "Could not find csrf-token meta tag — page may not be the expected SIDIA page (possibly a login redirect or layout change)."
    );
  }
  return token;
}

function isLoginPage(html: string): boolean {
  const $ = cheerio.load(html);
  return $('input[name="password"]').length > 0;
}

async function performLogin(cookies: Map<string, string>): Promise<string> {
  const username = process.env.SIDIA_USERNAME;
  const password = process.env.SIDIA_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "SIDIA_USERNAME / SIDIA_PASSWORD environment variables are not set."
    );
  }

  // 1. GET /login to obtain a fresh session cookie + CSRF token.
  const loginPageRes = await fetch(SIDIA_URLS.loginPage, {
    redirect: "manual",
    headers: { accept: "text/html", "user-agent": USER_AGENT },
  });
  mergeSetCookies(loginPageRes, cookies);
  const loginPageHtml = await loginPageRes.text();
  const token = scrapeCsrfToken(loginPageHtml);

  // 2. POST /log/in with credentials — confirmed field names (_token,
  // username, password) and action URL from the live login form HTML.
  const body = new URLSearchParams();
  body.set("_token", token);
  body.set("username", username);
  body.set("password", password);

  const loginRes = await fetch(SIDIA_URLS.loginSubmit, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(cookies),
      referer: SIDIA_URLS.loginPage,
      "user-agent": USER_AGENT,
    },
    body: body.toString(),
  });
  mergeSetCookies(loginRes, cookies);

  if (loginRes.status !== 302) {
    const text = await loginRes.text().catch(() => "");
    if (isLoginPage(text)) {
      throw new Error(
        "SIDIA login failed — credentials rejected (server returned the login page again)."
      );
    }
    throw new Error(
      `SIDIA login returned unexpected status ${loginRes.status}.`
    );
  }

  return token;
}

/**
 * Returns a valid session (cookies + fresh CSRF token for /jadwal/create).
 * Logs in if there is no cached session yet.
 */
export async function getSession(): Promise<SessionState> {
  if (!cached) {
    const cookies = new Map<string, string>();
    const token = await performLogin(cookies);
    cached = { cookies, csrfToken: token };
  }
  return cached;
}

/** Forces a fresh login on the next getSession() call. */
export function invalidateSession() {
  cached = null;
}

/**
 * Fetches /jadwal/create and returns a fresh CSRF token bound to the
 * current session. Laravel's token is stateful, so this must be re-read
 * before every store/kirim_ke_penyuluh call rather than reused from login.
 */
export async function refreshCsrfToken(session: SessionState): Promise<string> {
  const res = await fetch(SIDIA_URLS.create, {
    redirect: "manual",
    headers: {
      accept: "text/html",
      cookie: cookieHeader(session.cookies),
      "user-agent": USER_AGENT,
    },
  });
  mergeSetCookies(res, session.cookies);

  if (res.status !== 200) {
    throw new Error(
      `Expected /jadwal/create to return 200, got ${res.status} — session likely expired.`
    );
  }

  const html = await res.text();
  if (isLoginPage(html)) {
    throw new Error("SIDIA_SESSION_EXPIRED");
  }

  const token = scrapeCsrfToken(html);
  session.csrfToken = token;
  return token;
}

export { cookieHeader, mergeSetCookies, isLoginPage, USER_AGENT };
