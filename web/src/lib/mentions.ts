export function boundedMentionIndex(index: number, optionCount: number): number {
  if (optionCount <= 0) return 0;
  return Math.min(Math.max(index, 0), optionCount - 1);
}

export function mentionOptionId(index: number): string {
  return `mention-option-${index}`;
}

export function nextMentionIndex(index: number, optionCount: number, direction: 1 | -1): number {
  if (optionCount <= 0) return 0;
  return (boundedMentionIndex(index, optionCount) + direction + optionCount) % optionCount;
}
