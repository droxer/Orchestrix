# Relay Brand Assets

This folder contains the current Relay product logo assets.

## Files

- `relay-logo.svg`: primary horizontal logo for readmes, docs, landing pages,
  and product headers.
- `relay-mark.svg`: standalone mark for app icons, favicons, avatars, compact
  navigation, and CLI/package identity.
- `relay-logo-concept.png`: generated concept reference used to derive the
  editable SVG assets. The SVG files are the source of truth for the current
  palette.

## Colors

- Ink: `#18232d`
- Relay blue: `#0052ff`
- Surface: `#f7f6f1`

The SVG files define these as CSS variables:

```css
--relay-ink: #18232d;
--relay-accent: #0052ff;
--relay-surface: #f7f6f1;
```

Use `relay-logo.svg` when the wordmark has enough horizontal room. Use
`relay-mark.svg` when the logo must survive at small sizes.

## Usage

- `relay-mark.svg` — icon-only mark. Use for favicons, small nav glyphs, anywhere the wordmark would be redundant. Default render: 48×32 px in nav bars, 24×16 px for favicons; remains legible down to 16 px wide.
- `relay-logo.svg` — full lockup (mark + "Relay" wordmark). Use for README heroes and marketing surfaces. Default render: 200×40 px or larger.
- `relay-logo-concept.png` — original concept reference. Do not embed in product surfaces; use the SVGs.

### Colors

The mark uses two colors only:

- Ink `#18232d` — input nodes, input traces, and wordmark.
- Relay Blue `#0052ff` — signal line and arrowhead.

On dark surfaces, every element currently rendered in ink swaps to `#ffffff`. Relay Blue is unchanged.

### Clear space

Reserve at least 25% of the mark width as empty canvas on all sides of the lockup. Never crop into this region.
