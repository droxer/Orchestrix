import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { moveRadioSelection } from "../src/lib/radioGroupKeyboard.js";
import type { Theme } from "../src/lib/appStorage.js";

const THEME_VALUES: Theme[] = ["light", "dark", "system"];

function fakeKeyboardEvent(key: string): Parameters<typeof moveRadioSelection>[0] {
  let defaultPrevented = false;
  return {
    key,
    preventDefault: () => { defaultPrevented = true; },
    get defaultPrevented() { return defaultPrevented; },
  } as Parameters<typeof moveRadioSelection>[0];
}

function fakeRefs<T>() {
  const map = new Map<T, HTMLButtonElement | null>();
  const focused: T[] = [];
  return {
    current: map,
    focus(value: T) {
      focused.push(value);
    },
    register(value: T) {
      map.set(value, { focus: () => { focused.push(value); } } as HTMLButtonElement);
    },
    focused,
  };
}

describe("moveRadioSelection", () => {
  it("walks theme options in reading order with ArrowRight", () => {
    const refs = fakeRefs<Theme>();
    for (const value of THEME_VALUES) refs.register(value);
    const changes: Theme[] = [];

    for (let step = 0; step < THEME_VALUES.length; step += 1) {
      const current = THEME_VALUES[step]!;
      const event = fakeKeyboardEvent("ArrowRight");
      moveRadioSelection(event, THEME_VALUES, current, refs, (value) => { changes.push(value); });
      assert.equal(event.defaultPrevented, true);
      assert.equal(changes.at(-1), THEME_VALUES[(step + 1) % THEME_VALUES.length]);
    }

    assert.deepEqual(changes, ["dark", "system", "light"]);
  });

  it("walks theme options backward with ArrowLeft from system", () => {
    const refs = fakeRefs<Theme>();
    for (const value of THEME_VALUES) refs.register(value);
    const changes: Theme[] = [];
    const event = fakeKeyboardEvent("ArrowLeft");

    moveRadioSelection(event, THEME_VALUES, "system", refs, (value) => { changes.push(value); });

    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(changes, ["dark"]);
    assert.deepEqual(refs.focused, ["dark"]);
  });

  it("jumps to first and last options with Home and End", () => {
    const refs = fakeRefs<Theme>();
    for (const value of THEME_VALUES) refs.register(value);
    const changes: Theme[] = [];

    moveRadioSelection(fakeKeyboardEvent("Home"), THEME_VALUES, "dark", refs, (value) => { changes.push(value); });
    moveRadioSelection(fakeKeyboardEvent("End"), THEME_VALUES, "light", refs, (value) => { changes.push(value); });

    assert.deepEqual(changes, ["light", "system"]);
  });

  it("ignores unrelated keys", () => {
    const refs = fakeRefs<Theme>();
    refs.register("light");
    const changes: Theme[] = [];
    const event = fakeKeyboardEvent("Enter");

    moveRadioSelection(event, THEME_VALUES, "light", refs, (value) => { changes.push(value); });

    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(changes, []);
  });
});
