export interface TokenUsage {
  input: number;
  output: number;
  cache: number;
  total: number;
  source?: string;
}

const INPUT_KEYS = ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"];
const OUTPUT_KEYS = ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens"];
const ADDITIVE_CACHE_KEYS = [
  "cache",
  "cacheTokens",
  "cache_tokens",
  "cacheCreationInputTokens",
  "cache_creation_input_tokens",
  "cacheReadInputTokens",
  "cache_read_input_tokens",
];
const INCLUDED_CACHE_KEYS = ["cachedTokens", "cached_tokens"];

export function normalizeTokenUsage(value: unknown, source?: string): TokenUsage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const rawInput = sumNumericFields(record, INPUT_KEYS);
  const output = sumNumericFields(record, OUTPUT_KEYS);
  const includedCache =
    sumNumericFields(record, INCLUDED_CACHE_KEYS) +
    sumNestedNumericFields(record, "prompt_tokens_details", ["cached_tokens", "cachedTokens"]);
  const cache = sumNumericFields(record, ADDITIVE_CACHE_KEYS) + includedCache;
  const input = Math.max(0, rawInput - includedCache);
  if (input === 0 && output === 0 && cache === 0) return undefined;
  return {
    input,
    output,
    cache,
    total: input + output + cache,
    ...(source ? { source } : {}),
  };
}

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

export function extractTokenUsageFromJsonl(text: string, source?: string): TokenUsage | undefined {
  const values: TokenUsage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const usage = usageFromEvent(event, source);
    if (usage) values.push(usage);
  }
  const merged = mergeTokenUsage(values);
  return merged ? { ...merged, ...(source ? { source } : {}) } : undefined;
}

function usageFromEvent(event: unknown, source?: string): TokenUsage | undefined {
  const record = asRecord(event);
  if (!record) return undefined;
  return (
    normalizeTokenUsage(record.usage, source) ??
    normalizeTokenUsage(asRecord(record.message)?.usage, source) ??
    normalizeTokenUsage(asRecord(record.response)?.usage, source) ??
    normalizeTokenUsage(asRecord(record.result)?.usage, source)
  );
}

function sumNumericFields(record: Record<string, unknown>, keys: string[]): number {
  let total = 0;
  for (const key of keys) total += numeric(record[key]);
  return total;
}

function sumNestedNumericFields(record: Record<string, unknown>, key: string, fields: string[]): number {
  const nested = asRecord(record[key]);
  return nested ? sumNumericFields(nested, fields) : 0;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
