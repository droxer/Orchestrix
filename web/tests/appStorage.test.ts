import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { applyTheme, readTheme, SUPPORTED_THEMES, themeColorForTheme } from "../src/lib/appStorage.js";

describe("Relay web theme storage", () => {
  const storage = new Map<string, string>();
  let themeAttr: string | null = null;

  beforeEach(() => {
    themeAttr = null;
    storage.clear();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
      clear: () => { storage.clear(); },
      key: () => null,
      length: 0,
    } as Storage;
    globalThis.document = {
      documentElement: {
        setAttribute: (_name: string, value: string) => { themeAttr = value; },
        getAttribute: () => themeAttr,
        classList: { toggle: () => false },
      },
    } as unknown as Document;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    delete (globalThis as { document?: Document }).document;
    delete (globalThis as { window?: Window }).window;
    delete (globalThis as { matchMedia?: typeof globalThis.matchMedia }).matchMedia;
  });

  it("defaults readTheme to dark when storage is empty", () => {
    assert.equal(readTheme(), "dark");
  });

  it("rejects unknown stored themes", () => {
    storage.set("relay-web.theme", "neon");
    assert.equal(readTheme(), "dark");
  });

  it("migrates legacy high-contrast themes to system", () => {
    storage.set("relay-web.theme", "contrast");
    assert.equal(readTheme(), "system");
    assert.equal(storage.get("relay-web.theme"), "system");

    storage.set("relay-web.theme", "contrast-dark");
    assert.equal(readTheme(), "system");
    assert.equal(storage.get("relay-web.theme"), "system");
  });

  it("applyTheme resolves light and dark literally", () => {
    applyTheme("light");
    assert.equal(themeAttr, "light");
    applyTheme("dark");
    assert.equal(themeAttr, "dark");
  });

  it("exports all preference theme options", () => {
    assert.deepEqual([...SUPPORTED_THEMES], ["light", "dark", "system"]);
  });

  it("maps explicit themes to browser chrome colors", () => {
    assert.equal(themeColorForTheme("light"), "#f7f8f9");
    assert.equal(themeColorForTheme("dark"), "#101214");
  });

  it("applyTheme resolves system via matchMedia", () => {
    const matchMedia = (query: string) => ({
      matches: query.includes("dark"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    globalThis.matchMedia = matchMedia as unknown as typeof globalThis.matchMedia;
    (globalThis as { window?: Window }).window = {
      matchMedia: matchMedia as unknown as Window["matchMedia"],
    } as Window;
    applyTheme("system");
    assert.equal(themeAttr, "dark");
  });
});
