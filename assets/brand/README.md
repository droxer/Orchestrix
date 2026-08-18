# Relay Brand Assets

These are the repository-facing Fieldnotes logo assets. The living color and
typography contract is maintained in
[`docs/design-system.md`](../../docs/design-system.md); do not duplicate its
token table here.

## Files

- `relay-logo.svg` is the primary wordmark for documentation and other
  standalone surfaces. It is olive ink and follows the viewer's light or dark
  color scheme.
- `relay-mark.svg` is the dark app-icon badge. Its lead chevron uses the
  bounded app-icon exception to the one-hue rule (highlighter yellow).
- `relay-logo-concept.png` is an early concept reference. Do not ship or embed
  it when an SVG is available.

The web app has delivery-specific copies under `web/public/brand/`:

- `relay-logo.svg` is a light-background standalone wordmark.
- `relay-mark.svg` is the light app-icon badge used as the Apple touch icon.
- `web/public/favicon.svg` is the dark browser-tab icon.

The two icon variants intentionally use different register values. Keep their
geometry aligned, but do not make their colors byte-identical.

## Usage

- Use the wordmark in readmes, documentation, and wide product headers.
- Use an app-icon badge for favicons, touch icons, avatars, and compact launch
  surfaces.
- Use the in-app `RelayMark` component for themed application chrome instead
  of embedding one of these fixed-register SVGs.
- Preserve each SVG's `viewBox`, rounded strokes, and
  `shape-rendering="geometricPrecision"` setting.

When the identity changes, update the design system first, then review both
asset trees and the favicon together.
