# PlayIT — Brand Identity Guidelines & Asset System

**Version:** 1.5.0  
**Design System:** PlayIT Sonic Prism Identity  
**Primary URL:** https://playit.vercel.app/  
**Repository:** https://github.com/aditya-misra346/PlayIT  
**Creator Attribution:** Made by Aditya Misra

---

## 1. Brand Concept & Philosophy

**PlayIT** combines the elemental concepts of sound playback, acoustic frequency analysis, and instantaneous song discovery ("You play it, we name it").

### The Core Symbol: "The Sonic Resonance P"
The PlayIT symbol represents a geometric synthesis of three core ideas:
1. **The Sonic Stem**: A vertical anchor column with calibrated micro-radii, symbolizing pure acoustic grounding.
2. **The Resonance Wave Loop**: An expanding, fluid harmonic loop tracing the letter **P**, representing sound propagation.
3. **The Discovery Pulse**: A forward-pointing equilateral impulse triangle nestled within the golden ratio focal point of the loop, symbolizing instant song identification and audio playback.
4. **The Acoustic Radar Arcs**: Three rhythmic concentric soundwave arcs emanating to the right, signifying real-time environmental music recognition.

---

## 2. Colour System

| Token Name | Hex Code | RGB | Usage |
| :--- | :--- | :--- | :--- |
| **Electric Cyan** | `#00F2FE` | `rgb(0, 242, 254)` | Primary signal color, "IT" wordmark accent, active listening indicator |
| **Sonic Azure** | `#2563EB` | `rgb(37, 99, 235)` | Mid-harmonic gradient anchor, desktop branding, primary buttons |
| **Hyper Violet** | `#7C3AED` | `rgb(124, 58, 237)` | Deep resonance harmonic, outer gradient accent, luxury audio touch |
| **Obsidian Void** | `#070B19` | `rgb(7, 11, 25)` | Master dark background, application shell canvas |
| **Elevated Surface** | `#0F172A` | `rgb(15, 23, 42)` | Card containers, navigation headers, modals |
| **Pure White** | `#FFFFFF` | `rgb(255, 255, 255)` | Primary typography ("PLAY"), monochrome white marks |
| **Stealth Slate** | `#94A3B8` | `rgb(148, 163, 184)` | Secondary copy, acoustic taglines, metadata chips |

---

## 3. Typography & Wordmark

- **Brand Wordmark**: **PLAYIT**
  - **PLAY**: Set in bold geometric sans-serif (`#FFFFFF` on dark, `#070B19` on light).
  - **IT**: Set in vibrant **Electric Cyan** (`#00F2FE`) on dark surfaces and **Sonic Azure** (`#2563EB`) on light surfaces.
  - **Sonic Dot**: A precision circular accent situated above the letter "I".
- **Acoustic Tagline**: `HEAR IT. KNOW IT.`
  - Set in tracked uppercase (`letter-spacing: 5.5px`, `#94A3B8`).

---

## 4. Master Asset Directory Structure

```text
web/public/
├── brand/
│   ├── logo.svg                   # Primary full horizontal brand logo (dark bg)
│   ├── logo-dark.svg              # Horizontal brand logo for dark backgrounds
│   ├── logo-light.svg             # Horizontal brand logo for light backgrounds
│   ├── logo-monochrome-black.svg  # High-contrast solid black vector
│   ├── logo-monochrome-white.svg  # High-contrast solid white vector
│   ├── logo-icon.svg              # Standalone app icon with dark squircle
│   ├── logo-icon-light.svg        # Standalone app icon for light surface
│   ├── logo-symbol.svg            # Transparent background vector symbol only
│   ├── logo-wordmark.svg          # Transparent background typographic wordmark
│   ├── og-image.png               # 1200 x 630 px master Open Graph card
│   └── twitter-image.png          # 1200 x 630 px Twitter / X summary card
├── icons/
│   ├── favicon.svg                # Vector browser favicon
│   ├── favicon.ico                # Multi-resolution ICO (16, 32, 48, 64, 128, 256)
│   ├── favicon-16x16.png
│   ├── favicon-32x32.png
│   ├── favicon-48x48.png
│   ├── apple-touch-icon.png       # 180x180 iOS Safari touch icon
│   ├── icon-192.png               # 192x192 standard PWA icon
│   ├── icon-maskable-192.png      # 192x192 adaptive maskable PWA icon
│   ├── icon-512.png               # 512x512 standard PWA / store icon
│   └── icon-maskable-512.png      # 512x512 adaptive maskable PWA icon
├── icon.svg                       # Root vector icon fallback
├── favicon.svg                    # Root vector favicon
├── favicon.ico                    # Root multi-res ICO
├── og-image.png                   # Root Open Graph image for social platforms
└── manifest.webmanifest           # PWA metadata referencing all icons
```

---

## 5. Platform-Specific Implementations

### Android (`android/app/src/main/res/`)
- `drawable/ic_launcher_background.xml`: Deep `#070B19` Obsidian background with subtle radial sonic depth.
- `drawable/ic_launcher_foreground.xml`: Vector Sonic Resonance "P" Key with gradient strokes and play pulse node.
- `drawable/ic_launcher_monochrome.xml`: Flat vector for Android 13+ material themed icons.
- `mipmap-*/ic_launcher.png` & `ic_launcher_round.png`: High-resolution raster launcher icons for mdpi (48), hdpi (72), xhdpi (96), xxhdpi (144), and xxxhdpi (192).

### iOS (`ios/App/Assets.xcassets/AppIcon.appiconset/`)
- `AppIcon-1024.png`: 1024×1024 master icon for App Store / iPad Pro.
- `AppIcon-180.png`: 180×180 (@3x) for iPhone Home Screen.
- `AppIcon-120.png`: 120×120 (@2x) for iPhone Home Screen / Spotlight.
- `AppIcon-167.png`: 167×167 (@2x) for iPad Pro Home Screen.
- `AppIcon-152.png`: 152×152 (@2x) for iPad Air / Mini Home Screen.
- `Contents.json`: Complete Xcode asset catalog declaration.

### Desktop — macOS, Windows & Linux (`desktop/src-tauri/icons/`)
- `icon.icns`: Native Apple multi-resolution icon bundle (16 to 1024 px) generated via macOS `iconutil`.
- `icon.ico`: Native Windows multi-resolution icon bundle (16, 32, 48, 64, 128, 256 px).
- `icon.png`: 512×512 Linux desktop launcher icon.
- `32x32.png`, `128x128.png`, `128x128@2x.png`: Linux & Tauri window icons.
- `Square*Logo.png`, `StoreLogo.png`: Windows Store and Start Menu live tiles.

---

## 6. Social Media Sharing Card (Open Graph & Twitter)

- **File**: `public/og-image.png` & `public/brand/og-image.png`
- **Resolution**: Exactly `1200 × 630 pixels`
- **Design Specifications**:
  - Background: Deep obsidian space with subtle harmonic radar rings.
  - Core Focus: Centered 168×168 glowing PlayIT Sonic P badge with volumetric cyan/blue radial bloom.
  - Main Title: **PLAYIT** (72px, `#FFFFFF` with `#00F2FE` "IT").
  - Tagline: "Discover the music around you."
  - Feature Pills: "Instant Acoustic Recognition · Cross-Platform · 100% Free".
  - Creator Tag: "Made by Aditya Misra".
- **HTML Headers** (`web/index.html`):
  - `og:image` and `og:image:secure_url`: `https://playit.vercel.app/og-image.png`
  - `og:image:type`: `image/png`
  - `og:image:width`: `1200`
  - `og:image:height`: `630`
  - `twitter:card`: `summary_large_image`
  - `twitter:image`: `https://playit.vercel.app/og-image.png`

---

## 7. How to Regenerate the Brand Identity Family

To update or regenerate all assets across the entire ecosystem, run:

```bash
python3 scripts/generate-brand-assets.py
npm run build
```

The script automatically executes headless Chrome rasterization, Pillow multi-size resampling, Windows ICO generation, and macOS `iconutil` `.icns` compilation.
