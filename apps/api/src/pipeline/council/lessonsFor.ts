// The as-of rule (design 2026-09-11 §6.1). A member receives its own lessons
// only, and only those whose outcome was known strictly before the commit
// instant. This is what keeps the standings honest and any later replay free
// of look-ahead.
import { and, desc, eq, lt, ne } from "drizzle-orm";
import type { ModelMemberId } from "@oracle/core";
import { schema, type Db } from "../../db/client";

export const LESSON_CAPS = { SAME_SERIES: 5, OTHER: 3 } as const;

export interface LessonReceived { id: string; seriesKey: string; resolvedAt: Date; text: string }

export function seriesKeyOf(q: { marketSeriesKey: string | null; category: string }): string {
  return q.marketSeriesKey ?? q.category;
}

export async function lessonsFor(db: Db, member: ModelMemberId, seriesKey: string, asOf: Date): Promise<LessonReceived[]> {
  const [same, other] = await Promise.all([
    db.query.lessons.findMany({
      where: and(eq(schema.lessons.member, member), eq(schema.lessons.seriesKey, seriesKey), lt(schema.lessons.resolvedAt, asOf)),
      orderBy: [desc(schema.lessons.resolvedAt)],
      limit: LESSON_CAPS.SAME_SERIES,
    }),
    db.query.lessons.findMany({
      where: and(eq(schema.lessons.member, member), ne(schema.lessons.seriesKey, seriesKey), lt(schema.lessons.resolvedAt, asOf)),
      orderBy: [desc(schema.lessons.resolvedAt)],
      limit: LESSON_CAPS.OTHER,
    }),
  ]);
  return [...same, ...other].map((l) => ({ id: l.id, seriesKey: l.seriesKey, resolvedAt: l.resolvedAt, text: l.text }));
}
