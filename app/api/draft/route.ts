import { NextResponse } from "next/server";
import { SessionExpiredError, withSession } from "@/lib/sidia/session";
import { storeEntry } from "@/lib/sidia/submit";
import type { DraftStatus } from "@/lib/types";

export const maxDuration = 60; // Vercel Pro ceiling; one teacher must fit well inside this

interface DraftApiResult {
  status: DraftStatus;
  message?: string;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      {
        status: "failed",
        message: "Request body must be multipart/form-data.",
      } satisfies DraftApiResult,
      { status: 400 }
    );
  }

  const tanggal = String(form.get("tanggal") ?? "");
  const pendidikId = String(form.get("pendidikId") ?? "");
  const kelompok = String(form.get("kelompok") ?? "");
  const jenisPembelajaran = String(form.get("jenisPembelajaran") ?? "");
  const materi = String(form.get("materi") ?? "");
  const catatan = String(form.get("catatan") ?? "");
  const foto1 = form.get("foto1");
  const foto2 = form.get("foto2");
  const foto3 = form.get("foto3");

  if (!(foto1 instanceof Blob) || !(foto2 instanceof Blob) || !(foto3 instanceof Blob)) {
    return NextResponse.json(
      { status: "failed", message: "Missing one or more photos." } satisfies DraftApiResult,
      { status: 400 }
    );
  }
  if (!tanggal || !pendidikId || !kelompok || !jenisPembelajaran || !materi || !catatan) {
    return NextResponse.json(
      { status: "failed", message: "Missing required field." } satisfies DraftApiResult,
      { status: 400 }
    );
  }

  try {
    const outcome = await withSession(async (session) => {
      const result = await storeEntry(session, {
        tanggal,
        pendidikId,
        kelompok,
        jenisPembelajaran,
        materi,
        catatan,
        foto1,
        foto2,
        foto3,
      });
      // Let withSession re-login and replay the store. Safe to run twice: an
      // expired session means SIDIA never accepted the first attempt.
      if (!result.ok && result.reason === "session_expired") {
        throw new SessionExpiredError();
      }
      return result;
    });

    if (!outcome.ok) {
      // Only reachable with reason "rejected" — SIDIA validated and refused,
      // so nothing was created and retrying is safe.
      const detail = outcome.reason === "rejected" ? outcome.detail : "Session expired.";
      return NextResponse.json({ status: "failed", message: detail } satisfies DraftApiResult);
    }

    return NextResponse.json({ status: "drafted" } satisfies DraftApiResult);
  } catch (err) {
    return NextResponse.json(
      { status: "failed", message: (err as Error).message } satisfies DraftApiResult,
      { status: 502 }
    );
  }
}
