# Relay Brand Assets

This folder contains the current Relay product logo assets. The source SVGs use
the same mark: a custom monoline `R` whose ink loop reads as the stable control
plane and whose Relay-blue diagonal reads as the execution relay.

## Files

- `relay-logo.svg`: primary horizontal logo for readmes, docs, landing pages,
  and product headers.
- `relay-mark.svg`: standalone mark for app icons, favicons, avatars, compact
  navigation, and CLI/package identity.
- `relay-logo-concept.png`: early generated concept reference. Do not embed it
  in product surfaces; the SVG files are the source of truth.

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
`relay-mark.svg` when the logo must survive at small sizes or when nearby text
already says Relay.

## Usage

- `relay-mark.svg` — icon-only mark. Use for favicons, small nav glyphs, anywhere the wordmark would be redundant. Default render: 48×32 px in nav bars, 24×16 px for favicons; remains legible down to 16 px wide.
- `relay-logo.svg` — full lockup (mark + "Relay" wordmark). Use for README heroes and marketing surfaces. Default render: 200×40 px or larger.
- `relay-logo-concept.png` — original concept reference. Do not embed in product surfaces; use the SVGs.

### Geometry

- Control-plane loop: rounded 5-unit ink stroke, `M18 50 V14 H44 C56 14 64 21
  64 31 C64 41 56 47 44 47 H18`.
- Execution relay: rounded 5-unit Relay-blue diagonal from `M44 47` to
  `L70 56`.

### Colors

The mark uses two colors only:

- Ink `#18232d` — control-plane loop and wordmark.
- Relay Blue `#0052ff` — execution relay.

On dark surfaces, every element currently rendered in ink swaps to `#ffffff`.
Relay Blue is unchanged. The standalone SVGs include a
`prefers-color-scheme: dark` rule for browser/README rendering; the React
`RelayMark` uses `currentColor` for the ink stroke, so product surfaces can set
the surrounding `color` token to `--color-ink` or `--color-on-dark`.

### Clear space

Reserve at least 25% of the mark width as empty canvas on all sides of the lockup. Never crop into this region.
