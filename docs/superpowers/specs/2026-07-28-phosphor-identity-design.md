# Relay Web Identity — "Phosphor"

_Date: 2026-07-28 · Scope: `web/` visual identity + `assets/brand/` + `web/public/brand/` · Status: approved design, pending implementation plan._

Supersedes the identity of `docs/superpowers/specs/2026-07-20-monochrome-tokens-design.md`.
Retains that spec's token architecture and its monochrome ramp unchanged; replaces
its typography and adds exactly one colour role.

## Motivation

The web identity has been re-specified seven times in eight weeks — Cobalt (07-01),
Warm Precision (07-05), Linear primary (07-07), Sleek Forest (07-14), Graphite
(07-19), Monochrome (07-20) — and each was judged "generic" within weeks of
shipping. Every one of those was a **palette swap**. The 07-14 spec diagnosed this
itself ("the palette has been swapped several times without the underlying page
structure changing") and was then superseded by two further palette swaps six days
later.

The diagnosis accepted here: "generic" is a **subject-matter** problem, not a hue
problem. The shell — 72px icon rail, 64px header with title plus mono count and
right-aligned actions, list body — is the Linear/Height/Vercel archetype, and it is
unchanged by any value of `--action`. Meanwhile Relay's genuinely distinctive
concepts (named agents with vendor marks and personalities, teams, placement on
computers, agent home workspaces) render as generic rows.

An eighth palette was explicitly rejected as the lead change.

## 1. Concept

**Relay is grey until something is working.**

Colour is not decoration, not action, and not status. Colour means one thing:
*an agent is doing work right now.*

- The monochrome ramp from the 07-20 spec is retained in full. Buttons, links,
  focus rings, headings, errors, warnings, nav, and KPI numerals all stay greyscale.
- Exactly one accent — phosphor green — is reserved for live agent work.
- A screen's colour density therefore *is* a utilisation readout: a busy workforce
  glows, an idle one is bare, legible without reading a word.

Two properties make this durable where six palettes were not. It cannot be
reskinned into genericness, because a competitor can copy the hue but not the hue
*meaning liveness* without a live agent workforce underneath — the identity is
downstream of the product rather than painted onto it. And it resolves the
oscillation directly: Monochrome was disciplined but inert, Sleek Forest had a
signature colour but spent it on `--action` so it coloured buttons rather than
meaning. Phosphor keeps the discipline everywhere and spends its one colour on the
only thing in the product that is actually alive.

Typography argues the same point rather than a second unrelated one: JetBrains Mono
is terminal lineage, and in a terminal green text has always meant *a process is
running*.

**Accepted consequence.** Error states stay monochrome. Dark-register `--err`
remains `#f2f4f6`, identical to heading ink, so failures are carried by icon,
shape, and copy — the hollow-ring treatment `StatusPill` already uses. This was
raised during design and accepted.

## 2. Typography

One mono family does both display and technical work. The display/technical
distinction moves from *face* to weight, tracking, and colour: 700 tight-tracked in
`--ink-1` for titles, agent names, and metrics; 400 untracked in `--ink-4` for
session IDs, logs, and code. This is a stronger separation than two near-identical
monospace faces would have produced.

### 2.1 Font binaries

```
web/src/app/fonts/
  Geist-Variable.woff2          keep    (prose and UI body)
  MonaSans-Variable.woff2       delete  (−134 KB)
  GeistMono-Variable.woff2      delete  (−69 KB)
  OFL-MonaSans.txt              delete
  JetBrainsMono-Variable.woff2  add     (OFL, wght 100–800)
  OFL-JetBrainsMono.txt         add
```

JetBrains Mono Variable's actual byte count must be measured once the file is in
the tree and the real net payload delta recorded here. Do not carry an estimate
forward. Two families ship in total, down from three.

### 2.2 `layout.tsx`

`web/src/app/layout.tsx` collapses from three `localFont` registrations to two. The
`appDisplay` (Mona Sans) and `geistMono` registrations are both replaced by a
single `appMono` on `JetBrainsMono-Variable.woff2`, exposed as `--font-app-mono`
with `weight: "100 800"`. `appSans` (Geist, `--font-app-sans`) is unchanged. The
`html` className list updates accordingly, and the file's header comment is
rewritten — it currently describes Mona Sans and Geist Mono.

### 2.3 `palette.css` families

```css
--font-display: var(--font-app-mono), "JetBrains Mono", ui-monospace, monospace;
--font-sans:    /* unchanged */
--font-mono:    var(--font-app-mono), "JetBrains Mono", "SFMono-Regular", Consolas,
                "Liberation Mono", Menlo, monospace;
```

The CJK blocks keep their existing `--font-display: var(--font-sans)` override —
JetBrains Mono has no Han coverage — and their `--font-mono` fallback stacks swap
Geist Mono for JetBrains Mono. The block comment at `palette.css:138` and the
CJK comment at `:195` both name Geist Mono and must be rewritten.

### 2.4 `roles.css` display tier

Mono needs more weight and much tighter tracking than a sans at the same size:

| role | from | to |
|---|---|---|
| `--type-display` | `600 var(--fs-6)/1.15` | `700 var(--fs-6)/1.15` |
| `--type-title` | `550 var(--fs-title)/1.2` | `700 var(--fs-title)/1.2` |
| `--type-heading` | `550 var(--fs-heading)/1.3` | `600 var(--fs-heading)/1.3` |
| `--type-number` | `600 var(--fs-number)/1.4` | `700 var(--fs-number)/1.4` |
| `--type-code` | `400 var(--fs-2)/1.5` | unchanged |

`--type-number`'s existing `+ tabular-nums` comment becomes redundant under a
monospace face but is harmless; keep the declaration, update the comment. The
`roles.css:30` comment naming Mona Sans and Geist Mono is rewritten.

### 2.5 Tracking

Letter-spacing cannot ride the `font` shorthand, so it is applied at call sites.

**A new token is introduced rather than repurposing the existing one.**
`--track-tight` stays `0`. Ten of its consumers are not display-tier —
`login.css:67` and `:82`, `admin-v2-dashboard.css:400`, `admin-v2-drawers.css:84`,
`atelier.css:46/:227/:322/:335`, `workspace.css:880`, `mobile-overlays.css:56` —
and flipping the shared token would silently re-track all of them.

```css
--track-display: -0.04em;   /* :root */
--track-display: 0;         /* html:lang(zh-CN), html:lang(zh-TW) */
```

There are 18 display-role call sites. Four already pair a display role with
`letter-spacing` and switch from `--track-tight` to `--track-display`:

- `shell.css:50`, `shell.css:57`
- `preferences.css:57`
- `admin-v2-views.css:1658`

The remaining 14 gain a `letter-spacing: var(--track-display);` line:

- `admin-v2-views.css:191`, `:317`, `:1811`
- `admin-v2-dashboard.css:70`, `:161`
- `admin-v2-drawers.css:947`
- `backlog.css:1101`
- `empty-state.css:108`
- `sidenav.css:76`
- `thread.css:31`
- `chat.css:69`
- `dialog.css:71`
- `mobile-overlays.css:130`, `:160`

### 2.6 `.mono` — deliberately untouched

`base.css:141` defines `.mono` as `font-family: var(--font-sans)` with tabular
numerals — it is a *figures* class, not a typeface class, and the name is
misleading. It was considered for renaming in this pass and **excluded**.

The reason is that the misnomer is not cosmetic: `.mono` has 25+ call sites across
`web/src/components/`, and they split into two different intents. Some want tabular
figures in the reading face (`PageHeader` counts, `ThreadRow` stamps,
`ThreadListPanel` counts, `MessageBlock` timestamps). Others clearly want the
monospace *face* — `NodeRow`/`NodeCard` handles, `CredentialsDrawer` values,
`AddNodeDrawer`/`AssignNodeDrawer` operator handles, several carrying
`translate="no"` — and today silently get sans instead.

Separating those two intents means auditing every call site and is a behavioural
change with real regression surface. It is equally wrong before and after this
spec, so it is orthogonal to the identity change and belongs in its own pass. See
§9.

## 3. Colour

`palette.css` is unchanged except for one additive role in each register. No
existing value moves.

```css
:root                  { --live: #3ee08a; }   /* dark register  */
html[data-theme=light] { --live: #0b7a45; }   /* light register */
--live-wash: color-mix(in srgb, var(--live) 7%, transparent);
```

Measured contrast:

| pair | ratio | verdict |
|---|---|---|
| `#3ee08a` on `--surface-0` `#101214` | 10.94:1 | AA / AAA |
| `#3ee08a` on `--surface-1` `#16181b` | 10.36:1 | AA / AAA |
| `#0b7a45` on `--surface-0` `#f7f8f9` | 5.08:1 | AA |
| `#0b7a45` on `--surface-1` `#ffffff` | 5.41:1 | AA |

Both registers clear AA for small text, so an elapsed timer set in `--live` is
legible rather than decorative. **`#0f8a4e` measures 4.14:1 and fails AA** — it is
recorded here so the light-register green is not "brightened for legibility" in a
later pass.

`--live` never touches `--action`, `--err`, `--warn`, `--ok`, `--focus-ring`, or any
text not reporting live work. Existing stylelint already forbids raw hex outside
`palette.css`, so the token cannot leak in as a literal.

## 4. Presence system

The app already draws the needed boundary. `palette.css:152` documents `--t-pulse`
as "active work (streaming agent, running task, busy header)" and `--t-pulse-calm`
as "passive presence (online dot, idle node)". That is exactly the line between
*working* and *merely present*.

**Scope rule: `--live` is legal exactly where `--t-pulse` is used, and nowhere
`--t-pulse-calm` is used.**

| surface | site | `--live` |
|---|---|---|
| composer running indicator | `inputs.css:153` | yes |
| task status pulse | `backlog.css:505`, `:1379` | yes |
| agent stream activity | `agent-stream.css:481` | yes |
| busy header agent | `chat.css:211` | yes |
| thread pulse, agent rail | `chat.css:549`, `:563` | yes |
| node online dot | `admin-v2-views.css:1071`, `:1116` | no — calm |
| workspace metric | `workspace.css:180`, `:974` | no — calm |
| login readiness | `login.css:256` | no — exception |

Seven sites take the accent. Each carries the row treatment as appropriate:
presence dot in `--live`, active-row background `--live-wash` with a 2px
`--live` inset left edge, elapsed timer in `--live`, running bar fill in `--live`.

**Login is a deliberate exception and must not be "fixed" later.** It reports node
readiness *before authentication*, not agent work, and it runs on the pinned
`--lg-*` palette precisely because no theme has loaded. Pre-auth Relay is fully
monochrome; no `--lg-live` token is introduced.

**WCAG 1.4.1.** Green is never the sole channel — every `--live` surface also
pulses on `--t-pulse` and is accompanied by an elapsed timer and status copy.
Because motion is part of the encoding, `prefers-reduced-motion` behaviour must be
re-verified: with motion suppressed the colour becomes load-bearing.

## 5. Brand assets

The duo-chevron geometry is retained — it is five weeks old (`2026-06-19-relay-logo-chevron-design.md`)
and out of scope. Colour and the wordmark's face change.

`relay-logo.svg` and `relay-mark.svg` exist in **two trees**, `assets/brand/` and
`web/public/brand/`, and both copies must be updated. The duplication is noted but
not resolved here.

- **Bare mark** — `relay-mark.svg` and `RelayMark.tsx`: monochrome. The lead
  chevron moves from `var(--action)` to `var(--ink-1)`. Under Phosphor `--action`
  means "this is a button" and the logo is not a button; the rendered pixels are
  identical today, the semantics are correct going forward. The standalone SVG
  drops `#2f5fad`/`#5b87d6` for the ink ramp with its `prefers-color-scheme`
  override retained.
- **Wordmark** — `relay-logo.svg`: drops steel-blue for the ink ramp, and the
  "Relay" lettering moves from Geist 600 to **JetBrains Mono 700 at −0.04em**.
  This asset is what `README.md` and `docs/product.md` display, and it currently
  advertises an identity two rebrands stale.
- **Favicon** — `web/public/favicon.svg`: the `#101214` canvas is kept; the lead
  chevron becomes phosphor green `#3ee08a`, replacing steel `#6ba1d4`.

**The favicon is a deliberate, bounded exception to the colour rule.** A tab-strip
icon is not reporting a run, so strictly it should be grey. Green is chosen because
at 16px the icon's job is to identify Relay, a grey chevron on a grey square is
invisible in a tab strip, and "the green one runs my agents" is the association
worth owning. This is the only non-liveness use of the accent anywhere.

## 6. Documentation

`docs/design-system.md` and `docs/design-system-preview.html` both document the
type and colour contract and are rewritten. `design-system.md` is the permanent
home of the §4 scope rule, since that rule *is* the identity.

## 7. Test changes

`web/tests/typographyTokens.test.ts` encodes the current identity in twelve
assertions and is rewritten rather than patched. It must assert:

- `JetBrainsMono-Variable.woff2` and `Geist-Variable.woff2` exist, exceed 1 KB, and
  begin with the `wOF2` magic; `MonaSans-Variable.woff2` and
  `GeistMono-Variable.woff2` are **absent**
- `OFL-JetBrainsMono.txt` ships; the `.gitattributes` LFS check is retained
- `layout.tsx` references `./fonts/JetBrainsMono-Variable.woff2` and
  `--font-app-mono`, and no longer references Mona Sans or Geist Mono
- `palette.css` declares `--font-display` and `--font-mono` over `--font-app-mono`
- display roles are `700` / `700` / `600` / `700`; `--type-body` stays `400` over
  `--font-sans`; `--type-label` stays `500`
- `--track-display: -0.04em` in `:root`, `--track-display: 0` in both CJK blocks,
  and `--track-tight: 0` unchanged
- both CJK blocks still resolve `--font-display: var(--font-sans)`
- the existing sentence-case eyebrow/kicker assertions are retained

One new assertion: `--live` is declared in `palette.css` in both registers and
appears in no other file under `web/src/styles/tokens/`. This makes the scope rule
enforced rather than merely documented.

## 8. Verification

1. `npm test` green, including the rewritten typography test.
2. Stylelint clean across every touched file; `--live` appears as a literal only in
   `palette.css`.
3. Measured contrast matches §3; record the real JetBrains Mono byte count and net
   font-payload delta in §2.1.
4. Visual pass via `make web`:
   - dark register and light register
   - a running agent (green present) and a fully idle roster (no green anywhere)
   - `prefers-reduced-motion: reduce` — liveness still readable without animation
   - the login screen — must show **zero** green in both attach and bootstrap modes
   - `zh-CN` locale — display text falls back to system sans with tracking at 0
5. Favicon checked at 16px in a real tab strip, light and dark browser chrome.

## 9. Out of scope

- The shell structure (icon rail, header, list body) is unchanged. This spec
  changes what the app is *about*, not its layout.
- The chevron geometry.
- `relay-tui` — the identity does not extend to ANSI chrome in this pass.
- Resolving the `assets/brand/` ÷ `web/public/brand/` duplication.
- The `.mono` class misnomer and its 25+ call sites — see §2.6.
