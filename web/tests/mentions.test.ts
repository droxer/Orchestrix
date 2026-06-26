import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { boundedMentionIndex, mentionOptionId, nextMentionIndex } from "../src/lib/mentions.js";

describe("mention helpers", () => {
  it("clamps the active option index to available mention options", () => {
    assert.equal(boundedMentionIndex(-1, 4), 0);
    assert.equal(boundedMentionIndex(2, 4), 2);
    assert.equal(boundedMentionIndex(8, 4), 3);
    assert.equal(boundedMentionIndex(8, 0), 0);
  });

  it("keeps textarea active-descendant ids aligned with popover options", () => {
    assert.equal(mentionOptionId(3), "mention-option-3");
  });

  it("moves from the bounded active option when the stored index is stale", () => {
    assert.equal(nextMentionIndex(8, 4, 1), 0);
    assert.equal(nextMentionIndex(8, 4, -1), 2);
    assert.equal(nextMentionIndex(-3, 4, -1), 3);
    assert.equal(nextMentionIndex(2, 0, 1), 0);
  });
});
