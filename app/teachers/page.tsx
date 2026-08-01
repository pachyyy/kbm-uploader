"use client";

import { TeacherMapping } from "@/components/teacher-mapping";

export default function TeachersPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">Teachers</h1>
        <p className="text-sm text-muted-foreground">
          Assign each teacher to a class group. Saved on this device.
        </p>
      </div>

      <TeacherMapping onComplete={() => {}} />
    </div>
  );
}
