/**
 * Reading time from the lesson the student will actually read, at a
 * deliberately unhurried 150 words a minute plus time to look at the source.
 */
export function estimateReadMinutes(lessonText: string, pageCount: number): number {
  const words = lessonText.split(/\s+/).filter(Boolean).length;
  const minutes = words > 0 ? Math.round(words / 150) + 2 : pageCount * 3;
  return Math.min(30, Math.max(4, minutes));
}
