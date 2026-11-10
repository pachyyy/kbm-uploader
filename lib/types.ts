export type KelompokName =
  | "Batita"
  | "Kelas Kecil"
  | "Kelas Tengah"
  | "Kelas Besar"
  | "Pre Teen";

export const KELOMPOK_LIST: KelompokName[] = [
  "Batita",
  "Kelas Kecil",
  "Kelas Tengah",
  "Kelas Besar",
  "Pre Teen",
];

export interface Teacher {
  id: string; // pendidik_id sent to SIDIA
  name: string;
}

export interface TeacherAssignment {
  teacherId: string;
  kelompok: KelompokName;
}

export interface ClassText {
  kelompok: KelompokName;
  jenisPembelajaran: string;
  materi: string;
  catatan: string;
}

export interface TeacherPhotos {
  teacherId: string;
  foto1: File | null;
  foto2: File | null;
  foto3: File | null;
}

export type DraftStatus =
  | "pending"
  | "in_progress"
  | "drafted"
  // The request never came back cleanly (network drop, timeout), so whether
  // SIDIA stored the record is genuinely unknown. Distinct from "failed"
  // because retrying risks creating a DUPLICATE — check Riwayat for the date
  // instead of resubmitting.
  | "unconfirmed"
  // SIDIA actively rejected it and created nothing. Safe to retry.
  | "failed"
  // Client-only (/api/draft never returns it): SIDIA already holds an entry for
  // this teacher on this date, so drafting was skipped to avoid a duplicate.
  // Terminal for retry purposes.
  | "already_exists";

/** The statuses `/api/draft` can answer with — the outcome of one store attempt. */
export type SubmitStatus = Extract<DraftStatus, "drafted" | "unconfirmed" | "failed">;

export interface DraftResult {
  teacherId: string;
  teacherName: string;
  kelompok: KelompokName;
  status: DraftStatus;
  message?: string;
}

export interface SendResult {
  uuid: string;
  namaPendidik: string;
  kelompok: string;
  ok: boolean;
  message?: string;
}

/** One KBM record as SIDIA reports it back, cleaned of markup. */
export interface SidiaEntry {
  uuid: string;
  tanggal: string; // yyyy-mm-dd
  tglLong: string; // e.g. "Minggu, 09 Agustus 2026"
  namaPendidik: string;
  kelompok: string;
  jenisPembelajaran: string;
  status: string; // plain text, e.g. "Draft" / "Verifikasi Penyuluh"
  isDraft: boolean;
}

export interface EntryGroup {
  tanggal: string;
  tglLong: string;
  total: number;
  draftCount: number;
  entries: SidiaEntry[];
}
