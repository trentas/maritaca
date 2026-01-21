# Maritaca – Brand assets

Vector artwork for logo, icon, favicon, and app icons.

## Files

| File        | Use |
|-------------|-----|
| `logo.svg`  | Logo with icon + “Maritaca” wordmark (README, docs, headers). |
| `icon.svg`  | Square icon (32×32) in teal with send arrow. Base for favicon and app icons. |

Icon color: `#0d9488` (teal). Logo text: `#18181b`.

## Favicon

1. **SVG as favicon** (modern browsers): use `icon.svg` directly:
   ```html
   <link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
   ```

2. **ICO (fallback)** from `icon.svg`:
   - [realfavicongenerator.net](https://realfavicongenerator.net/) – upload `icon.svg` and download the package (favicon.ico + PNGs).
   - Or with ImageMagick (after exporting to PNG):
     ```bash
     convert -background none -resize 32x32 assets/icon.svg favicon.ico
     ```
   - Or with `rsvg-convert` (librsvg):
     ```bash
     rsvg-convert -w 32 -h 32 assets/icon.svg -o favicon-32.png
     # then convert PNG→ICO with ImageMagick or online tools
     ```

## App icons (PWA, mobile, etc.)

Export PNG from `icon.svg` at common sizes:

| Size     | Typical use |
|----------|-------------|
| 16×16    | Favicon (legacy) |
| 32×32    | Favicon, shortcuts |
| 180×180  | Apple touch icon |
| 192×192  | PWA, Android |
| 512×512  | PWA splash, Android |

Example with `rsvg-convert`:

```bash
for size in 16 32 180 192 512; do
  rsvg-convert -w $size -h $size assets/icon.svg -o "icon-${size}.png"
done
```

Or open `icon.svg` in Inkscape/Illustrator and export at the sizes you need.

## Where to put them in the project

- **API / static site**: copy `favicon.ico` (or `icon.svg`) into the static assets folder and add the `<link rel="icon">` to your HTML.
- **GitHub**: the main README already uses `assets/logo.svg`; `icon.svg` can be used for social preview (configure in *Settings → General → Social preview* with a 1280×640 PNG if desired).
- **PWA**: place the `icon-*.png` files in the project root or under `/icons` and reference them in `manifest.json`.
