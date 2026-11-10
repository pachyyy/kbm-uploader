import { afterEach, describe, expect, it, vi } from "vitest";
import { storeEntry, type StoreInput } from "./submit";
import { SIDIA_URLS } from "./config";

// These pin the rule that decides whether the UI invites a retry: once the
// POST has gone out, only an explicit refusal may be called "rejected".

const CREATE_FORM = `
  <html><head><meta name="csrf-token" content="tok"></head><body>
    <form action="/sidia/kbm/jadwal/store">
      <input name="npsn" value="123"><input name="nama" value="SEKOLAH"><input name="kecamatan" value="KEC">
    </form>
  </body></html>`;

const input: StoreInput = {
  tanggal: "2026-08-02",
  pendidikId: "1",
  kelompok: "Batita",
  jenisPembelajaran: "Tilawati",
  materi: "m",
  catatan: "c",
  foto1: new Blob(["a"]),
  foto2: new Blob(["b"]),
  foto3: new Blob(["c"]),
};

const session = () => ({ cookies: new Map<string, string>(), csrfToken: "" });

/** The create-form GET always succeeds; `onStore` decides what the POST does. */
function stubSidia(onStore: () => Response | Promise<Response>, onCreateAfterReject?: () => Response) {
  let createCalls = 0;
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target === SIDIA_URLS.store && init?.method === "POST") return onStore();
    if (target === SIDIA_URLS.create) {
      createCalls++;
      if (createCalls > 1 && onCreateAfterReject) return onCreateAfterReject();
      return new Response(CREATE_FORM, { status: 200 });
    }
    throw new Error(`unexpected fetch ${target}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("storeEntry outcome classification", () => {
  it("302 away from the form is a success", async () => {
    stubSidia(() => new Response(null, { status: 302, headers: { location: `${SIDIA_URLS.store}/../index` } }));
    expect(await storeEntry(session(), input)).toEqual({ ok: true });
  });

  it("302 back to /create is a rejection, and reports the flashed validation error", async () => {
    stubSidia(
      () => new Response(null, { status: 302, headers: { location: SIDIA_URLS.create } }),
      () => new Response('<div class="alert-danger">Foto 1 wajib diisi</div>', { status: 200 })
    );
    const outcome = await storeEntry(session(), input);
    expect(outcome).toMatchObject({ ok: false, reason: "rejected" });
    expect(outcome.ok === false && outcome.reason === "rejected" && outcome.detail).toMatch(/Foto 1 wajib diisi/);
  });

  it("still reports a rejection when reading the flashed error itself blows up", async () => {
    stubSidia(
      () => new Response(null, { status: 302, headers: { location: SIDIA_URLS.create } }),
      () => {
        throw new Error("network down");
      }
    );
    expect(await storeEntry(session(), input)).toMatchObject({ ok: false, reason: "rejected" });
  });

  it("a 200 that re-renders the form with errors is a rejection", async () => {
    stubSidia(() => new Response('<div class="invalid-feedback">Tanggal salah</div>', { status: 200 }));
    const outcome = await storeEntry(session(), input);
    expect(outcome).toMatchObject({ ok: false, reason: "rejected" });
    expect(outcome.ok === false && outcome.reason === "rejected" && outcome.detail).toBe("Tanggal salah");
  });

  it("a 419 / 422 style refusal is a rejection", async () => {
    stubSidia(() => new Response("<h1>Page Expired</h1>", { status: 419 }));
    expect(await storeEntry(session(), input)).toMatchObject({ ok: false, reason: "rejected" });
  });

  it("a dropped connection after the POST is unconfirmed, not failed", async () => {
    stubSidia(() => {
      throw new TypeError("fetch failed");
    });
    const outcome = await storeEntry(session(), input);
    expect(outcome).toMatchObject({ ok: false, reason: "unconfirmed" });
    expect(outcome.ok === false && outcome.reason === "unconfirmed" && outcome.detail).toMatch(/Riwayat/);
  });

  it("a SIDIA 5xx is unconfirmed — it may have crashed after writing the row", async () => {
    stubSidia(() => new Response("<h1>Server Error</h1>", { status: 500 }));
    const outcome = await storeEntry(session(), input);
    expect(outcome).toMatchObject({ ok: false, reason: "unconfirmed" });
    expect(outcome.ok === false && outcome.reason === "unconfirmed" && outcome.detail).toMatch(/500/);
  });

  it("a login page in reply means the session expired before anything was stored", async () => {
    stubSidia(() => new Response('<form><input name="password"></form>', { status: 200 }));
    expect(await storeEntry(session(), input)).toEqual({ ok: false, reason: "session_expired" });
  });

  it("never throws once the POST has been sent", async () => {
    stubSidia(() => {
      throw new Error("anything at all");
    });
    await expect(storeEntry(session(), input)).resolves.toMatchObject({ ok: false });
  });
});
