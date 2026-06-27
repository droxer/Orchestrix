# Preferences Panel Redesign — Design

**Date:** 2026-06-27
**Status:** Approved (design), pending implementation plan

## Context

The preferences panel (`web/src/components/PreferencesPanel.tsx`, hosted by
`PreferencesDialog.tsx`, styled in `web/src/styles/preferences.css`) is a
centered modal with a master-detail layout: a 168px left category rail with
two items — **Appearance** and **Language** — and a right content panel.

Two recent issues motivate a redesign:

1. The Appearance section now has **5 theme cards** (Light, Dark, System,
   High contrast light, High contrast dark) laid out in a 2-column grid,
   leaving an orphan card alone on the last row.
2. With only two sparse categories, the panel feels thin and the chrome is
   under-considered relative to the rest of the app's design system.

## Goals

- **Visual polish** within the existing design system (tokens, ink accents,
  hairlines) — no new aesthetic.
- **Restructure** the panel while keeping the master-detail rail (refined,
  not removed).
- **Fix the orphan theme card** via semantic regrouping.

Explicitly **out of scope:** adding new settings categories or controls.

## Design

### 1. Shell & rail

- Keep the centered modal (`pref-modal`) and header (`pref-header`) as-is
  structurally.
- **Slim the rail** from 168px to ~150px; tighten padding; soften the
  divider. Keep the active-item ink accent bar (`pref-nav-item.active::before`)
  — it is the established selection cue and mirrors the sidenav.
- Add a small **leading icon** to each rail item (Appearance → a
  sun/contrast glyph; Language → a globe glyph) so two items do not look
  stranded in a tall column and the rail reads as intentional. Icons come
  from the existing `./icons` module; if a suitable glyph is missing, reuse
  the closest existing one rather than adding a new asset.

### 2. Appearance section — two labeled sub-groups

Replace the single 5-card grid with two labeled sub-groups that reuse the
**same** `pref-theme-card` + `ThemePreview` swatch component:

```
THEME
┌─────┐ ┌─────┐ ┌─────┐
│Light│ │Dark │ │ Sys │
└─────┘ └─────┘ └─────┘

HIGH CONTRAST
┌───────┐ ┌───────┐
│ Light │ │ Dark  │
└───────┘ └───────┘
```

- **THEME** group: eyebrow label + 3-column grid → `light`, `dark`, `system`.
- **HIGH CONTRAST** group: eyebrow label + 2-column grid → `contrast`
  (light), `contrast-dark`.
- Only the grid wrapper differs between groups; the card and swatch markup
  are unchanged, so no new card aesthetic is introduced.
- **Accessibility:** the whole appearance section remains a **single ARIA
  radiogroup** spanning all 5 options. The eyebrows are visual grouping
  only, not separate radiogroups. Roving-tabindex keyboard navigation
  (`moveRadioSelection`) is preserved, and arrow-key order matches reading
  order: Light → Dark → System → HC Light → HC Dark.

### 3. Language section — polish

Restyle the three language buttons (`pref-lang-btn`) so they visually match
the refined theme cards: consistent radius, border, selected treatment, and
a check affordance. Goal is that both sections read as one coherent system.
Structure and the existing radiogroup/keyboard behavior are unchanged.

### 4. Visual polish pass

- Align spacing and typography to design tokens (eyebrow labels, grid gaps,
  card padding).
- Refine selected / hover / focus states for cards and rail items.
- Verify every swatch renders its fixed theme correctly under all active
  themes (the swatches must not flip with the live theme).

## Components & boundaries

- `PreferencesPanel.tsx` — owns the section markup. Changes: add the two
  sub-group wrappers in `AppearanceSection`, add rail icons in the category
  nav. `THEME_VALUES` stays a single array; the render splits it into the two
  groups by slicing known values (base themes vs. contrast themes) so the
  radiogroup and `moveRadioSelection` continue to operate over the full list.
- `preferences.css` — owns all visual treatment: rail width/padding/divider,
  the two new grid wrappers, card states, language-button restyle.
- `PreferencesDialog.tsx` — no change expected (header/close/portal stay).
- i18n — add two eyebrow keys: `pref.theme.group` ("Theme") and
  `pref.theme.contrast_group` ("High contrast"), in all three locales
  (en, zh-CN, zh-TW). No other copy changes.

## Data flow

Unchanged. `theme` / `language` come in as props; `onThemeChange` /
`onLanguageChange` fire on selection. `applyTheme` / `writeTheme` in
`appStorage.ts` are untouched — this is a presentation-only redesign.

## Testing

- `web/tests/appStorage.test.ts` — unchanged (no storage/apply changes).
- Existing component behavior: the appearance radiogroup must still expose
  all 5 options and keyboard-navigate across both visual groups in reading
  order. If a component test covers the panel, update its assertions to the
  new grouped structure; otherwise verify manually that:
  - all 5 theme cards are reachable by Tab + arrow keys as one group,
  - selecting any card updates the active theme,
  - the orphan is gone (3 + 2 layout),
  - language buttons retain their selected/keyboard behavior.

## Risks

- Splitting the rendered list into two grids while keeping one radiogroup is
  the main subtlety — the roving-tabindex refs map must still cover all 5
  values. Keep `THEME_VALUES` as the single source for keyboard order.
- Rail icons: avoid introducing new icon assets; reuse existing glyphs.
