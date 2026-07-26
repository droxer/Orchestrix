import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { applyTheme, readTheme, SUPPORTED_THEMES } from "../src/lib/appStorage.js";

describe("Relay web theme storage", () => {
  const storage = new Map<string, string>();
  let themeAttr: string | null = null;
  let themeMeta: HTMLMetaElement | null = null;

  beforeEach(() => {
    themeAttr = null;
    themeMeta = null;
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
      head: {
        appendChild: (element: HTMLMetaElement) => {
          themeMeta = element;
          return element;
        },
      },
      createElement: () => {
        const attributes = new Map<string, string>();
        return {
          setAttribute: (name: string, value: string) => { attributes.set(name, value); },
          getAttribute: (name: string) => attributes.get(name) ?? null,
          removeAttribute: (name: string) => { attributes.delete(name); },
        } as unknown as HTMLMetaElement;
      },
      querySelector: () => themeMeta,
    } as unknown as Document;
    (globalThis as { window?: Window }).window = {
      getComputedStyle: () => ({
        getPropertyValue: (property: string) => {
          if (property !== "--surface-0") return "";
          return themeAttr === "dark" ? "rgb(16, 18, 20)" : "rgb(247, 248, 249)";
        },
      }) as CSSStyleDeclaration,
    } as unknown as Window;
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

  it("syncs browser chrome from the active CSS canvas", () => {
    applyTheme("light");
    assert.equal(themeMeta?.getAttribute("content"), "rgb(247, 248, 249)");

    applyTheme("dark");
    assert.equal(themeMeta?.getAttribute("content"), "rgb(16, 18, 20)");
  });

  it("applyTheme resolves system via matchMedia", () => {
    const matchMedia = (query: string) => ({
      matches: query.includes("dark"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    globalThis.matchMedia = matchMedia as unknown as typeof globalThis.matchMedia;
    window.matchMedia = matchMedia as unknown as Window["matchMedia"];
    applyTheme("system");
    assert.equal(themeAttr, "dark");
  });
});
