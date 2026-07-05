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
      },
    } as unknown as Document;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    delete (globalThis as { document?: Document }).document;
    delete (globalThis as { window?: Window }).window;
    delete (globalThis as { matchMedia?: typeof globalThis.matchMedia }).matchMedia;
  });

  it("defaults readTheme to system when storage is empty", () => {
    assert.equal(readTheme(), "system");
  });

  it("rejects unknown stored themes", () => {
    storage.set("relay-web.theme", "neon");
    assert.equal(readTheme(), "system");
  });

  it("applyTheme maps the explicit contrast themes straight through, ignoring the OS", () => {
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
    applyTheme("contrast");
    assert.equal(themeAttr, "contrast");
    applyTheme("contrast-dark");
    assert.equal(themeAttr, "contrast-dark");
  });

  it("applyTheme resolves light and dark literally", () => {
    applyTheme("light");
    assert.equal(themeAttr, "light");
    applyTheme("dark");
    assert.equal(themeAttr, "dark");
  });

  it("exports all preference theme options", () => {
    assert.deepEqual([...SUPPORTED_THEMES], ["light", "dark", "system", "contrast", "contrast-dark"]);
  });

  it("maps explicit themes to browser chrome colors", () => {
    assert.equal(themeColorForTheme("light"), "#fdfcfa");
    assert.equal(themeColorForTheme("dark"), "#0d0c0a");
    assert.equal(themeColorForTheme("contrast"), "#ffffff");
    assert.equal(themeColorForTheme("contrast-dark"), "#000000");
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
