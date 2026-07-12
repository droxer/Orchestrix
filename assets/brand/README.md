# Relay Brand Assets

This folder contains the current Relay product logo assets. The source SVGs use
the same mark: dual chevrons — the lead stroke carries **Graphite Steel** (the
action accent) and the trailing stroke reads as stable ink on the control plane.

## Files

- `relay-logo.svg`: primary horizontal logo for readmes, docs, landing pages,
  and product headers.
- `relay-mark.svg`: standalone mark for app icons, favicons, avatars, compact
  navigation, and CLI/package identity.
- `relay-logo-concept.png`: early generated concept reference. Do not embed it
  in product surfaces; the SVG files are the source of truth.

## Colors (Graphite Steel)

| Role | Light | Dark |
|------|-------|------|
| Ink | `#12141a` | `#f3f5f7` |
| Action (steel) | `#2f5fad` | `#5b87d6` |
| On-action | `#ffffff` | `#0a1220` |
| Canvas | `#f7f8fa` | `#0b0d10` |

The logo SVG defines theme-aware CSS variables:

```css
--relay-ink: #12141a;      /* dark: #f3f5f7 */
--relay-accent: #2f5fad;   /* dark: #5b87d6 */
```

`relay-mark.svg` uses the dark action fill (`#5b87d6`) with on-action strokes
(`#0a1220`) so the icon reads clearly at favicon sizes.

Use `relay-logo.svg` when the wordmark has enough horizontal room. Use
`relay-mark.svg` when the logo must survive at small sizes or when nearby text
already says Relay.

## Usage

- `relay-mark.svg` — icon-only mark. Use for favicons, small nav glyphs, anywhere the wordmark would be redundant. Default render: 48×32 px in nav bars, 24×16 px for favicons; remains legible down to 16 px wide.
- `relay-logo.svg` — full lockup (mark + "Relay" wordmark). Use for README heroes and marketing surfaces. Default render: 200×40 px or larger.
- `relay-logo-concept.png` — original concept reference. Do not embed in product surfaces; use the SVGs.

### Geometry

- Lead chevron (action): `M12 14 L32 32 L12 50` — Graphite Steel stroke.
- Trailing chevron (ink): `M32 14 L52 32 L32 50` at ~45–55% opacity — control-plane echo.

### Colors

The lockup uses two roles only:

- Action (steel) — lead chevron (`#5b87d6` dark / `#2f5fad` light).
- Ink — trailing chevron and wordmark (`#f3f5f7` dark / `#12141a` light).

Standalone SVGs include a `prefers-color-scheme: dark` rule for
browser/README rendering. The React `RelayMark` paints the lead chevron with
`var(--color-semantic-action)` and the trailing chevron with `currentColor`, so
product chrome can keep surrounding text on the ink token.

### Clear space

Reserve at least 25% of the mark width as empty canvas on all sides of the lockup. Never crop into this region.
