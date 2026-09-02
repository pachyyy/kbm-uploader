import type { ClassText, KelompokName, TeacherAssignment, Teacher } from "./types";
import { KELOMPOK_LIST } from "./types";

const KEYS = {
  teacherMapping: "kbm.teacherMapping.v1",
  lastClassText: "kbm.lastClassText.v1",
  cachedTeachers: "kbm.cachedTeachers.v1",
} as const;

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

// --- Teacher -> class group mapping (set up once, persists) ---

export function getTeacherMapping(): TeacherAssignment[] {
  return readJson<TeacherAssignment[]>(KEYS.teacherMapping) ?? [];
}

export function saveTeacherMapping(assignments: TeacherAssignment[]) {
  writeJson(KEYS.teacherMapping, assignments);
}

export function kelompokFor(
  teacherId: string,
  assignments: TeacherAssignment[]
): KelompokName | null {
  return assignments.find((a) => a.teacherId === teacherId)?.kelompok ?? null;
}

// --- Cached teacher list (so the form has something to show before the
// live SIDIA fetch resolves, and works if that fetch is briefly down) ---

export function getCachedTeachers(): Teacher[] {
  return readJson<Teacher[]>(KEYS.cachedTeachers) ?? [];
}

export function saveCachedTeachers(teachers: Teacher[]) {
  writeJson(KEYS.cachedTeachers, teachers);
}

// --- Per-class text. Saved on every keystroke so a refresh doesn't lose it,
// and read back on mount — which doubles as the prefill from last week ---

export function getLastClassText(): Record<KelompokName, ClassText> | null {
  return readJson<Record<KelompokName, ClassText>>(KEYS.lastClassText);
}

export function saveLastClassText(entries: Record<KelompokName, ClassText>) {
  writeJson(KEYS.lastClassText, entries);
}

export function emptyClassTextSet(): Record<KelompokName, ClassText> {
  const result = {} as Record<KelompokName, ClassText>;
  for (const kelompok of KELOMPOK_LIST) {
    result[kelompok] = {
      kelompok,
      jenisPembelajaran: "",
      materi: "",
      catatan: "",
    };
  }
  return result;
}
