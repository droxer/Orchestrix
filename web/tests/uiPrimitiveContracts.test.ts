import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssHex(block: string, token: string): string {
  const match = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `missing --${token}`);
  return match[1];
}

describe("UI primitive contracts", () => {
  it("keeps control boundaries at 3:1 against every theme surface", async () => {
    const palette = await readFile(resolve("web/src/styles/tokens/palette.css"), "utf8");
    const roles = await readFile(resolve("web/src/styles/tokens/roles.css"), "utf8");
    const bridge = await readFile(resolve("web/src/styles/tokens/shadcn-bridge.css"), "utf8");
    const dark = palette.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const light = palette.match(/html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    assert.match(roles, /--control-border:\s*var\(--ink-4\)/);
    assert.match(bridge, /--input:\s*var\(--control-border\)/);

    for (const [name, block, surfaces] of [
      ["dark", dark, ["surface-0", "surface-1", "surface-2", "surface-3"]],
      ["light", light, ["surface-0", "surface-1", "surface-2", "surface-3"]],
    ] as const) {
      const boundary = cssHex(block, "ink-4");
      for (const surface of surfaces) {
        const ratio = contrast(boundary, cssHex(block, surface));
        assert.ok(ratio >= 3, `${name} --control-border against --${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  });

  it("applies the coarse-pointer size and type contract to wrapped and native form primitives", async () => {
    const styles = await readFile(resolve("web/src/styles/a11y.css"), "utf8");
    for (const slot of [
      "input",
      "textarea",
      "select-trigger",
      "select-item",
      "select-scroll-up-button",
      "select-scroll-down-button",
    ]) {
      assert.match(styles, new RegExp(`\\[data-slot="${slot}"\\]`));
    }
    assert.match(styles, /input:not\(\[type="hidden"\]\):not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\)/);
    assert.match(styles, /\n\s*select,/);
    assert.match(styles, /\n\s*textarea/);
    assert.match(styles, /font-size:\s*16px/);
  });

  it("keeps a compact switch with a 44px pseudo-element hit target", async () => {
    const source = await readFile(resolve("web/src/components/ui/switch.tsx"), "utf8");
    assert.match(source, /h-5 w-9/);
    assert.match(source, /after:-inset-x-1 after:-inset-y-3/);
    assert.match(source, /data-disabled:opacity-50/);
    assert.match(source, /data-checked:bg-\[var\(--action\)\]/);
    assert.doesNotMatch(source, /data-slot="switch-track"/);
  });

  it("keeps shadcn button chrome in buttonVariants instead of the later Relay layer", async () => {
    const base = await readFile(resolve("web/src/styles/tokens/base.css"), "utf8");
    assert.match(base, /button:not\(\[data-slot="button"\]\)\s*\{/);
    assert.doesNotMatch(base, /button\[data-slot="button"\]\[data-variant=/);
  });

  it("wraps long select options instead of silently clipping them", async () => {
    const source = await readFile(resolve("web/src/components/ui/select.tsx"), "utf8");
    assert.match(source, /whitespace-normal/);
    assert.match(source, /overflow-wrap:anywhere/);
    assert.doesNotMatch(source, /ItemText className="[^"]*whitespace-nowrap/);
  });

  it("supports polite announcements for async workspace results", async () => {
    const source = await readFile(resolve("web/src/components/workspace/WorkspacePrimitives.tsx"), "utf8");
    assert.match(source, /announce\?: boolean/);
    assert.match(source, /role=\{announce \? "status" : undefined\}/);
    assert.match(source, /aria-atomic=\{announce \|\| undefined\}/);
  });
});
