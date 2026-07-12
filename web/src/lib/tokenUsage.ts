import type { RelaySession, TokenUsage } from "../types.js";

export function mergeTokenUsage(values: Array<TokenUsage | undefined>): TokenUsage | undefined {
  const totals = { input: 0, output: 0, cache: 0 };
  for (const value of values) {
    if (!value) continue;
    totals.input += value.input;
    totals.output += value.output;
    totals.cache += value.cache;
  }
  if (totals.input === 0 && totals.output === 0 && totals.cache === 0) return undefined;
  return { ...totals, total: totals.input + totals.output + totals.cache };
}

export function sessionTokenUsage(sessions: RelaySession[]): TokenUsage | undefined {
  return mergeTokenUsage(sessions.map((session) => session.tokenUsage));
}

export function formatCompactTokens(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale || undefined, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}
