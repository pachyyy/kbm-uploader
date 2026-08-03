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

export type SubmitStatus =
  | "pending"
  | "in_progress"
  | "submitted"
  | "draft_only"
  // Store returned 302 (record almost certainly created) but the follow-up
  // lookup could not find it, so it could not be finalized. Distinct from
  // "failed" because retrying risks creating a DUPLICATE — this one needs a
  // manual check in SIDIA, not an automatic resubmit.
  | "created_unverified"
  | "failed";

export interface SubmitResult {
  teacherId: string;
  teacherName: string;
  kelompok: KelompokName;
  status: SubmitStatus;
  message?: string;
  uuid?: string;
}
