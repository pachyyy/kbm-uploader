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
  | "failed";

export interface SubmitResult {
  teacherId: string;
  teacherName: string;
  kelompok: KelompokName;
  status: SubmitStatus;
  message?: string;
  uuid?: string;
}
