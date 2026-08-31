export type ReadingTimeSource = "derived" | "editorial-override";

export interface ReadingTimeResult {
  minutes: number;
  source: ReadingTimeSource;
  overrideReason?: string;
}

interface ReadingTimeEntry {
  body?: string;
  data: {
    readingMinutesOverride?: number;
    readingMinutesOverrideReason?: string;
  };
}

/**
 * Estimate deliberate technical-reading time instead of publishing a manually
 * selected number. CJK prose, Latin words, and non-empty fenced-code lines are
 * counted separately because a byte or whitespace count treats them very
 * differently.
 */
export function deriveReadingMinutes(source: string): number {
  const codeBlocks = [...source.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
  const codeLines = codeBlocks.reduce(
    (total, match) =>
      total + (match[1]?.split(/\r?\n/).filter((line) => line.trim().length > 0).length ?? 0),
    0,
  );
  const prose = source
    .replace(/```[^\n]*\n[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ");
  const cjkCharacters =
    prose.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const latinWords = prose.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0;

  // 300 CJK characters/minute and 180 Latin words/minute are deliberately
  // conservative for engineering prose; code is budgeted at 12 lines/minute.
  return Math.max(1, Math.ceil(cjkCharacters / 300 + latinWords / 180 + codeLines / 12));
}

export function resolveReadingTime(entry: ReadingTimeEntry): ReadingTimeResult {
  const override = entry.data.readingMinutesOverride;
  if (override !== undefined)
    return {
      minutes: override,
      source: "editorial-override",
      overrideReason: entry.data.readingMinutesOverrideReason,
    };
  return { minutes: deriveReadingMinutes(entry.body ?? ""), source: "derived" };
}
