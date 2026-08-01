import { NextResponse } from "next/server";
import { getSession, invalidateSession } from "@/lib/sidia/session";
import { storeEntry, finalizeEntry } from "@/lib/sidia/submit";
import type { SubmitStatus } from "@/lib/types";

export const maxDuration = 60; // Vercel Pro ceiling; one teacher must fit well inside this

interface SubmitApiResult {
  status: SubmitStatus;
  message?: string;
  uuid?: string;
}

async function runOnce(form: FormData): Promise<SubmitApiResult> {
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
    return { status: "failed", message: "Missing one or more photos." };
  }
  if (!tanggal || !pendidikId || !kelompok || !jenisPembelajaran || !materi || !catatan) {
    return { status: "failed", message: "Missing required field." };
  }

  const session = await getSession();

  const storeResult = await storeEntry(session, {
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

  if (!storeResult.ok) {
    if (storeResult.reason === "session_expired") {
      throw new SessionExpiredError();
    }
    return { status: "failed", message: storeResult.detail };
  }

  const finalizeResult = await finalizeEntry(session, storeResult.uuid);

  if (!finalizeResult.ok) {
    if (finalizeResult.reason === "session_expired") {
      throw new SessionExpiredError();
    }
    // The record WAS created — this is the "looks fine but isn't filed"
    // case the plan calls out. Must never be reported as success.
    return {
      status: "draft_only",
      message: finalizeResult.detail,
      uuid: storeResult.uuid,
    };
  }

  return { status: "submitted", uuid: storeResult.uuid };
}

class SessionExpiredError extends Error {}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { status: "failed", message: "Request body must be multipart/form-data." } satisfies SubmitApiResult,
      { status: 400 }
    );
  }

  try {
    const result = await runOnce(form);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      invalidateSession();
      try {
        const result = await runOnce(form);
        return NextResponse.json(result);
      } catch (retryErr) {
        return NextResponse.json(
          {
            status: "failed",
            message:
              retryErr instanceof SessionExpiredError
                ? "Session expired again immediately after re-login — SIDIA may be rejecting the credentials."
                : (retryErr as Error).message,
          } satisfies SubmitApiResult,
          { status: 502 }
        );
      }
    }
    return NextResponse.json(
      { status: "failed", message: (err as Error).message } satisfies SubmitApiResult,
      { status: 502 }
    );
  }
}
