# Monochrome (Linear-style) token remap — design

Date: 2026-07-20
Status: approved
Supersedes the color values (not the token architecture) of
`docs/superpowers/specs/2026-07-19-graphite-tokens-design.md`.

## Goal

Replace the steel-blue action color and all chromatic status hues with a
Linear-style black/white-only palette. Fully monochrome: semantic status
colors (ok/warn/err) and the login screen's steel/amber accents are
neutralized too.

## Approach

Token-value-only remap. Token *names* and the token architecture
(`palette.css` originates values, `roles.css`/`shadcn-bridge.css`/components
consume them) are unchanged, so the whole app re-themes with no markup or
TypeScript changes. Exactly three files change values:

- `web/src/styles/tokens/palette.css`
- `web/src/styles/login.css`
- `web/src/styles/preferences.css`

## Changes

### 1. `palette.css` — dark register (default)

- `--action: #f2f4f6` (white fill — the signature Linear look)
- `--action-hover: #ffffff`
- `--on-action: #101214` (near-black text on the white button)
- `--action-soft: color-mix(in srgb, #f2f4f6 9%, transparent)`
  (neutral selection wash replacing the blue-tinted `#15202c`)
- Status as a brightness hierarchy — loud = bright, calm = dim:
  - `--err: #f2f4f6`
  - `--warn: #99a0a8`
  - `--ok: #7d848d` (shifted off `--ink-4 #6b727b` so dashboard bar
    segments `tone-good` vs `tone-muted` stay distinguishable)

The focus ring in `roles.css` reads `--action`, so it becomes a white ring
with no change needed; contrast on the dark canvas stays strong.

### 2. `palette.css` — light register (inverted)

- `--action: #16181b` (black fill)
- `--action-hover: #000000`
- `--on-action: #ffffff`
- `--action-soft: color-mix(in srgb, #16181b 7%, transparent)`
- Status:
  - `--err: #16181b`
  - `--warn: #5c636b`
  - `--ok: #6b727b` (distinct from light `--ink-4 #7d848d` and `--warn`)

### 3. `login.css` — pinned pre-auth palette

- `--lg-steel: #f2f4f6`, `--lg-steel-active: #ffffff`, `--lg-on-steel: #101214`
- Bootstrap mode: `--lg-amber: #99a0a8` (mid-grey instead of amber),
  `--lg-on-amber: #101214`
- Readiness dots map as activity, not error: `--lg-up: #f2f4f6`
  (bright = ready), `--lg-down: #6b727b` (dim = offline)
- The error banner gets its own loud-tier pin, `--lg-err: #f2f4f6`
  (consuming `--lg-down` dropped it below WCAG AA); `.login-error`
  consumes `--lg-err` for border, wash, and text
- Backdrop radial glow: `color-mix(in srgb, var(--lg-steel) 7%, transparent)`
  → `color-mix(in srgb, var(--lg-steel) 5%, transparent)` (keeps the var;
  `--lg-steel` is now `#f2f4f6`, so a literal and the var render identically)
- Header comment rewritten — no more "steel-blue action, amber attention"

### 4. `preferences.css` — theme-picker swatches

Swatches mirror the registers:

- `#33689e` → `#16181b` (light-register accent swatch)
- `#6ba1d4` → `#f2f4f6` (dark-register accent swatch)
- The split gradient (`linear-gradient(90deg, #33689e 0 50%, #6ba1d4 50% 100%)`)
  updated to `#16181b` / `#f2f4f6`

## Consequences

- `chart-3/4/5` alias ok/warn/err, so charts go greyscale for free.
- Status badges that tint via `color-mix(in srgb, var(--err) 6%, transparent)`
  become subtle neutral washes; warn/err text stays AA-safe, while ok is the
  decorative-calm tier (below AA for small text by design).
- shadcn `--ring` aliases `--action`, so Tailwind ring utilities follow.
- All component markup, TSX, tests, and bridge files are untouched.

## Comment sweep

Every comment describing the old values gets updated with the code:
`palette.css` header ("one steel-blue action color"), the `--action` block
comment, `login.css` header and `--lg-*` comments ("steel", "amber"),
`preferences.css` swatch comments.

## Verification

1. Web unit tests pass: `npm test` (or the web-scoped test target).
2. Stylelint passes on the three touched files (login.css's documented
   exception in `web/.stylelintrc.json` remains valid).
3. Visual pass via `make web` on: dark theme, light theme
   (`html[data-theme="light"]`), and the login screen in both attach and
   bootstrap modes — checking button fill/text contrast, focus rings,
   status dots/badges, and theme-picker swatches.
