# Design System Reference

## Professional Color Palettes & Brand-Inspired Themes

*A comprehensive reference for building professional application interfaces. Documents color theory fundamentals, researched brand palettes, accessibility requirements, and implementation patterns.*

---

## Table of Contents

1. [Design Principles & Color Theory](#1-design-principles--color-theory)
2. [Brand-Inspired Palettes](#2-brand-inspired-palettes)
3. [Accessibility Guidelines](#3-accessibility-guidelines)
4. [Implementation Notes](#4-implementation-notes)

---

## 1. Design Principles & Color Theory

### Color Theory Fundamentals for Professional Applications

#### The 60-30-10 Rule

Professional interfaces follow the interior design principle of color distribution:

- **60% -- Dominant (backgrounds, surfaces):** Neutral tones that recede visually. These are the canvas your users spend hours looking at. They must never fatigue the eye.
- **30% -- Secondary (cards, sidebars, panels):** Slightly differentiated surfaces that create hierarchy. These define spatial zones.
- **10% -- Accent (CTAs, links, active states):** The color users associate with your brand and with "action." It draws the eye precisely where you want it.

#### Hue Psychology in Professional Tools

| Hue Family | Psychological Effect | Best For |
|------------|---------------------|----------|
| **Blue (210-240)** | Trust, stability, competence | Finance, enterprise, communication |
| **Teal/Cyan (170-195)** | Calm authority, modernity | Healthcare, support tools, SaaS |
| **Purple (260-290)** | Creativity, premium feel, wisdom | Design tools, collaboration, dev tools |
| **Green (120-160)** | Growth, success, trust | Support platforms, finance, productivity |
| **Orange/Coral (15-30)** | Energy, warmth, approachability | Marketing, CRM, creative tools |
| **Red (0-10, 350-360)** | Urgency, passion, importance | Productivity, alerts, time-sensitive work |
| **Neutral (0 sat)** | Sophistication, focus on content | Developer tools, writing apps, minimal UIs |

#### Warm vs. Cool Neutrals

Most professional applications choose a neutral temperature for their surface family:

- **Warm neutrals** (sand, stone, cream undertones): Reduce eye fatigue over long sessions. Feel approachable and human. Used by Notion, Linear, Apple.
- **Cool neutrals** (blue-gray, slate undertones): Feel technical and precise. Common in developer tools and enterprise software. Used by GitHub, VS Code, Stripe.
- **True neutrals** (pure gray, no undertone): Feel stark and modern. Best paired with a strong accent color. Used by Vercel, monochrome design systems.

#### Contrast and Readability

For tools where users spend 4-8+ hours per day:

- Body text should be 7:1+ contrast ratio against its background (exceeds WCAG AA)
- Secondary text should be at minimum 4.5:1 (WCAG AA for normal text)
- Large text (18px+ or 14px+ bold) requires only 3:1 (WCAG AA for large text)
- Interactive elements need 3:1 against adjacent colors
- Never rely on color alone to convey meaning -- pair with text labels, icons, or patterns

#### Dark Mode Principles

Dark mode is not "invert everything." It requires its own design:

- **Never use pure black (#000000)** -- it causes halation (text glowing) on OLED screens and feels harsh. Use #0d1117 to #1a1a2e range.
- **Reduce surface contrast** -- in light mode, cards are brighter than background. In dark mode, cards are slightly lighter than background, but the difference should be subtle (2-5% lightness).
- **Desaturate accent colors** -- bright saturated colors on dark backgrounds cause eye strain. Shift accent hues lighter and reduce saturation by 10-15%.
- **Increase text weight perception** -- light text on dark backgrounds appears thinner. Consider bumping font-weight or using slightly larger sizes.
- **Shadows become glows or borders** -- box-shadows are invisible on dark backgrounds. Use subtle light borders (white at 5-10% opacity) or ambient glow effects.

---

## 2. Brand-Inspired Palettes

Each palette below is documented with researched color values and the design reasoning behind the brand's choices.

---

### 2.1 Slack -- Aubergine Workspace

**Design Philosophy:** Slack uses a distinctive aubergine (deep purple-brown) sidebar paired with a clean white content area. The aubergine creates a strong spatial anchor -- the sidebar feels like a permanent fixture while content flows in the main area. This high-contrast split allows users to orient instantly.

**Why it works:** The dark sidebar reduces peripheral distraction while the user focuses on messages. The aubergine hue feels premium without being corporate. Green accents signal activity and presence.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary** | `#4A154B` | Aubergine -- Slack's signature brand color |
| **Secondary** | `#36C5F0` | Cyan blue -- secondary brand element |
| **Accent** | `#2EB67D` | Green -- online status, active states, CTAs |
| **Accent Alt** | `#ECB22E` | Yellow -- notifications, stars, highlights |
| **Accent Warm** | `#E01E5A` | Magenta/pink -- mentions, reactions, alerts |
| **Bg Dark** | `#1A1D21` | Dark mode base background |
| **Bg Light** | `#FFFFFF` | Light mode content area |
| **Bg Sidebar** | `#4A154B` | Sidebar background (brand aubergine) |
| **Bg Sidebar Hover** | `#5C2D5E` | Sidebar item hover state |
| **Surface Card** | `#FFFFFF` | Card/message surface (light) |
| **Surface Card Dark** | `#222529` | Card/message surface (dark) |
| **Text Primary** | `#1D1C1D` | Primary text (light mode) |
| **Text Primary Dark** | `#D1D2D3` | Primary text (dark mode) |
| **Text Secondary** | `#616061` | Secondary/muted text (light) |
| **Text Secondary Dark** | `#9B9A9B` | Secondary/muted text (dark) |
| **Text Muted** | `#868686` | Timestamps, hints |
| **Border** | `#DDDDDD` | Light mode borders |
| **Border Dark** | `#393B3D` | Dark mode borders |
| **Success** | `#2EB67D` | Positive actions, online |
| **Warning** | `#ECB22E` | Caution, pending |
| **Error** | `#E01E5A` | Errors, disconnected |
| **Info** | `#36C5F0` | Informational |

**UX Reasoning:** Slack's palette is optimized for a communication tool where users need to instantly distinguish channels, DMs, threads, and status. The multi-accent approach (green, yellow, magenta, cyan) creates a rich but organized visual hierarchy. Each accent has a single semantic meaning, preventing confusion.

---

### 2.2 Linear -- Dark Minimal Precision

**Design Philosophy:** Linear embraces a dark-first, minimal interface with surgical use of accent color. The dark theme reduces visual noise so that the content (issues, projects, cycles) is the star. Accent colors are used almost exclusively for interactive elements and status indicators.

**Why it works:** Developer tools benefit from dark interfaces that reduce eye strain during long coding/planning sessions. Linear's approach of near-monochromatic surfaces with precisely placed accent color creates a sense of professional calm and focus.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary** | `#5E6AD2` | Indigo/periwinkle -- Linear's brand accent |
| **Secondary** | `#8B5CF6` | Violet -- secondary accent for emphasis |
| **Accent** | `#5E6AD2` | Indigo -- interactive elements, links, focus |
| **Accent Hover** | `#7C85E3` | Lighter indigo for hover states |
| **Bg Dark** | `#0A0A0B` | Near-black base (dark mode default) |
| **Bg Light** | `#FBFBFB` | Light mode base |
| **Bg Sidebar Dark** | `#101012` | Sidebar (dark) |
| **Bg Sidebar Light** | `#F4F4F4` | Sidebar (light) |
| **Surface Card Dark** | `#15151A` | Card/panel surface (dark) |
| **Surface Card Light** | `#FFFFFF` | Card/panel surface (light) |
| **Surface Elevated Dark** | `#1B1B22` | Elevated surfaces, dropdowns (dark) |
| **Text Primary Dark** | `#EEEEEE` | Primary text (dark) |
| **Text Primary Light** | `#171717` | Primary text (light) |
| **Text Secondary Dark** | `#8A8A8E` | Secondary text (dark) |
| **Text Secondary Light** | `#6E6E73` | Secondary text (light) |
| **Text Muted Dark** | `#505054` | Muted/tertiary text (dark) |
| **Border Dark** | `#1F1F28` | Borders (dark) |
| **Border Light** | `#E5E5E5` | Borders (light) |
| **Success** | `#4ADE80` | Completed, done |
| **Warning** | `#F59E0B` | In review, blocked |
| **Error** | `#EF4444` | Cancelled, bug |
| **Info** | `#5E6AD2` | Informational (brand indigo) |

**UX Reasoning:** Linear's near-black backgrounds let issue status colors pop with maximum clarity. The single accent color (indigo) keeps the interface feeling unified -- everything actionable glows with the same hue. This reduces cognitive load in a tool where users manage hundreds of issues.

---

### 2.3 Notion -- Clean Warm Neutrals

**Design Philosophy:** Notion's interface feels like a well-designed paper notebook brought to life. It uses warm off-white backgrounds, gentle warm gray text, and extremely restrained color. The result is a calm canvas that adapts to any type of content -- notes, databases, kanban boards, wikis.

**Why it works:** As a knowledge tool, Notion must never compete with the user's content. The near-absence of brand color in the interface means user content (colored databases, cover images, icons) becomes the visual identity of each workspace.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary** | `#000000` | Black wordmark -- Notion's brand is absence of color |
| **Secondary** | `#E16259` | Warm red -- Notion's secondary brand mark |
| **Accent** | `#2EAADC` | Blue -- links, mentions, interactive elements |
| **Bg Light** | `#FFFFFF` | Page background (light) |
| **Bg Light Alt** | `#F7F6F3` | Sidebar, secondary areas (warm off-white) |
| **Bg Dark** | `#191919` | Page background (dark) |
| **Bg Dark Alt** | `#202020` | Sidebar background (dark) |
| **Surface Card Light** | `#FFFFFF` | Cards, callouts (light) |
| **Surface Card Dark** | `#2F2F2F` | Cards, callouts (dark) |
| **Surface Hover Light** | `#EFEFEF` | Hover state backgrounds (light) |
| **Surface Hover Dark** | `#373737` | Hover state backgrounds (dark) |
| **Text Primary Light** | `#37352F` | Primary text (warm dark brown-black) |
| **Text Primary Dark** | `#FFFFFFCF` | Primary text (dark, slightly transparent) |
| **Text Secondary Light** | `#787774` | Secondary text (warm gray) |
| **Text Secondary Dark** | `#9B9A97` | Secondary text (dark mode) |
| **Text Muted Light** | `#B4B4B0` | Placeholders, ghost text |
| **Border Light** | `#E9E9E7` | Borders, dividers (light) |
| **Border Dark** | `#373737` | Borders, dividers (dark) |
| **Success** | `#4DAB9A` | Teal-green -- status positive |
| **Warning** | `#CB912F` | Warm amber -- status caution |
| **Error** | `#E03E3E` | Red -- status negative |
| **Info** | `#2EAADC` | Blue -- informational |

**Additional Notion Colors (Database/Tag Palette):**

| Color | Light Bg | Light Text | Dark Bg | Dark Text |
|-------|----------|------------|---------|-----------|
| Gray | `#E3E2E0` | `#9B9A97` | `#373737` | `#9B9A97` |
| Brown | `#EEE0DA` | `#64473A` | `#434040` | `#937264` |
| Orange | `#FADEC9` | `#D9730D` | `#594A3A` | `#FFA344` |
| Yellow | `#FDECC8` | `#DFAB01` | `#59563B` | `#FFD93D` |
| Green | `#DBEDDB` | `#0F7B6C` | `#354C4B` | `#4DAB9A` |
| Blue | `#D3E5EF` | `#0B6E99` | `#364954` | `#529CCA` |
| Purple | `#E8DEEE` | `#6940A5` | `#443F57` | `#9A6DD7` |
| Pink | `#F5E0E9` | `#AD1A72` | `#533B4C` | `#E255A1` |
| Red | `#FFE2DD` | `#E03E3E` | `#594141` | `#FF7369` |

**UX Reasoning:** Notion's restraint is its superpower. By providing a neutral canvas, it lets users project their own visual identity onto their workspace through covers, icons, and colored labels. The warm neutral (#37352F text instead of pure black) is a deliberate choice that makes long-form reading more comfortable.

---

### 2.4 Stripe -- Blue-Purple Gradient Precision

**Design Philosophy:** Stripe's design communicates trust and technical sophistication through a carefully crafted blue-to-purple gradient palette. The gradient conveys forward motion and modernity while the blue base signals financial trustworthiness. The documentation and dashboard use clean whites with precise accent usage.

**Why it works:** Financial tools must radiate reliability. Stripe's blue-purple palette hits the trust of blue with the innovation of purple, positioning them as both dependable and cutting-edge. The gradient creates visual energy without using loud colors.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary** | `#635BFF` | Blurple -- Stripe's core brand color (2023+) |
| **Primary Legacy** | `#6772E5` | Classic Stripe indigo (pre-2023) |
| **Secondary** | `#00D4FF` | Cyan -- gradient endpoint, highlights |
| **Accent** | `#635BFF` | Primary interactive color |
| **Accent Hover** | `#7A73FF` | Lighter accent for hover |
| **Gradient** | `linear-gradient(135deg, #635BFF, #00D4FF)` | Signature brand gradient |
| **Bg Light** | `#FFFFFF` | Dashboard/content background |
| **Bg Light Alt** | `#F6F9FC` | Cool off-white page background |
| **Bg Dark** | `#0A2540` | Dark navy -- marketing pages |
| **Bg Sidebar** | `#F6F9FC` | Sidebar background |
| **Surface Card** | `#FFFFFF` | Card surfaces |
| **Surface Code** | `#F6F9FC` | Code block backgrounds |
| **Text Primary** | `#1A1F36` | Primary text (dark navy) |
| **Text Secondary** | `#697386` | Secondary text (cool gray) |
| **Text Muted** | `#8898AA` | Tertiary text |
| **Text On Dark** | `#FFFFFF` | Text on dark backgrounds |
| **Text On Dark Secondary** | `#ADBDCC` | Secondary text on dark |
| **Border** | `#E6EBF1` | Light borders |
| **Border Focus** | `#635BFF` | Focus state border |
| **Success** | `#3ECF8E` | Payment successful |
| **Warning** | `#F5BE4B` | Pending, needs review |
| **Error** | `#F25252` | Failed, declined |
| **Info** | `#635BFF` | Informational (brand) |

**UX Reasoning:** Stripe handles money, so every design choice optimizes for trust and clarity. The cool gray text hierarchy (#1A1F36 > #697386 > #8898AA) creates three clearly distinguishable reading levels. The dark navy marketing background (#0A2540) is a masterclass in premium dark surfaces -- deep enough to feel luxurious, blue enough to feel trustworthy.

---

### 2.5 Vercel -- Pure Black/White Contrast

**Design Philosophy:** Vercel's design system (Geist) is a study in radical simplicity. Pure black and white with almost zero decoration. The interface communicates "developer tool" through its stark confidence. Color appears only for semantic meaning (errors, warnings, success) and is never decorative.

**Why it works:** For a deployment platform, clarity is everything. Developers need to know instantly: is my deployment working or not? Vercel strips away all visual noise so that status information is immediately apparent.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary** | `#000000` | Pure black -- Vercel's brand |
| **Secondary** | `#FFFFFF` | Pure white -- the other half of the identity |
| **Accent** | `#0070F3` | Blue -- the only accent, used for links/CTAs |
| **Accent Hover** | `#0060DF` | Darker blue for hover |
| **Accent Light** | `#EBF5FF` | Blue tint background |
| **Bg Light** | `#FFFFFF` | Light mode background |
| **Bg Dark** | `#000000` | Dark mode background (truly black) |
| **Bg Dark Elevated** | `#111111` | Elevated surface (dark) |
| **Surface Card Light** | `#FFFFFF` | Cards (light) |
| **Surface Card Dark** | `#111111` | Cards (dark) |
| **Surface Hover Light** | `#FAFAFA` | Hover (light) |
| **Surface Hover Dark** | `#1A1A1A` | Hover (dark) |
| **Text Primary Light** | `#000000` | Primary text (light) |
| **Text Primary Dark** | `#EDEDED` | Primary text (dark) |
| **Text Secondary Light** | `#666666` | Secondary text (light) |
| **Text Secondary Dark** | `#A1A1A1` | Secondary text (dark) |
| **Text Muted Light** | `#999999` | Muted text (light) |
| **Text Muted Dark** | `#666666` | Muted text (dark) |
| **Border Light** | `#EAEAEA` | Borders (light) |
| **Border Dark** | `#333333` | Borders (dark) |
| **Success** | `#0070F3` | Vercel uses blue for success (deployment ready) |
| **Success Alt** | `#50E3C2` | Teal-green for positive indicators |
| **Warning** | `#F5A623` | Amber warning |
| **Error** | `#EE0000` | Red error -- high-visibility pure red |
| **Info** | `#0070F3` | Blue informational |

**UX Reasoning:** Vercel (and its Geist design system) proves that a professional tool does not need a complex color palette. The binary black/white system creates maximum contrast, which is ideal for scanning deployment statuses and logs. The single accent blue (#0070F3) is used so sparingly that when it appears, it is unmissable.

---

### 2.6 GitHub -- Multi-Theme Dark & Light

**Design Philosophy:** GitHub's Primer design system offers multiple themes, each carefully tuned. The dark themes use blue-tinted surfaces that feel technical without being cold. The light theme uses cool grays. GitHub's color system is scale-based, providing 10 shades per hue for maximum flexibility.

**Why it works:** As the world's largest code platform, GitHub must accommodate users who spend entire workdays in the interface. Multiple theme options respect user preference. The blue-tinted dark backgrounds connect visually to the concept of "code" and "terminal."

#### Dark Default

| Token | Hex | Description |
|-------|-----|-------------|
| **Bg Canvas** | `#0D1117` | Page background |
| **Bg Surface** | `#161B22` | Card/panel surface |
| **Bg Elevated** | `#1C2128` | Elevated elements, dropdowns |
| **Bg Overlay** | `#30363D` | Overlay backgrounds |
| **Text Primary** | `#E6EDF3` | Primary text |
| **Text Secondary** | `#8B949E` | Secondary text |
| **Text Muted** | `#484F58` | Muted/disabled text |
| **Border Default** | `#30363D` | Default borders |
| **Border Muted** | `#21262D` | Subtle borders |
| **Accent** | `#58A6FF` | Blue -- links, interactive |
| **Accent Emphasis** | `#1F6FEB` | Stronger accent (buttons) |

#### Dark Dimmed

| Token | Hex | Description |
|-------|-----|-------------|
| **Bg Canvas** | `#22272E` | Page background (warmer, lighter) |
| **Bg Surface** | `#2D333B` | Card/panel surface |
| **Bg Elevated** | `#373E47` | Elevated elements |
| **Text Primary** | `#ADBAC7` | Primary text |
| **Text Secondary** | `#768390` | Secondary text |
| **Border Default** | `#444C56` | Default borders |
| **Accent** | `#539BF5` | Blue accent |

#### Light Default

| Token | Hex | Description |
|-------|-----|-------------|
| **Bg Canvas** | `#FFFFFF` | Page background |
| **Bg Surface** | `#F6F8FA` | Card/panel surface |
| **Bg Elevated** | `#FFFFFF` | Elevated elements |
| **Text Primary** | `#1F2328` | Primary text |
| **Text Secondary** | `#656D76` | Secondary text |
| **Text Muted** | `#8C959F` | Muted text |
| **Border Default** | `#D0D7DE` | Default borders |
| **Border Muted** | `#D8DEE4` | Subtle borders |
| **Accent** | `#0969DA` | Blue accent |
| **Accent Emphasis** | `#0550AE` | Stronger accent |

#### Semantic Colors (Shared Across Themes)

| Semantic | Dark Default | Dark Dimmed | Light |
|----------|-------------|-------------|-------|
| **Success** | `#3FB950` | `#57AB5A` | `#1A7F37` |
| **Warning** | `#D29922` | `#C69026` | `#9A6700` |
| **Error** | `#F85149` | `#E5534B` | `#CF222E` |
| **Info** | `#58A6FF` | `#539BF5` | `#0969DA` |

**UX Reasoning:** GitHub's multi-theme approach acknowledges that developers have strong preferences about their working environment. The dark default (#0D1117) has a cold blue undertone that connects to terminal/code aesthetics. Dark dimmed (#22272E) adds warmth for users who find the default too stark. The scale-based color system (10 shades per hue) allows Primer to handle any component state without ad-hoc color creation.

---

### 2.7 Discord -- Blurple Dark Social

**Design Philosophy:** Discord's "blurple" (blue-purple) is one of the most recognizable brand colors in software. The dark interface is optimized for extended social sessions -- gaming, community, and voice calls. The purple accent feels playful and youthful while the dark background reduces eye strain during late-night use.

**Why it works:** Discord's users often have the app open for 8-16 hours. The dark-by-default interface with carefully calibrated gray surfaces prevents fatigue. Blurple is used sparingly for CTAs and active states, making interactive elements pop against the neutral dark backdrop.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary (Blurple)** | `#5865F2` | Discord's signature blurple |
| **Primary Hover** | `#4752C4` | Blurple hover/pressed |
| **Secondary** | `#EB459E` | Fuchsia -- boosts, Nitro, premium |
| **Accent** | `#5865F2` | Interactive elements |
| **Accent Green** | `#57F287` | Online status, success |
| **Accent Yellow** | `#FEE75C` | Idle status, warnings |
| **Accent Red** | `#ED4245` | DND status, errors, leave |
| **Bg Darkest** | `#111214` | Behind-everything dark |
| **Bg Dark** | `#1E1F22` | Primary dark background (2023+) |
| **Bg Dark Secondary** | `#2B2D31` | Secondary/sidebar background |
| **Bg Dark Tertiary** | `#313338` | Chat area, input background |
| **Bg Dark Elevated** | `#383A40` | Elevated surfaces, popouts |
| **Bg Light** | `#FFFFFF` | Light mode background |
| **Bg Light Secondary** | `#F2F3F5` | Light mode secondary |
| **Surface Card Dark** | `#2B2D31` | Embeds, cards (dark) |
| **Text Primary Dark** | `#F2F3F5` | Primary text (dark) |
| **Text Primary Light** | `#313338` | Primary text (light) |
| **Text Secondary Dark** | `#B5BAC1` | Secondary text (dark) |
| **Text Muted Dark** | `#949BA4` | Muted text (dark) |
| **Text Muted Darker** | `#6D6F78` | Even more muted |
| **Border Dark** | `#3F4147` | Borders (dark) |
| **Border Light** | `#E1E2E4` | Borders (light) |
| **Success** | `#23A559` | Positive actions |
| **Warning** | `#F0B232` | Caution |
| **Error** | `#DA373C` | Destructive actions |
| **Info** | `#5865F2` | Informational (blurple) |

**UX Reasoning:** Discord's stepped dark background system (five distinct dark surface levels) creates clear spatial hierarchy without using borders everywhere. Each depth level has enough contrast to be distinguishable but not enough to feel like separate panels. The blurple accent is warm enough to not feel cold-corporate, fitting Discord's community-oriented identity.

---

### 2.8 Spotify -- Green Energy on Dark

**Design Philosophy:** Spotify's design is built around the idea that music is the hero. The nearly-black background creates a theatrical "lights down" effect where album art becomes the visual centerpiece. The signature green is used almost exclusively for the play button and primary CTAs -- everything else is grayscale.

**Why it works:** Entertainment platforms need to make content (album art, playlists) visually dominant. Spotify's restraint with its green accent means that when you see green, you know it means "play" or "primary action." This single-association pattern creates instant recognition.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary (Green)** | `#1DB954` | Spotify green -- the iconic play button |
| **Primary Hover** | `#1ED760` | Brighter green on hover |
| **Secondary** | `#FFFFFF` | White -- secondary emphasis |
| **Accent** | `#1DB954` | Primary interactive color |
| **Bg Dark** | `#121212` | App background (near-black) |
| **Bg Dark Elevated** | `#181818` | Slightly elevated surfaces |
| **Bg Dark Card** | `#282828` | Cards, playlist tiles |
| **Bg Dark Highlight** | `#1A1A1A` | Highlighted/selected rows |
| **Bg Dark Input** | `#3E3E3E` | Search bar, input fields |
| **Bg Light** | `#FFFFFF` | Light mode (marketing/web) |
| **Surface Card** | `#181818` | Card surface |
| **Surface Card Hover** | `#282828` | Card hover state |
| **Surface Player** | `#181818` | Now-playing bar |
| **Text Primary** | `#FFFFFF` | Primary text |
| **Text Secondary** | `#B3B3B3` | Secondary text, artist names |
| **Text Muted** | `#6A6A6A` | Muted text, inactive tabs |
| **Text Subdued** | `#A7A7A7` | Subtitles, descriptions |
| **Border** | `#282828` | Subtle borders |
| **Success** | `#1DB954` | Green (same as brand) |
| **Warning** | `#FFA42B` | Orange warning |
| **Error** | `#F15E6C` | Soft red error |
| **Info** | `#509BF5` | Blue informational |

**UX Reasoning:** Spotify's dark interface solves a specific problem: album artwork varies wildly in color. A dark, near-black background is the only neutral that works with every possible album cover. The #121212 background (not pure black) avoids the OLED halation problem while still being dark enough to make content glow.

---

### 2.9 Figma -- Warm Coral Creative Energy

**Design Philosophy:** Figma uses warm orange and coral tones that evoke creativity and collaboration. The interface itself is mostly neutral (grays, whites), but brand moments use a distinctive warm gradient. The editor canvas is intentionally neutral so designs are viewed without chromatic interference.

**Why it works:** Design tools must be invisible -- the user's creation is what matters. Figma's neutral canvas with warm brand accents says "this is a creative, human tool" without injecting brand color into the work area.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary** | `#F24E1E` | Figma orange-red (main brand) |
| **Secondary** | `#FF7262` | Coral -- secondary brand color |
| **Tertiary** | `#A259FF` | Purple -- Figma component color |
| **Accent Green** | `#0ACF83` | Green -- frame/group indicator |
| **Accent Blue** | `#1ABCFE` | Blue -- text/selection indicator |
| **Bg Light** | `#FFFFFF` | Editor panel background |
| **Bg Light Alt** | `#F5F5F5` | Secondary panels |
| **Bg Canvas** | `#E5E5E5` | Design canvas background |
| **Bg Dark** | `#2C2C2C` | Dark UI mode background |
| **Bg Dark Panel** | `#383838` | Dark mode panel |
| **Surface Card Light** | `#FFFFFF` | Cards, properties panels |
| **Surface Card Dark** | `#2C2C2C` | Cards (dark mode) |
| **Surface Hover** | `#EBEBEB` | Hover state (light) |
| **Text Primary Light** | `#333333` | Primary text (light) |
| **Text Primary Dark** | `#FFFFFF` | Primary text (dark) |
| **Text Secondary Light** | `#8C8C8C` | Secondary text (light) |
| **Text Secondary Dark** | `#B3B3B3` | Secondary text (dark) |
| **Text Muted** | `#AAAAAA` | Placeholder text |
| **Border Light** | `#E6E6E6` | Panel borders (light) |
| **Border Dark** | `#444444` | Panel borders (dark) |
| **Success** | `#0ACF83` | Success states (brand green) |
| **Warning** | `#FFCD29` | Warning/caution |
| **Error** | `#F24E1E` | Error (brand orange-red) |
| **Info** | `#1ABCFE` | Informational (brand blue) |

**UX Reasoning:** Figma's multi-color brand system (orange, coral, purple, green, blue) maps to product concepts: orange is the brand itself, purple represents components, green represents frames, and blue represents text layers. This semantic color mapping extends from the logo into the product, creating consistency between brand identity and product experience.

---

### 2.10 Todoist -- Red Productivity Focus

**Design Philosophy:** Todoist uses red as its primary color -- an unusual choice for a productivity tool. Red signals urgency and importance, which is precisely the mindset Todoist wants to evoke: your tasks matter, act now. The interface is otherwise clean and minimal, letting the task list be the focus.

**Why it works:** Red is the color of urgency and priority. In a todo app, this is psychologically strategic -- the red accent on the add-task button and priority markers creates a subtle sense of productive urgency. The clean white canvas ensures tasks are scannable.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary (Red)** | `#E44332` | Todoist red -- CTAs, brand |
| **Primary Hover** | `#C53727` | Darker red on hover |
| **Secondary** | `#FF9933` | Orange -- priority 2 |
| **Accent** | `#E44332` | Primary interactive color |
| **Bg Light** | `#FFFFFF` | App background (light) |
| **Bg Light Alt** | `#FAFAFA` | Secondary background |
| **Bg Sidebar Light** | `#FCFAF8` | Sidebar background |
| **Bg Dark** | `#1F1F1F` | Dark mode background |
| **Bg Dark Sidebar** | `#282828` | Sidebar (dark) |
| **Surface Card Light** | `#FFFFFF` | Task cards (light) |
| **Surface Card Dark** | `#282828` | Task cards (dark) |
| **Surface Hover** | `#F5F5F5` | Hover state (light) |
| **Text Primary Light** | `#202020` | Primary text (light) |
| **Text Primary Dark** | `#FFFFFFDE` | Primary text (dark, 87% opacity) |
| **Text Secondary Light** | `#808080` | Secondary text (light) |
| **Text Secondary Dark** | `#FFFFFF8A` | Secondary text (dark, 54% opacity) |
| **Text Muted** | `#AAAAAA` | Placeholder, hint text |
| **Border Light** | `#F0F0F0` | Borders, dividers (light) |
| **Border Dark** | `#3D3D3D` | Borders (dark) |
| **Priority 1** | `#E44332` | Highest priority (red) |
| **Priority 2** | `#FF9933` | High priority (orange) |
| **Priority 3** | `#4073FF` | Medium priority (blue) |
| **Priority 4** | `#808080` | Low priority (gray) |
| **Success** | `#058527` | Task completed |
| **Warning** | `#FF9933` | Warning/upcoming due |
| **Error** | `#E44332` | Error/overdue |
| **Info** | `#4073FF` | Informational |

**UX Reasoning:** Todoist's priority color system (red > orange > blue > gray) maps directly to urgency. Users don't need to read the priority level -- the color communicates it instantly. Using brand red as Priority 1 reinforces that Todoist is about getting important things done. The sparse interface ensures that colored priority markers are the dominant visual signal.

---

### 2.11 Asana -- Coral/Salmon Warmth

**Design Philosophy:** Asana uses a warm coral/salmon palette that feels distinctly human and approachable for a project management tool. Where most PM tools feel corporate (blue, gray), Asana's warmth communicates collaboration and team spirit. The gradient from coral to warm pink creates energy without aggression.

**Why it works:** Project management is inherently about people working together. Asana's warm palette reduces the clinical feeling common in PM tools, making it feel more like a team space and less like an enterprise system.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary (Coral)** | `#F06A6A` | Asana's signature coral |
| **Primary Dark** | `#E8615A` | Deeper coral for hover/active |
| **Secondary** | `#F1BD6C` | Warm gold -- secondary accent |
| **Accent Gradient Start** | `#F06A6A` | Gradient start (coral) |
| **Accent Gradient End** | `#F9A06B` | Gradient end (peach-orange) |
| **Accent Purple** | `#AA62E3` | Purple -- for custom fields, tags |
| **Accent Blue** | `#4186E0` | Blue -- for links, project colors |
| **Accent Green** | `#5DA283` | Green -- on track status |
| **Bg Light** | `#FFFFFF` | App background |
| **Bg Light Alt** | `#F6F8F9` | Secondary background |
| **Bg Sidebar** | `#2E2E30` | Sidebar (dark sidebar/light content) |
| **Bg Dark** | `#1E1F21` | Full dark mode background |
| **Surface Card** | `#FFFFFF` | Task detail cards |
| **Surface Card Dark** | `#2A2B2D` | Task detail cards (dark) |
| **Surface Hover** | `#F1F1F1` | Row hover (light) |
| **Text Primary Light** | `#1E1F21` | Primary text (light) |
| **Text Primary Dark** | `#F5F4F3` | Primary text (dark) |
| **Text Secondary Light** | `#6D6E6F` | Secondary text (light) |
| **Text Secondary Dark** | `#A2A0A2` | Secondary text (dark) |
| **Text Muted** | `#9CA0A4` | Placeholder text |
| **Border Light** | `#E8ECEE` | Borders (light) |
| **Border Dark** | `#424244` | Borders (dark) |
| **Success (On Track)** | `#5DA283` | Green -- project on track |
| **Warning (At Risk)** | `#F1BD6C` | Gold -- at risk |
| **Error (Off Track)** | `#E8615A` | Coral-red -- off track |
| **Info** | `#4186E0` | Blue informational |

**UX Reasoning:** Asana's dark sidebar with light content area creates the same spatial anchoring as Slack -- the persistent navigation feels like a solid fixture. The coral accent is warm enough to feel inviting but saturated enough to work as a clear CTA color. The project status colors (green/gold/red) map to traffic-light semantics that every user understands intuitively.

---

### 2.12 Monday.com -- Vibrant Multi-Color

**Design Philosophy:** Monday.com embraces bold, vibrant colors as a core part of its identity. Each project board can be colored differently, and the status system uses a full rainbow spectrum. This multi-color approach reflects Monday.com's positioning as a flexible, visual work management platform.

**Why it works:** Monday.com's visual abundance is strategic -- the colorful interface makes project management feel engaging rather than tedious. Color-coded boards help users navigate between different projects without reading titles. The vibrant system appeals to creative teams and non-technical users.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary** | `#6161FF` | Monday.com's brand purple-blue |
| **Primary Hover** | `#5151E5` | Hover state |
| **Secondary** | `#00CA72` | Green -- success, complete |
| **Accent** | `#FDAB3D` | Orange -- working on it |
| **Bg Light** | `#FFFFFF` | App background |
| **Bg Light Alt** | `#F5F6F8` | Secondary background |
| **Bg Dark** | `#181B34` | Dark mode background |
| **Bg Dark Surface** | `#30324E` | Dark mode surface |
| **Surface Card** | `#FFFFFF` | Board group cards |
| **Surface Card Dark** | `#30324E` | Cards (dark) |
| **Surface Header** | `#F5F6F8` | Board header row |
| **Text Primary** | `#323338` | Primary text |
| **Text Primary Dark** | `#D5D8DF` | Primary text (dark) |
| **Text Secondary** | `#676879` | Secondary text |
| **Text Muted** | `#C3C6D4` | Placeholder, disabled |
| **Border** | `#E6E9EF` | Borders |
| **Border Dark** | `#4B4E69` | Borders (dark) |

**Status Color System:**

| Status | Hex | Label |
|--------|-----|-------|
| **Done** | `#00C875` | Green |
| **Working** | `#FDAB3D` | Orange |
| **Stuck** | `#DF2F4A` | Red |
| **Not Started** | `#C4C4C4` | Gray |
| **Critical** | `#333333` | Black |
| **Priority High** | `#E2445C` | Rose red |
| **Priority Medium** | `#FDAB3D` | Orange |
| **Priority Low** | `#579BFC` | Blue |

**Board Color Options:**

| Color | Hex |
|-------|-----|
| Purple | `#A25DDC` |
| Indigo | `#6161FF` |
| Blue | `#579BFC` |
| Teal | `#66CCFF` |
| Green | `#00C875` |
| Lime | `#9CD326` |
| Yellow | `#FFCB00` |
| Orange | `#FDAB3D` |
| Red | `#E2445C` |
| Magenta | `#FF158A` |
| Berry | `#BB3354` |
| Brown | `#7F5347` |

**UX Reasoning:** Monday.com's vibrant color system serves as a visual memory aid. Users associate projects with colors, making navigation through multiple boards faster than reading titles. The status color system uses universally understood traffic-light semantics (green = done, orange = in progress, red = stuck). The large palette of 12+ board colors ensures teams can create unique visual identities for each workspace.

---

### 2.13 Zendesk -- Green Trust/Support

**Design Philosophy:** Zendesk's "Garden" design system uses green as its primary color, signaling trust, growth, and helpfulness -- perfect for a customer support platform. The design is clean and professional without being cold, reflecting the human connection at the heart of support work.

**Why it works:** Customer support tools need to feel trustworthy and calm. Green communicates "we're here to help" and "things are under control." The warm charcoal text and generous whitespace create a professional but approachable environment where agents spend their entire workday.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary (Green)** | `#17494D` | Zendesk kale (deep teal-green) |
| **Primary Light** | `#228F67` | Garden green -- primary accent |
| **Secondary** | `#03363D` | Dark teal -- deeper brand variant |
| **Accent** | `#1F73B7` | Blue -- links, interactive elements |
| **Accent Hover** | `#175691` | Darker blue hover |
| **Bg Light** | `#FFFFFF` | App background |
| **Bg Light Alt** | `#F8F9F9` | Secondary/panel background |
| **Bg Sidebar** | `#03363D` | Sidebar (dark teal) |
| **Bg Dark** | `#1F2124` | Dark mode background |
| **Surface Card** | `#FFFFFF` | Ticket cards |
| **Surface Card Dark** | `#2A2E31` | Cards (dark) |
| **Surface Raised** | `#FFFFFF` | Modals, popovers |
| **Text Primary** | `#2F3941` | Primary text (warm charcoal) |
| **Text Secondary** | `#68737D` | Secondary text |
| **Text Muted** | `#87929D` | Muted/disabled text |
| **Text On Dark** | `#FFFFFF` | Text on dark backgrounds |
| **Border** | `#D8DCDE` | Default borders |
| **Border Focus** | `#1F73B7` | Focus state border |
| **Success** | `#228F67` | Resolved, positive |
| **Warning** | `#FFBF00` | Pending, needs attention |
| **Error** | `#CC3340` | Urgent, error |
| **Info** | `#1F73B7` | Informational |

**Ticket Priority Colors:**

| Priority | Hex | Usage |
|----------|-----|-------|
| Urgent | `#CC3340` | Immediate attention required |
| High | `#ED961C` | High priority |
| Normal | `#1F73B7` | Standard priority (blue) |
| Low | `#87929D` | Low priority (gray) |

**UX Reasoning:** Zendesk's color system maps directly to support workflows. Ticket priority colors follow a heat-map pattern (red-hot > orange-warm > blue-cool > gray-cold) that support agents instantly recognize. The dark teal sidebar provides strong navigation anchoring while keeping the ticket content area clean and bright for extended reading.

---

### 2.14 Intercom -- Blue Communication

**Design Philosophy:** Intercom uses a warm, approachable blue that signals communication and trust. The interface balances professionalism with friendliness -- it's a tool for talking to customers, so it needs to feel personal, not bureaucratic.

**Why it works:** Blue is the universal "communication" color (think: links, messenger apps, notifications). Intercom's specific shade leans slightly warm/violet, distinguishing it from colder corporate blues. The rounded UI elements and generous spacing reinforce the "friendly conversation" feeling.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary (Blue)** | `#0073B1` | Intercom blue -- primary brand |
| **Primary Alt** | `#286EFA` | Brighter blue -- CTAs (messenger) |
| **Secondary** | `#1B2A4A` | Dark navy -- sidebar, contrast areas |
| **Accent** | `#286EFA` | Interactive blue |
| **Accent Hover** | `#1D5BD6` | Hover state |
| **Accent Gradient Start** | `#286EFA` | Gradient start |
| **Accent Gradient End** | `#975DFA` | Gradient end (purple blend) |
| **Bg Light** | `#FFFFFF` | Content background |
| **Bg Light Alt** | `#F9FAFB` | Secondary background |
| **Bg Sidebar** | `#1B2A4A` | Sidebar (dark navy) |
| **Bg Dark** | `#1A1D21` | Dark mode background |
| **Surface Card** | `#FFFFFF` | Conversation cards |
| **Surface Card Dark** | `#25282D` | Cards (dark) |
| **Surface Hover** | `#F3F4F6` | Hover (light) |
| **Text Primary** | `#1A1D21` | Primary text |
| **Text Primary Dark** | `#E8E8E8` | Primary text (dark) |
| **Text Secondary** | `#6B7280` | Secondary text |
| **Text Muted** | `#9CA3AF` | Muted text |
| **Text On Sidebar** | `#FFFFFF` | Text on dark sidebar |
| **Border** | `#E5E7EB` | Borders |
| **Border Dark** | `#374151` | Borders (dark) |
| **Success** | `#059669` | Positive states |
| **Warning** | `#D97706` | Warning states |
| **Error** | `#DC2626` | Error states |
| **Info** | `#286EFA` | Informational |

**UX Reasoning:** Intercom's design strategy uses a dark sidebar (common in messaging platforms) to separate navigation from conversations. The blue accent matches user expectations for "clickable/interactive" established by decades of web links. The slight purple lean in gradients signals modernity and differentiates Intercom from more conservative enterprise blues.

---

### 2.15 Salesforce -- Cloud Blue Professional

**Design Philosophy:** Salesforce's Lightning Design System is one of the most comprehensive enterprise design systems. It uses a distinctive cloud blue that balances professionalism with the "friendly cloud" metaphor. The system is built for complex enterprise UIs where data density is high and users need clear visual hierarchy.

**Why it works:** Enterprise CRM requires trust above all else -- companies trust Salesforce with their most important business data. The medium-saturation blue is professional without being sterile, and the comprehensive token system ensures consistency across thousands of UI elements.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary (Brand)** | `#1589EE` | Salesforce cloud blue (classic) |
| **Primary Updated** | `#0176D3` | Updated brand blue (Lightning) |
| **Secondary** | `#032D60` | Dark navy -- deep brand variant |
| **Accent** | `#0176D3` | Interactive blue |
| **Accent Hover** | `#014486` | Darker blue hover |
| **Bg Light** | `#FFFFFF` | Content background |
| **Bg Light Alt** | `#F3F3F3` | Page-level background (gray-100) |
| **Bg Sidebar** | `#032D60` | Navigation sidebar (dark navy) |
| **Bg Dark** | `#16325C` | Dark context background |
| **Surface Card** | `#FFFFFF` | Card surfaces |
| **Surface Card Raised** | `#FFFFFF` | Elevated cards with shadow |
| **Surface Stripe** | `#F3F3F3` | Alternating row stripe |
| **Text Primary** | `#181818` | Primary text |
| **Text Secondary** | `#444444` | Secondary text |
| **Text Muted** | `#706E6B` | Muted/helper text |
| **Text Inverse** | `#FFFFFF` | Text on dark backgrounds |
| **Text Link** | `#0176D3` | Link text |
| **Border** | `#C9C9C9` | Default borders |
| **Border Light** | `#E5E5E5` | Light borders |
| **Border Focus** | `#0176D3` | Focus ring |
| **Success** | `#2E844A` | Positive/complete |
| **Warning** | `#DD7A01` | Warning/attention |
| **Error** | `#C23934` | Error/destructive |
| **Info** | `#0176D3` | Informational |

**SLDS Object Colors:**

| Object | Hex | Usage |
|--------|-----|-------|
| Account | `#7F8DE1` | Periwinkle |
| Contact | `#A094ED` | Lavender |
| Opportunity | `#FCB95B` | Gold |
| Lead | `#F88962` | Coral |
| Case | `#E3D076` | Yellow |
| Task | `#4BC076` | Green |
| Campaign | `#F2CF5B` | Warm yellow |
| Report | `#2ECBBE` | Teal |
| Dashboard | `#E87EAD` | Pink |

**UX Reasoning:** Salesforce's SLDS uses object-specific colors (account = periwinkle, contact = lavender, opportunity = gold) to help users navigate data-dense interfaces. When a CRM shows dozens of record types, color-coded icons and headers let users identify record types without reading labels. The enterprise-grade token system (500+ tokens) ensures that the design scales across Salesforce's massive product ecosystem.

---

### 2.16 HubSpot -- Orange Energy/Growth

**Design Philosophy:** HubSpot uses a warm orange that communicates energy, growth, and approachability. As a marketing/sales/service platform, HubSpot needs to feel dynamic and optimistic -- qualities that orange delivers naturally. The design balances data density (dashboards, reports) with a friendly, accessible feel.

**Why it works:** Orange is the color of enthusiasm and action -- fitting for a platform that helps companies grow. It's warmer than red (less aggressive) and more energetic than yellow. HubSpot's specific shade (called "Oz") has enough depth to work as a professional accent without feeling childish.

| Token | Hex | Description |
|-------|-----|-------------|
| **Primary (Oz)** | `#FF7A59` | HubSpot orange -- core brand color |
| **Primary Hover** | `#FF5C35` | Deeper orange on hover |
| **Primary Dark** | `#E8573F` | Pressed/active state |
| **Secondary** | `#00BDA5` | Teal -- secondary brand color |
| **Accent** | `#FF7A59` | Primary interactive color |
| **Accent Blue** | `#0091AE` | Blue -- links and navigation |
| **Bg Light** | `#FFFFFF` | Content background |
| **Bg Light Alt** | `#F5F8FA` | Secondary background |
| **Bg Sidebar** | `#2D3E50` | Sidebar (dark slate) |
| **Bg Dark** | `#2D3E50` | Dark UI background |
| **Bg Dark Deep** | `#213343` | Deeper dark variant |
| **Surface Card** | `#FFFFFF` | Card surfaces |
| **Surface Card Dark** | `#33475B` | Cards (dark) |
| **Surface Hover** | `#EAF0F6` | Hover background |
| **Text Primary** | `#33475B` | Primary text (slate) |
| **Text Primary Dark** | `#F5F8FA` | Primary text (dark mode) |
| **Text Secondary** | `#516F90` | Secondary text |
| **Text Muted** | `#7C98B6` | Muted/placeholder text |
| **Text On Brand** | `#FFFFFF` | Text on orange/brand backgrounds |
| **Border** | `#CBD6E2` | Default borders |
| **Border Dark** | `#425B76` | Borders (dark) |
| **Border Focus** | `#0091AE` | Focus state |

**Hub-Specific Accent Colors:**

| Hub | Hex | Usage |
|-----|-----|-------|
| Marketing Hub | `#FF7A59` | Orange -- core brand |
| Sales Hub | `#516F90` | Slate blue -- professional |
| Service Hub | `#00BDA5` | Teal -- support/trust |
| CMS Hub | `#FF5C35` | Deep orange |
| Operations Hub | `#7C98B6` | Steel blue |

| Semantic | Hex | Usage |
|----------|-----|-------|
| **Success** | `#00BDA5` | Teal green -- positive |
| **Warning** | `#DBAE60` | Warm amber -- caution |
| **Error** | `#F2545B` | Soft red -- error |
| **Info** | `#0091AE` | Blue -- informational |

**UX Reasoning:** HubSpot's hub-specific colors create product identity within a product suite. Marketing users see orange, Sales users see blue, Service users see teal -- each hub feels like a distinct workspace within a unified platform. The warm slate text color (#33475B) is softer than pure black, reducing fatigue during long dashboard-viewing sessions.

---

## 3. Accessibility Guidelines

### WCAG Contrast Requirements

The Web Content Accessibility Guidelines (WCAG) 2.1 define three conformance levels for color contrast:

#### Level AA (Minimum -- Required)

| Element | Minimum Ratio | How to Check |
|---------|---------------|-------------|
| Normal text (<18px, or <14px bold) | **4.5:1** | Text color against its direct background |
| Large text (>=18px, or >=14px bold) | **3:1** | Text color against its direct background |
| UI components & graphical objects | **3:1** | Borders, icons, form controls against adjacent colors |
| Focus indicators | **3:1** | Focus ring against both the component and the background |

#### Level AAA (Enhanced -- Recommended for Long-Use Tools)

| Element | Minimum Ratio | Notes |
|---------|---------------|-------|
| Normal text | **7:1** | Strongly recommended for tools used 4+ hours daily |
| Large text | **4.5:1** | Significant improvement for extended reading |

#### Practical Contrast Reference

Common color pairs and their approximate contrast ratios:

| Foreground | Background | Ratio | Passes |
|-----------|------------|-------|--------|
| `#000000` | `#FFFFFF` | 21:1 | AAA |
| `#1F2328` | `#FFFFFF` | 16.2:1 | AAA |
| `#333333` | `#FFFFFF` | 12.6:1 | AAA |
| `#666666` | `#FFFFFF` | 5.7:1 | AA |
| `#767676` | `#FFFFFF` | 4.5:1 | AA (minimum) |
| `#808080` | `#FFFFFF` | 3.9:1 | AA Large only |
| `#959595` | `#FFFFFF` | 3.0:1 | Fail for text |
| `#E6EDF3` | `#0D1117` | 13.6:1 | AAA |
| `#8B949E` | `#0D1117` | 6.3:1 | AA |

### Non-Color Indicators

Color must never be the sole means of conveying information:

- **Status indicators:** Always pair color with text labels ("Resolved" not just a green dot)
- **Form validation:** Use icons (checkmark, X) alongside red/green coloring
- **Charts/graphs:** Use patterns, shapes, or labels in addition to color coding
- **Links:** Underline links or use another visual cue besides color change
- **Active states:** Use weight, underline, or border in addition to color

### Focus Visibility

Every interactive element must have a visible focus indicator:

```
Best practice: 2px solid ring with offset
- Inner ring: 2px solid accent color
- Outer ring: 2px solid with contrasting color (for dark/light background flexibility)
- Offset: 2px from the element edge
```

Focus must not be removed via `outline: none` without providing an equivalent or better alternative.

### Reduced Motion

Respect `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Color Blindness Considerations

Approximately 8% of men and 0.5% of women have some form of color vision deficiency:

| Type | Affects | Design Guidance |
|------|---------|----------------|
| **Protanopia** (no red) | ~1% of men | Red and green look similar. Never use red vs. green as the only differentiator. |
| **Deuteranopia** (no green) | ~1% of men | Similar to protanopia. Green appears brownish-yellow. |
| **Tritanopia** (no blue) | ~0.01% | Blue and yellow look similar. Rare but consider it. |
| **Achromatopsia** (no color) | ~0.003% | Design must work in grayscale. Test by desaturating. |

**Safe Color Combinations:**
- Blue + Orange (distinguishable in all common forms of color blindness)
- Blue + Red (distinguishable except in tritanopia, which is very rare)
- Purple + Yellow/Orange
- Avoid: Red vs. Green as the only differentiator (use red vs. blue instead, or add icons/text)

### Touch Target Sizes

| Standard | Minimum Size | Recommended |
|----------|-------------|-------------|
| WCAG 2.1 AA | 24x24 px | 44x44 px |
| Apple HIG | 44x44 pt | 44x44 pt |
| Material Design | 48x48 dp | 48x48 dp |
| Practical minimum | 34x34 px | 44x44 px (with spacing) |

---

## 4. Implementation Notes

### CSS Custom Properties Approach

Modern theme systems use CSS custom properties (variables) defined on `:root` or `[data-theme]` selectors:

```css
/* Light theme (default) */
:root {
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f6f8fa;
  --color-bg-surface: #ffffff;
  --color-text-primary: #1f2328;
  --color-text-secondary: #656d76;
  --color-text-muted: #8c959f;
  --color-border-default: #d0d7de;
  --color-accent-primary: #0969da;
  --color-accent-hover: #0550ae;
  --color-semantic-success: #1a7f37;
  --color-semantic-warning: #9a6700;
  --color-semantic-error: #cf222e;
  --color-semantic-info: #0969da;
}

/* Dark theme */
[data-theme="dark"] {
  --color-bg-primary: #0d1117;
  --color-bg-secondary: #161b22;
  --color-bg-surface: #161b22;
  --color-text-primary: #e6edf3;
  --color-text-secondary: #8b949e;
  --color-text-muted: #484f58;
  --color-border-default: #30363d;
  --color-accent-primary: #58a6ff;
  --color-accent-hover: #79c0ff;
  --color-semantic-success: #3fb950;
  --color-semantic-warning: #d29922;
  --color-semantic-error: #f85149;
  --color-semantic-info: #58a6ff;
}
```

### Token Naming Convention

Use a consistent, semantic naming pattern:

```
--color-{category}-{variant}

Categories: bg, text, border, accent, semantic
Variants:   primary, secondary, muted, hover, active, focus
```

Examples:
- `--color-bg-primary` (main background)
- `--color-text-secondary` (secondary text)
- `--color-border-focus` (focus ring border)
- `--color-accent-hover` (accent on hover)
- `--color-semantic-success` (success state)

### HSL-Based Color Adjustments

HSL (Hue, Saturation, Lightness) is the most intuitive color model for generating theme variants. Given a single accent color, you can derive an entire scale:

```css
:root {
  /* Base accent in HSL components */
  --accent-h: 221;    /* Hue */
  --accent-s: 83%;    /* Saturation */
  --accent-l: 53%;    /* Lightness */

  /* Derived variants using calc() */
  --accent-primary:   hsl(var(--accent-h), var(--accent-s), var(--accent-l));
  --accent-hover:     hsl(var(--accent-h), var(--accent-s), calc(var(--accent-l) - 8%));
  --accent-active:    hsl(var(--accent-h), var(--accent-s), calc(var(--accent-l) - 14%));
  --accent-subtle:    hsl(var(--accent-h), calc(var(--accent-s) - 30%), calc(var(--accent-l) + 38%));
  --accent-muted:     hsl(var(--accent-h), calc(var(--accent-s) - 45%), calc(var(--accent-l) + 25%));
}
```

#### HSL Lightness Scale for Generating Shades

To generate a full shade scale from a single color:

| Shade | Lightness Adjustment | Use Case |
|-------|---------------------|----------|
| 50 | Base L + 43% | Tinted backgrounds |
| 100 | Base L + 38% | Subtle fills |
| 200 | Base L + 28% | Hover backgrounds |
| 300 | Base L + 18% | Borders, decorative |
| 400 | Base L + 8% | Muted text on dark |
| 500 | Base L (origin) | Primary accent |
| 600 | Base L - 8% | Hover state |
| 700 | Base L - 16% | Active/pressed |
| 800 | Base L - 26% | Bold text on light |
| 900 | Base L - 36% | Near-black text |
| 950 | Base L - 43% | Darkest shade |

#### Dark Mode Lightness Inversion

For dark mode, invert the relationship: backgrounds become dark, accents become lighter:

```css
[data-theme="dark"] {
  /* Lighten the accent for dark backgrounds */
  --accent-primary:   hsl(var(--accent-h), calc(var(--accent-s) - 10%), calc(var(--accent-l) + 15%));
  --accent-hover:     hsl(var(--accent-h), calc(var(--accent-s) - 10%), calc(var(--accent-l) + 22%));
  --accent-subtle:    hsl(var(--accent-h), calc(var(--accent-s) - 50%), 15%);
}
```

Key rules for dark mode HSL adjustments:
- **Desaturate by 10-15%** to reduce eye strain on dark backgrounds
- **Increase lightness by 12-20%** so accent colors remain visible
- **Subtle backgrounds** should be the accent hue at very low saturation and lightness (10-18%)
- **Border colors** should be the accent hue at low saturation (5-15%) and moderate lightness (20-30%)

### Contrast and Brightness Adjustment Patterns

#### Dynamic Contrast Adjustment

For user-adjustable contrast (accessibility feature), use a CSS multiplier approach:

```css
:root {
  --contrast-multiplier: 1;  /* 1 = normal, 1.2 = high contrast */

  --text-primary-l: 13%;     /* Base lightness of primary text */
  --text-secondary-l: 40%;
  --text-muted-l: 56%;

  --color-text-primary:   hsl(0, 0%, calc(var(--text-primary-l) / var(--contrast-multiplier)));
  --color-text-secondary: hsl(0, 0%, calc(var(--text-secondary-l) / var(--contrast-multiplier)));
  --color-text-muted:     hsl(0, 0%, calc(var(--text-muted-l) / var(--contrast-multiplier)));
}

/* High contrast mode */
[data-contrast="high"] {
  --contrast-multiplier: 1.25;
}
```

#### Brightness Adjustment for Theme Variants

To create "dimmed" variants of a theme (like GitHub's Dark Dimmed):

```css
[data-theme="dark-dimmed"] {
  /* Raise all background lightness by ~8% from the default dark theme */
  --bg-offset: 8%;

  --color-bg-primary:   hsl(215, 14%, calc(8% + var(--bg-offset)));
  --color-bg-secondary: hsl(215, 12%, calc(12% + var(--bg-offset)));
  --color-bg-surface:   hsl(215, 10%, calc(16% + var(--bg-offset)));

  /* Reduce text lightness proportionally */
  --color-text-primary: hsl(215, 15%, 75%);
  --color-text-secondary: hsl(215, 10%, 50%);
}
```

### Theme Switching Implementation

```javascript
// Minimal theme switcher
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('user-theme', theme);
}

// Respect system preference, allow override
function initTheme() {
  const stored = localStorage.getItem('user-theme');
  if (stored) {
    setTheme(stored);
    return;
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(prefersDark ? 'dark' : 'light');
}

// Listen for system changes
window.matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', (e) => {
    if (!localStorage.getItem('user-theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
```

### Performance Considerations

- **CSS custom properties** are resolved at paint time. Changing a property on `:root` triggers a repaint of the entire page. This is acceptable for theme switching but should not happen on scroll or mousemove.
- **Limit custom property depth.** Chains like `var(--a, var(--b, var(--c)))` are costly to resolve. Keep fallback chains to 1 level max.
- **Prefer `color-mix()` (CSS Level 5)** over calc-based HSL when browser support allows. It is more performant and handles gamut mapping correctly:

```css
/* Modern approach (2024+ browser support) */
:root {
  --accent: #0969da;
  --accent-hover: color-mix(in oklch, var(--accent), black 15%);
  --accent-subtle: color-mix(in oklch, var(--accent), white 85%);
}
```

---

## Appendix: Quick Comparison Matrix

| Brand | Primary Hue | Theme Default | Accent Usage | Neutral Temp | Target User |
|-------|------------|---------------|-------------|-------------|-------------|
| Slack | Purple-brown | Light (dark sidebar) | Multi-accent (4 colors) | Neutral | Team communication |
| Linear | Indigo | Dark | Single accent | Cool | Developer PM |
| Notion | None (black) | Light | Minimal blue | Warm | Knowledge work |
| Stripe | Blue-purple | Light | Single accent | Cool | Financial/developer |
| Vercel | None (black) | Both (user choice) | Single blue accent | True neutral | Deployment/developer |
| GitHub | Blue | Both (multi-theme) | Single accent per theme | Cool | Code collaboration |
| Discord | Blue-purple | Dark | Single + status colors | Cool | Community/social |
| Spotify | Green | Dark | Single accent | True neutral | Entertainment |
| Figma | Orange-coral | Light | Multi-accent (5 colors) | Neutral | Design |
| Todoist | Red | Light | Priority-mapped | Warm neutral | Personal productivity |
| Asana | Coral | Light (dark sidebar) | Multi-accent | Warm | Team PM |
| Monday.com | Purple-blue | Light | Vibrant multi-color | Cool neutral | Visual PM |
| Zendesk | Green/teal | Light (dark sidebar) | Dual (green + blue) | Cool neutral | Customer support |
| Intercom | Blue | Light (dark sidebar) | Gradient blue-purple | Cool | Customer messaging |
| Salesforce | Blue | Light (dark sidebar) | Object-mapped colors | Cool neutral | Enterprise CRM |
| HubSpot | Orange | Light (dark sidebar) | Hub-mapped colors | Cool neutral | Marketing/Sales |

---

*Document created February 2026. Color values are based on publicly observable brand implementations and may evolve as brands update their design systems. Always verify current brand colors from official design system documentation when implementing branded themes.*
