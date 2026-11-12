#!/usr/bin/env python3
"""
PlayIT Master Brand Identity & Multi-Platform Asset Generator
-------------------------------------------------------------
Generates the complete world-class brand identity asset family for PlayIT:
1. Vector SVG brand suite (horizontal, standalone symbol, wordmark, light/dark/monochrome)
2. Web raster icons & favicons (16, 32, 48, 180, 192, 512, favicon.ico)
3. Social sharing Open Graph cards (1200x630 og-image.png, twitter-image.png)
4. Android adaptive launcher icons (drawable XML vectors, mipmap densities)
5. iOS AppIcon asset catalog (AppIcon-1024, 180, 120, 167, 152, Contents.json)
6. Desktop Tauri icons (512, 256, 128, 32, Windows .ico, macOS .icns via iconutil, Windows store tiles)
"""

import json
import os
import shutil
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
BRAND_DIR = os.path.join(WEB_DIR, "public", "brand")
ICONS_DIR = os.path.join(WEB_DIR, "public", "icons")
PUB_DIR = os.path.join(WEB_DIR, "public")
DESKTOP_ICONS_DIR = os.path.join(ROOT, "desktop", "src-tauri", "icons")
ANDROID_RES_DIR = os.path.join(ROOT, "android", "app", "src", "main", "res")
IOS_APPICON_DIR = os.path.join(ROOT, "ios", "App", "Assets.xcassets", "AppIcon.appiconset")

for d in [BRAND_DIR, ICONS_DIR, DESKTOP_ICONS_DIR, IOS_APPICON_DIR]:
    os.makedirs(d, exist_ok=True)

CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


# -----------------------------------------------------------------------------
# 1. Core Vector Definitions
# -----------------------------------------------------------------------------

def get_symbol_paths(stroke_color="url(#sonicGrad)", fill_color="url(#sonicGrad)", play_fill="url(#sonicGrad)", opacity_mid=0.75, opacity_far=0.40):
    """
    Returns the core PlayIT mark:
    - Vertical sound column (P stem)
    - Sound resonance loop (P curve)
    - Play pulse / discovery node (forward chevron inside loop)
    - 3 concentric acoustic radar wave arcs
    """
    return f"""
  <!-- P-Stem: Precision Vertical Audio Column with Rounded Terminals -->
  <rect x="146" y="142" width="44" height="228" rx="22" fill="{fill_color}"/>

  <!-- P-Resonance Loop: Fluid Harmonic Acoustic Outer Loop -->
  <path d="M168 142 H272 C324 142 358 174 358 224 C358 274 324 306 272 306 H190 C178 306 168 296 168 284 V142 Z"
        fill="none" stroke="{stroke_color}" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Play Discovery Impulse: Forward Recognition Trigger -->
  <path d="M232 196 C232 190 239 186 244 190 L278 214 C283 218 283 226 278 230 L244 254 C239 258 232 254 232 248 Z"
        fill="{play_fill}"/>

  <!-- Acoustic Emission Radar Arcs (Sound Frequency Discovery) -->
  <path d="M374 162 A 136 136 0 0 1 374 286" stroke="{stroke_color}" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.95"/>
  <path d="M414 134 A 180 180 0 0 1 414 314" stroke="{stroke_color}" stroke-width="14" stroke-linecap="round" fill="none" opacity="{opacity_mid}"/>
  <path d="M452 108 A 224 224 0 0 1 452 340" stroke="{stroke_color}" stroke-width="11" stroke-linecap="round" fill="none" opacity="{opacity_far}"/>
"""


def build_icon_svg(variant="dark"):
    """Standalone 512x512 App Icon"""
    if variant == "dark":
        bg_fill = "url(#obsidianGrad)"
        border_stroke = "url(#sonicGrad)"
        border_opacity = "0.40"
        symbol_paths = get_symbol_paths()
        inner_glow = """<circle cx="240" cy="235" r="170" fill="url(#auraGlow)"/>"""
    elif variant == "light":
        bg_fill = "#FFFFFF"
        border_stroke = "rgba(37, 99, 235, 0.25)"
        border_opacity = "1.0"
        symbol_paths = get_symbol_paths(stroke_color="url(#sonicGradDark)", fill_color="url(#sonicGradDark)", play_fill="#00F2FE", opacity_mid=0.70, opacity_far=0.35)
        inner_glow = """<circle cx="240" cy="235" r="170" fill="rgba(37, 99, 235, 0.06)"/>"""
    else:  # monochrome
        bg_fill = "#000000" if variant == "mono-white" else "#FFFFFF"
        border_stroke = "#FFFFFF" if variant == "mono-white" else "#000000"
        border_opacity = "0.50"
        fill_col = "#FFFFFF" if variant == "mono-white" else "#000000"
        symbol_paths = get_symbol_paths(stroke_color=fill_col, fill_color=fill_col, play_fill=fill_col, opacity_mid=0.75, opacity_far=0.45)
        inner_glow = ""

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" fill="none">
  <defs>
    <linearGradient id="obsidianGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0B132B"/>
      <stop offset="50%" stop-color="#070B19"/>
      <stop offset="100%" stop-color="#03050E"/>
    </linearGradient>
    <linearGradient id="sonicGrad" x1="120" y1="120" x2="440" y2="400" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00F2FE"/>
      <stop offset="48%" stop-color="#2563EB"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <linearGradient id="sonicGradDark" x1="120" y1="120" x2="440" y2="400" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0284C7"/>
      <stop offset="50%" stop-color="#1D4ED8"/>
      <stop offset="100%" stop-color="#6D28D9"/>
    </linearGradient>
    <radialGradient id="auraGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#00F2FE" stop-opacity="0.32"/>
      <stop offset="45%" stop-color="#2563EB" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#070B19" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Squircle Canvas Silhouette -->
  <rect width="512" height="512" rx="124" fill="{bg_fill}"/>
  <rect x="2" y="2" width="508" height="508" rx="122" stroke="{border_stroke}" stroke-width="3" stroke-opacity="{border_opacity}"/>

  <!-- Volumetric Acoustic Aura Glow -->
  {inner_glow}

  <!-- Master Symbol Core -->
  {symbol_paths}
</svg>"""


def build_horizontal_logo_svg(variant="dark"):
    """
    Primary horizontal brand lockup:
    Width: 640, Height: 160
    Left: Master 120x120 squircle symbol
    Right: Custom Geometric "PLAYIT" wordmark + "HEAR IT. KNOW IT." tagline
    """
    is_dark = variant in ("dark", "mono-white")
    is_mono = variant in ("mono-black", "mono-white")

    text_play_color = "#FFFFFF" if is_dark else "#070B19"
    text_it_color = "#00F2FE" if (is_dark and not is_mono) else ("#2563EB" if not is_mono else text_play_color)
    tagline_color = "#94A3B8" if is_dark else "#64748B"

    # Inner symbol offset
    symbol_scale = 0.234  # scales 512 to ~120
    symbol_x = 20
    symbol_y = 20

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160" width="100%" height="100%" fill="none">
  <defs>
    <linearGradient id="sonicGradH" x1="120" y1="120" x2="440" y2="400" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00F2FE"/>
      <stop offset="48%" stop-color="#2563EB"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <linearGradient id="obsidianGradH" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0B132B"/>
      <stop offset="50%" stop-color="#070B19"/>
      <stop offset="100%" stop-color="#03050E"/>
    </linearGradient>
  </defs>

  <!-- Embedded Symbol Badge (Left) -->
  <g transform="translate({symbol_x}, {symbol_y}) scale({symbol_scale})">
    <rect width="512" height="512" rx="124" fill="url(#obsidianGradH)"/>
    <rect x="2" y="2" width="508" height="508" rx="122" stroke="url(#sonicGradH)" stroke-width="3" stroke-opacity="0.45"/>
    {get_symbol_paths()}
  </g>

  <!-- Typography Wordmark & Acoustic Tagline (Right) -->
  <g transform="translate(164, 40)">
    <!-- Main PLAYIT Wordmark -->
    <text x="0" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif" font-weight="900" font-size="58" letter-spacing="1.5">
      <tspan fill="{text_play_color}">PLAY</tspan>
      <tspan fill="{text_it_color}">IT</tspan>
    </text>

    <!-- Sonic Accent Dot / Frequency Pill under 'IT' -->
    <circle cx="204" cy="22" r="5" fill="{text_it_color}"/>

    <!-- Acoustic Tagline -->
    <text x="2" y="90" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif" font-weight="700" font-size="13" fill="{tagline_color}" letter-spacing="5.5">
      HEAR IT. KNOW IT.
    </text>
  </g>
</svg>"""


def build_symbol_only_svg(variant="dark"):
    """Transparent background symbol only (no squircle frame)"""
    stroke_col = "url(#sonicGradSym)" if variant == "dark" else ("#000000" if variant == "black" else "#FFFFFF")
    fill_col = stroke_col
    play_col = stroke_col

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" fill="none">
  <defs>
    <linearGradient id="sonicGradSym" x1="120" y1="120" x2="440" y2="400" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00F2FE"/>
      <stop offset="48%" stop-color="#2563EB"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
  </defs>
  {get_symbol_paths(stroke_color=stroke_col, fill_color=fill_col, play_fill=play_col)}
</svg>"""


def build_wordmark_only_svg(variant="dark"):
    """Wordmark only (horizontal)"""
    play_col = "#FFFFFF" if variant == "dark" else "#070B19"
    it_col = "#00F2FE" if variant == "dark" else "#2563EB"
    tag_col = "#94A3B8" if variant == "dark" else "#64748B"

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 120" width="100%" height="100%" fill="none">
  <text x="0" y="66" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif" font-weight="900" font-size="68" letter-spacing="2">
    <tspan fill="{play_col}">PLAY</tspan>
    <tspan fill="{it_col}">IT</tspan>
  </text>
  <circle cx="238" cy="24" r="6" fill="{it_col}"/>
  <text x="3" y="102" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif" font-weight="700" font-size="14" fill="{tag_col}" letter-spacing="6">
    HEAR IT. KNOW IT.
  </text>
</svg>"""


# -----------------------------------------------------------------------------
# 2. Chrome Headless Renderer
# -----------------------------------------------------------------------------

def render_svg_to_png(svg_string: str, out_png_path: str, width: int, height: int, transparent: bool = True):
    """Render an SVG string to a high-resolution PNG using Headless Chrome."""
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  html, body {{ width: {width}px; height: {height}px; background: {'transparent' if transparent else '#070B19'}; overflow: hidden; }}
  svg {{ width: 100%; height: 100%; display: block; }}
</style>
</head>
<body>
{svg_string}
</body>
</html>"""
        f.write(html)
        tmp_html = f.name

    cmd = [
        CHROME_BIN,
        "--headless=new",
        f"--screenshot={out_png_path}",
        f"--window-size={width},{height}",
        "--hide-scrollbars",
        "--default-background-color=" + ("00000000" if transparent else "070B19FF"),
        tmp_html,
    ]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.path.exists(tmp_html):
        os.remove(tmp_html)

    if not os.path.exists(out_png_path) or os.path.getsize(out_png_path) == 0:
        raise RuntimeError(f"Failed to render PNG to {out_png_path}")


# -----------------------------------------------------------------------------
# 3. Social Media Sharing Card (1200 x 630 px)
# -----------------------------------------------------------------------------

def generate_social_preview_card(out_png_path: str):
    """
    Generate an exquisite, world-class 1200x630 Open Graph & Twitter preview card.
    Features:
    - Deep obsidian void background (#070B19 to #0B132B)
    - Volumetric acoustic wave radar rings in subtle neon cyan/indigo
    - Centered prominent master PlayIT icon with layered ambient glow
    - Bold modern PLAYIT wordmark + custom electric cyan accent
    - Subtitle: "Discover the music around you."
    - Feature tags: "Instant Recognition · Cross-Platform · 100% Free"
    """
    html_content = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    background: #070B19;
    background-image: 
      radial-gradient(circle at 50% 28%, rgba(37, 99, 235, 0.28) 0%, rgba(0, 242, 254, 0.12) 35%, transparent 68%),
      radial-gradient(circle at 15% 85%, rgba(124, 58, 237, 0.18) 0%, transparent 45%),
      radial-gradient(circle at 85% 85%, rgba(0, 242, 254, 0.15) 0%, transparent 45%);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
    color: #FFFFFF;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }

  /* Decorative Acoustic Radar Concentric Rings in Background */
  .radar-ring {
    position: absolute;
    border-radius: 50%;
    border: 1px solid rgba(0, 242, 254, 0.12);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .r1 { width: 480px; height: 480px; }
  .r2 { width: 720px; height: 720px; border-color: rgba(37, 99, 235, 0.09); }
  .r3 { width: 980px; height: 980px; border-color: rgba(124, 58, 237, 0.06); }
  .r4 { width: 1240px; height: 1240px; border-color: rgba(0, 242, 254, 0.04); }

  .center-container {
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 18px;
  }

  .logo-box {
    position: relative;
    width: 168px;
    height: 168px;
    margin-bottom: 4px;
  }

  .logo-glow {
    position: absolute;
    inset: -20px;
    border-radius: 48px;
    background: radial-gradient(circle, rgba(0, 242, 254, 0.45) 0%, rgba(37, 99, 235, 0.25) 50%, transparent 70%);
    filter: blur(24px);
    z-index: -1;
  }

  .brand-title {
    font-size: 72px;
    font-weight: 900;
    letter-spacing: 2.5px;
    line-height: 1;
    margin-top: 2px;
  }
  .brand-title .it-accent {
    color: #00F2FE;
    text-shadow: 0 0 28px rgba(0, 242, 254, 0.65);
  }

  .tagline {
    font-size: 26px;
    font-weight: 500;
    color: #94A3B8;
    letter-spacing: 0.5px;
    margin-top: -2px;
  }

  .pill-row {
    display: flex;
    gap: 12px;
    margin-top: 8px;
  }

  .feature-pill {
    padding: 7px 18px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(0, 242, 254, 0.28);
    color: #38BDF8;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }
  .pill-green {
    border-color: rgba(20, 184, 166, 0.4);
    color: #2DD4BF;
  }

  .creator-badge {
    position: absolute;
    bottom: 24px;
    font-size: 14px;
    font-weight: 600;
    color: #64748B;
    letter-spacing: 1px;
  }
</style>
</head>
<body>
  <div class="radar-ring r1"></div>
  <div class="radar-ring r2"></div>
  <div class="radar-ring r3"></div>
  <div class="radar-ring r4"></div>

  <div class="center-container">
    <div class="logo-box">
      <div class="logo-glow"></div>
      <svg viewBox="0 0 512 512" width="168" height="168" fill="none">
        <defs>
          <linearGradient id="ogObsidian" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0B132B"/>
            <stop offset="50%" stop-color="#070B19"/>
            <stop offset="100%" stop-color="#03050E"/>
          </linearGradient>
          <linearGradient id="ogSonic" x1="120" y1="120" x2="440" y2="400" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#00F2FE"/>
            <stop offset="48%" stop-color="#2563EB"/>
            <stop offset="100%" stop-color="#7C3AED"/>
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="124" fill="url(#ogObsidian)"/>
        <rect x="2" y="2" width="508" height="508" rx="122" stroke="url(#ogSonic)" stroke-width="3" stroke-opacity="0.45"/>
        <!-- P-Stem -->
        <rect x="146" y="142" width="44" height="228" rx="22" fill="url(#ogSonic)"/>
        <!-- P-Loop -->
        <path d="M168 142 H272 C324 142 358 174 358 224 C358 274 324 306 272 306 H190 C178 306 168 296 168 284 V142 Z"
              fill="none" stroke="url(#ogSonic)" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
        <!-- Play Pulse Node -->
        <path d="M232 196 C232 190 239 186 244 190 L278 214 C283 218 283 226 278 230 L244 254 C239 258 232 254 232 248 Z"
              fill="url(#ogSonic)"/>
        <!-- Acoustic Radar Arcs -->
        <path d="M374 162 A 136 136 0 0 1 374 286" stroke="url(#ogSonic)" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.95"/>
        <path d="M414 134 A 180 180 0 0 1 414 314" stroke="url(#ogSonic)" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.75"/>
        <path d="M452 108 A 224 224 0 0 1 452 340" stroke="url(#ogSonic)" stroke-width="11" stroke-linecap="round" fill="none" opacity="0.40"/>
      </svg>
    </div>

    <div class="brand-title">
      PLAY<span class="it-accent">IT</span>
    </div>

    <div class="tagline">
      Discover the music around you.
    </div>

    <div class="pill-row">
      <div class="feature-pill">Instant Acoustic Recognition</div>
      <div class="feature-pill">Android · iOS · Windows · macOS · Linux</div>
      <div class="feature-pill pill-green">100% Free · No Sign-Up</div>
    </div>
  </div>

  <div class="creator-badge">Made by Aditya Misra</div>
</body>
</html>"""

    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(html_content)
        tmp_html = f.name

    cmd = [
        CHROME_BIN,
        "--headless=new",
        f"--screenshot={out_png_path}",
        "--window-size=1200,630",
        "--hide-scrollbars",
        tmp_html,
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.path.exists(tmp_html):
        os.remove(tmp_html)

    if not os.path.exists(out_png_path) or os.path.getsize(out_png_path) == 0:
        raise RuntimeError(f"Failed to render OpenGraph preview card to {out_png_path}")


# -----------------------------------------------------------------------------
# 4. Multi-Size Icon Resizer & Formatter
# -----------------------------------------------------------------------------

def generate_multi_icons(master_512_png: str):
    """Generate all required platform icon resolutions from the master 512x512 PNG."""
    im = Image.open(master_512_png).convert("RGBA")

    # Standard favicon & PWA sizes
    sizes = {
        "favicon-16x16.png": 16,
        "favicon-32x32.png": 32,
        "favicon-48x48.png": 48,
        "apple-touch-icon.png": 180,
        "icon-192.png": 192,
        "icon-512.png": 512,
    }

    for name, sz in sizes.items():
        resized = im.resize((sz, sz), Image.Resampling.LANCZOS)
        # Save in web/public/
        resized.save(os.path.join(PUB_DIR, name))
        # Save in web/public/icons/
        resized.save(os.path.join(ICONS_DIR, name))

    # Maskable PWA icon (10% safe area padding for adaptive display)
    for sz, name in [(192, "icon-maskable-192.png"), (512, "icon-maskable-512.png")]:
        mask_im = Image.new("RGBA", (sz, sz), (7, 11, 25, 255))
        inner_sz = int(sz * 0.80)
        inner = im.resize((inner_sz, inner_sz), Image.Resampling.LANCZOS)
        offset = (sz - inner_sz) // 2
        mask_im.paste(inner, (offset, offset), inner)
        mask_im.save(os.path.join(PUB_DIR, name))
        mask_im.save(os.path.join(ICONS_DIR, name))

    # Windows ICO (contains 16, 32, 48, 64, 128, 256)
    ico_im_256 = im.resize((256, 256), Image.Resampling.LANCZOS)
    ico_path_pub = os.path.join(PUB_DIR, "favicon.ico")
    ico_path_icons = os.path.join(ICONS_DIR, "favicon.ico")
    ico_im_256.save(ico_path_pub, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    shutil.copy2(ico_path_pub, ico_path_icons)

    # Desktop Tauri Icons
    desktop_sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, sz in desktop_sizes.items():
        res = im.resize((sz, sz), Image.Resampling.LANCZOS)
        res.save(os.path.join(DESKTOP_ICONS_DIR, name))

    # Desktop icon.ico
    desktop_ico_path = os.path.join(DESKTOP_ICONS_DIR, "icon.ico")
    ico_im_256.save(desktop_ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    # macOS icon.icns via iconutil
    generate_mac_icns(im, os.path.join(DESKTOP_ICONS_DIR, "icon.icns"))

    # Android mipmap densities
    android_densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder, sz in android_densities.items():
        f_dir = os.path.join(ANDROID_RES_DIR, folder)
        os.makedirs(f_dir, exist_ok=True)
        res = im.resize((sz, sz), Image.Resampling.LANCZOS)
        res.save(os.path.join(f_dir, "ic_launcher.png"))
        # Round variant
        round_mask = Image.new("L", (sz, sz), 0)
        draw = ImageDraw.Draw(round_mask)
        draw.ellipse((0, 0, sz, sz), fill=255)
        round_im = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
        round_im.paste(res, (0, 0), round_mask)
        round_im.save(os.path.join(f_dir, "ic_launcher_round.png"))

    # iOS AppIcon asset catalog
    ios_sizes = {
        "AppIcon-1024.png": 1024,
        "AppIcon-180.png": 180,
        "AppIcon-120.png": 120,
        "AppIcon-167.png": 167,
        "AppIcon-152.png": 152,
    }
    for name, sz in ios_sizes.items():
        res = im.resize((sz, sz), Image.Resampling.LANCZOS)
        res.save(os.path.join(IOS_APPICON_DIR, name))

    # iOS Contents.json
    contents_json = {
        "images": [
            {"size": "20x20", "idiom": "iphone", "filename": "AppIcon-120.png", "scale": "2x"},
            {"size": "20x20", "idiom": "iphone", "filename": "AppIcon-180.png", "scale": "3x"},
            {"size": "29x29", "idiom": "iphone", "filename": "AppIcon-120.png", "scale": "2x"},
            {"size": "29x29", "idiom": "iphone", "filename": "AppIcon-180.png", "scale": "3x"},
            {"size": "40x40", "idiom": "iphone", "filename": "AppIcon-120.png", "scale": "2x"},
            {"size": "40x40", "idiom": "iphone", "filename": "AppIcon-180.png", "scale": "3x"},
            {"size": "60x60", "idiom": "iphone", "filename": "AppIcon-120.png", "scale": "2x"},
            {"size": "60x60", "idiom": "iphone", "filename": "AppIcon-180.png", "scale": "3x"},
            {"size": "20x20", "idiom": "ipad", "filename": "AppIcon-120.png", "scale": "2x"},
            {"size": "29x29", "idiom": "ipad", "filename": "AppIcon-120.png", "scale": "2x"},
            {"size": "40x40", "idiom": "ipad", "filename": "AppIcon-120.png", "scale": "2x"},
            {"size": "76x76", "idiom": "ipad", "filename": "AppIcon-152.png", "scale": "2x"},
            {"size": "83.5x83.5", "idiom": "ipad", "filename": "AppIcon-167.png", "scale": "2x"},
            {"size": "1024x1024", "idiom": "ios-marketing", "filename": "AppIcon-1024.png", "scale": "1x"}
        ],
        "info": {"version": 1, "author": "xcode"}
    }
    with open(os.path.join(IOS_APPICON_DIR, "Contents.json"), "w") as f:
        json.dump(contents_json, f, indent=2)


def generate_mac_icns(master_im: Image.Image, out_icns_path: str):
    """Build a native macOS .icns file using iconutil."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        iconset_dir = os.path.join(tmp_dir, "icon.iconset")
        os.makedirs(iconset_dir)

        mac_sizes = [
            ("icon_16x16.png", 16),
            ("icon_16x16@2x.png", 32),
            ("icon_32x32.png", 32),
            ("icon_32x32@2x.png", 64),
            ("icon_128x128.png", 128),
            ("icon_128x128@2x.png", 256),
            ("icon_256x256.png", 256),
            ("icon_256x256@2x.png", 512),
            ("icon_512x512.png", 512),
            ("icon_512x512@2x.png", 1024),
        ]
        for name, sz in mac_sizes:
            res = master_im.resize((sz, sz), Image.Resampling.LANCZOS)
            res.save(os.path.join(iconset_dir, name))

        cmd = ["/usr/bin/iconutil", "-c", "icns", iconset_dir, "-o", out_icns_path]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# -----------------------------------------------------------------------------
# 5. Android Adaptive Vectors
# -----------------------------------------------------------------------------

def generate_android_vector_assets():
    """Generates modern Android adaptive XML vectors."""
    drawable_dir = os.path.join(ANDROID_RES_DIR, "drawable")
    os.makedirs(drawable_dir, exist_ok=True)

    # ic_launcher_background.xml
    bg_xml = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#070B19"
        android:pathData="M0,0h108v108h-108z" />
    <!-- Ambient Radial Sonic Depth -->
    <path
        android:fillColor="#16203C"
        android:pathData="M54,20 A34,34 0 1,0 54,88 A34,34 0 1,0 54,20 Z" />
</vector>
"""
    with open(os.path.join(drawable_dir, "ic_launcher_background.xml"), "w") as f:
        f.write(bg_xml)

    # ic_launcher_foreground.xml (The PlayIT Sonic P Mark)
    fg_xml = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <!-- P-Stem Vertical Pillar -->
    <path
        android:fillColor="#00F2FE"
        android:pathData="M31,30 h9 c4.4,0 8,3.6 8,8 v48 c0,4.4 -3.6,8 -8,8 h-9 c-4.4,0 -8,-3.6 -8,-8 v-48 c0,-4.4 3.6,-8 8,-8 Z" />

    <!-- P-Loop Acoustic Resonator -->
    <path
        android:fillColor="#00000000"
        android:strokeColor="#2563EB"
        android:strokeWidth="8"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M35,30 H58 C68,30 76,38 76,48 C76,58 68,66 58,66 H40" />

    <!-- Play Discovery Triangle Node -->
    <path
        android:fillColor="#00F2FE"
        android:pathData="M48,42 L59,48 L48,54 Z" />

    <!-- Acoustic Wave Radar Arcs -->
    <path
        android:fillColor="#00000000"
        android:strokeColor="#00F2FE"
        android:strokeWidth="3.6"
        android:strokeLineCap="round"
        android:pathData="M78,36 A18,18 0 0,1 78,60" />

    <path
        android:fillColor="#00000000"
        android:strokeColor="#7C3AED"
        android:strokeWidth="2.8"
        android:strokeLineCap="round"
        android:pathData="M86,30 A28,28 0 0,1 86,66" />

    <path
        android:fillColor="#00000000"
        android:strokeColor="#2563EB"
        android:strokeWidth="2.0"
        android:strokeLineCap="round"
        android:pathData="M94,24 A38,38 0 0,1 94,72" />
</vector>
"""
    with open(os.path.join(drawable_dir, "ic_launcher_foreground.xml"), "w") as f:
        f.write(fg_xml)

    # ic_launcher_monochrome.xml (Android 13+ Themed Icons)
    mono_xml = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M31,30 h9 c4.4,0 8,3.6 8,8 v48 c0,4.4 -3.6,8 -8,8 h-9 c-4.4,0 -8,-3.6 -8,-8 v-48 c0,-4.4 3.6,-8 8,-8 Z" />
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="8"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M35,30 H58 C68,30 76,38 76,48 C76,58 68,66 58,66 H40" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M48,42 L59,48 L48,54 Z" />
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="3.6"
        android:strokeLineCap="round"
        android:pathData="M78,36 A18,18 0 0,1 78,60" />
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2.8"
        android:strokeLineCap="round"
        android:pathData="M86,30 A28,28 0 0,1 86,66" />
</vector>
"""
    with open(os.path.join(drawable_dir, "ic_launcher_monochrome.xml"), "w") as f:
        f.write(mono_xml)


# -----------------------------------------------------------------------------
# 6. Main Orchestrator
# -----------------------------------------------------------------------------

def main():
    print("━" * 60)
    print("▶ Generating PlayIT Master Brand Identity Suite")
    print("━" * 60)

    # 1. Write Vector SVGs to brand/ and web/public/
    svg_defs = [
        # (filename, svg_string)
        (os.path.join(BRAND_DIR, "logo.svg"), build_horizontal_logo_svg("dark")),
        (os.path.join(BRAND_DIR, "logo-dark.svg"), build_horizontal_logo_svg("dark")),
        (os.path.join(BRAND_DIR, "logo-light.svg"), build_horizontal_logo_svg("light")),
        (os.path.join(BRAND_DIR, "logo-monochrome-black.svg"), build_horizontal_logo_svg("mono-black")),
        (os.path.join(BRAND_DIR, "logo-monochrome-white.svg"), build_horizontal_logo_svg("mono-white")),
        (os.path.join(BRAND_DIR, "logo-icon.svg"), build_icon_svg("dark")),
        (os.path.join(BRAND_DIR, "logo-icon-light.svg"), build_icon_svg("light")),
        (os.path.join(BRAND_DIR, "logo-symbol.svg"), build_symbol_only_svg("dark")),
        (os.path.join(BRAND_DIR, "logo-wordmark.svg"), build_wordmark_only_svg("dark")),
        (os.path.join(PUB_DIR, "icon.svg"), build_icon_svg("dark")),
        (os.path.join(ICONS_DIR, "favicon.svg"), build_icon_svg("dark")),
        (os.path.join(PUB_DIR, "favicon.svg"), build_icon_svg("dark")),
    ]

    for path, content in svg_defs:
        with open(path, "w") as f:
            f.write(content.strip())
        print(f"✔ Created SVG: {os.path.relpath(path, ROOT)}")

    # 2. Render Master 512x512 App Icon PNG
    master_512 = os.path.join(BRAND_DIR, "logo-icon-512.png")
    print("\n▶ Rendering Master 512x512 High-DPI Icon via Chrome Headless...")
    render_svg_to_png(build_icon_svg("dark"), master_512, 512, 512, transparent=False)
    print(f"✔ Master 512 PNG generated: {os.path.getsize(master_512)} bytes")

    # 3. Generate Multi-Size Icons for Web, Desktop, Android, iOS
    print("\n▶ Generating Multi-Resolution Platform Icons...")
    generate_multi_icons(master_512)
    print("✔ Generated Web, Desktop (ICO & ICNS), Android, and iOS Icon Sets")

    # 4. Generate Dedicated Social Sharing Card (1200 x 630 px)
    print("\n▶ Rendering 1200x630 Open Graph & Twitter Social Sharing Cards...")
    og_path_brand = os.path.join(BRAND_DIR, "og-image.png")
    og_path_pub = os.path.join(PUB_DIR, "og-image.png")
    twitter_path_brand = os.path.join(BRAND_DIR, "twitter-image.png")
    twitter_path_pub = os.path.join(PUB_DIR, "twitter-image.png")

    generate_social_preview_card(og_path_brand)
    shutil.copy2(og_path_brand, og_path_pub)
    shutil.copy2(og_path_brand, twitter_path_brand)
    shutil.copy2(og_path_brand, twitter_path_pub)
    print(f"✔ Open Graph card generated: {os.path.getsize(og_path_pub)} bytes (1200x630)")

    # 5. Generate Android Adaptive XML Vectors
    print("\n▶ Generating Android Adaptive XML Vectors...")
    generate_android_vector_assets()
    print("✔ Android Adaptive Drawables Generated")

    print("\n✅ All PlayIT Brand Identity Assets Successfully Created!")


if __name__ == "__main__":
    main()
