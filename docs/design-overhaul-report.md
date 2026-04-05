# Design Overhaul Report — 2026-04-02

## Summary

Complete UI/UX overhaul of the QBO Escalation Assistant. Replaced the default dark theme with an Apple + Tesla design fusion: warm dark surfaces, premium animations, frosted glass effects, and context-aware UI states. Approximately 5,200+ lines of CSS in a single override file.

## Architecture Decision: Single Override File

### Problem
The codebase had 25+ CSS files with competing specificity. Theme files (atmospherics.css) used high-specificity attribute selectors like `[data-theme="obsidian-ember"]` that overrode everything. Multiple failed attempts to edit individual CSS files resulted in inconsistent styling — one area dark, another light, text unreadable.

### Solution
Created `client/src/overhaul.css`, loaded as the LAST CSS import in `client/src/main.jsx`. Every declaration uses `!important` to guarantee it wins the cascade, regardless of what the base CSS files specify.

### Why This Works
- No need to audit which of 25 files "wins" for any given selector
- No cascade conflicts between workers editing different files
- Single source of truth for all visual styles
- Base CSS files are effectively frozen — they still load (preventing broken references) but their visual output is overridden

## Color System — Apple Warm Dark

Replaced cool blue-gray tones (#0F1218, #161A22, #1a1a2e) with Apple's warm gray scale. The previous palette had colors within 3-5% lightness of each other — visually indistinguishable.

### Surface Hierarchy
| Level | Hex | Lightness | Usage |
|-------|-----|-----------|-------|
| Base | #1c1c1e | 11% | Page background, app shell |
| Surface | #2c2c2e | 18% | Cards, sidebar, secondary areas |
| Raised | #3a3a3c | 24% | Inputs, elevated cards |
| Elevated | #48484a | 29% | Popovers, active states |
| Floating | #545456 | 34% | Tooltips, dropdowns |

Each step is 5-6% lightness apart — clearly distinguishable to the human eye.

### Text
| Role | Hex | Usage |
|------|-----|-------|
| Primary | #f5f5f7 | Body text, headings |
| Secondary | #a1a1a6 | Labels, metadata |
| Tertiary | #636366 | Timestamps, placeholders |

### Accent Colors
| Color | Hex | Usage |
|-------|-----|-------|
| Blue | #0a84ff | Primary interactive, links |
| Purple | #5e5ce6 | Workspace mode, AI indicators |
| Violet | #bf5af2 | Highlights, special states |

### Semantic Colors
| Role | Hex | Usage |
|------|-----|-------|
| Success | #30d158 | Online, completed, co-pilot mode |
| Warning | #f0b232 | Caution, pending |
| Error | #ff453a | Failed, destructive actions |

### Borders
- Default: `rgba(84, 84, 88, 0.35)`
- Subtle: `rgba(255, 255, 255, 0.06)` to `rgba(255, 255, 255, 0.12)`

## Animation System

### Easing Curves
| Name | Curve | Usage |
|------|-------|-------|
| Apple Standard | `cubic-bezier(0.25, 0.1, 0.25, 1)` | General transitions |
| Dynamic Island | `cubic-bezier(0.32, 0.72, 0, 1)` | Morphing, shape changes |
| Spring Bounce | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Interactive feedback |

### Interaction Patterns
- Button press: `scale(0.92-0.96)` on `:active`, 80ms transition
- Card hover: `translateY(-1px)` + shadow elevation change
- Entrance animations: fade + translateY + slight scale, 300-400ms
- All animations respect `prefers-reduced-motion`

## Feature List

### Core Restyling
1. Apple warm dark palette across all surfaces
2. Tesla gradient accents on interactive elements
3. Premium surface treatment (subtle gradients, glow borders)
4. Consistent typography (Inter/system, proper weight scale)
5. Redesigned scrollbars (thin, themed)
6. Focus rings and accessibility states

### Premium Effects (Upgrades 1-6)
7. **Aurora ambient background** — subtle animated gradient behind the main content area
8. **Liquid Glass compose morph** — compose box with glass refraction effect
9. **Neon Pulse indicators** — header sweep animation, send button ring, shimmer text
10. **Hologram 3D card perspective** — triage cards tilt with 3D transform on hover
11. **Constellation rotating borders** — animated gradient borders on key containers
12. **Resonance click ripples** — material-style ripple effect on interactive elements

### Context-Aware UI
13. **Streaming glow** — active AI responses get a subtle pulsing glow border
14. **Context-aware compose** — compose area shifts to purple for Workspace, green for Co-pilot
15. **Adaptive Glass Cockpit** — UI dims non-essential elements during streaming
16. **Tesla Autopilot Mode** — full UI shift during active AI response streaming

### Component Redesigns
17. **Dynamic Island health banner** — morphing pill shape instead of full-width bar
18. **Tesla Command Console compose** — dark glass compose area with premium treatment
19. **Sticky action buttons** — frosted glass action bar always visible
20. **Compact chat bubbles** — inline field labels, reduced padding
21. **Parallax depth scroll** — subtle depth effect on message scrolling

### Environmental Effects
22. **Cockpit HUD** — corner brackets, scan line, grid overlay
23. **Neural Stream** — data flow visualization during AI streaming
24. **16 micro-details** — heartbeat status dot, gear spin on settings, whisper timestamps, etc.
25. **Future polish layer** — holographic text, film grain, depth-of-field, hue drift

### Full Page Coverage
26. Settings page — full dark theme with Apple-style controls
27. Dashboard — themed cards, charts, metrics
28. Investigations page — consistent dark treatment
29. LED controls — themed toggle switches
30. Responsive breakpoints for all screen sizes
31. Print stylesheet
32. `prefers-reduced-motion` respect throughout

## Known Issues

1. **Cascade dependency:** If `overhaul.css` fails to load, the UI falls back to the inconsistent base styles. The import order in main.jsx is critical.
2. **File size:** At 5,200+ lines, overhaul.css is large. Future work could split into sections imported in order, but the single-file approach is simpler to maintain.
3. **`!important` everywhere:** This is intentional — it's the only way to reliably override 25+ competing CSS files. The tradeoff is that overhaul.css rules can only be overridden by other `!important` rules with equal or higher specificity.
4. **`:has()` browser support:** Used extensively for state detection (e.g., `body:has(.streaming-cursor)`). Supported in all modern browsers but not IE11 or older Safari.
5. **`@property` for gradient animation:** Used for rotating gradient borders. Requires Chrome 85+, Firefox 128+, Safari 15.4+.
6. **`backdrop-filter` performance:** Frosted glass effects use `backdrop-filter: blur()` which can impact performance on lower-end hardware. The `prefers-reduced-motion` media query disables animations but not blur.

## Future Recommendations

1. **Performance audit:** Profile the CSS on a lower-end device. The combination of backdrop-filter, animations, and pseudo-elements could cause frame drops.
2. **Section splitting:** If overhaul.css grows past 8,000 lines, consider splitting into numbered section files (01-base.css, 02-components.css, etc.) loaded in sequence.
3. **CSS custom properties:** The override file uses some hardcoded values. Moving to CSS custom properties in :root would allow easier theme switching if needed.
4. **Animation toggle:** Add a UI toggle (not just prefers-reduced-motion) to let users disable premium effects while keeping the base theme.
5. **Component library extraction:** The patterns in overhaul.css could eventually inform a proper component library if the app grows.
