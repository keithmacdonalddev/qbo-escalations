# Animation & Motion Design Report
## QBO Escalation Assistant -- Comprehensive Animation Reference

*Prepared March 2026.*

---

## 1. Executive Summary

The QBO Escalation Assistant has a solid animation foundation: motion tokens, Framer Motion config, AnimatePresence for routes, skeletons, and reduced-motion support. What it lacks: layout animations, scroll-driven effects, stagger sequences, spring tuning, 3D depth, and micro-interactions. This report catalogs every technique worth considering.

---

## 2. Current Animation Audit

### 2.1 CSS Keyframes (19 total)

pulse-ring, shimmer, cursor-blink, toast-in/out, modal-overlay-in, modal-content-in, fade-in, spin, thinkingDot, skeletonShimmer, headerDev*(4), popoverIn, chat-live-pulse, circuit-pulse. Most use opacity/transform (GPU-composited).

### 2.2 Framer Motion

Used: MotionConfig, useReducedMotion, AnimatePresence routes, motion.div, motion.button whileHover/whileTap.
NOT used: layout, layoutId, useScroll, useTransform, useSpring, drag, stagger (defined unused).

### 2.3 Good: 3-layer token system, reduced-motion catch-all, .gpu-layer utility, calibrated springs.
### 2.4 Missing: layout animations, shared transitions, scroll animations, stagger, counters, theme crossfade.

---

## 3. Animation Philosophy

8+ hr/day tool. Functional + selective Ambient. Linear: fast (100-200ms), purposeful, never blocking, springs. The 200ms Rule is correct.

---

## 4. CSS Mastery

GPU-safe: transform, opacity, filter. Never: width/height/top/left/margin/padding. will-change: max 20 elements. contain: layout/paint on chat/sidebar. Scroll-driven animations: off main thread, Tokopedia CPU 50%->2%.

---

## 5. Framer Motion Patterns

layout: FLIP technique, most impactful unused feature.
layoutId: .sidebar-nav-indicator-bg ready, transitions.layout spring configured.
Springs: Snappy(400/30/1,0.75), Gentle(200/25/1,0.88), Layout(500/35/0.8,0.88). Add: Bouncy(300/10/0.5), Heavy(150/30/2), Instant(700/40/0.5).
Stagger: 0.04-0.06s/item, cap 8-12.
useTransform+useSpring: reactive values without re-render.

---

## 6. 3D Effects

perspective:800px, preserve-3d, backface-visibility:hidden. Tilt max 4-8deg. GPU-composited. Disable mobile.

---

## 7. Route Transitions

View Transitions API: Baseline Oct 2025. Shared elements: layoutId escalation cards dashboard->detail.

---

## 8. Micro-Interactions

Button:50ms active. Toggle:layout+spring. Counter:useSpring. Copy:AnimatePresence. Toast:spring+swipe. Tooltip:120ms. Progress:scaleX. Skeleton:@property.

---

## 9. Ambient Effects

Gradient mesh: empty states, 20s+, 5-8% opacity. Frosted glass: already excellent. Noise: 2% overlay.

---

## 10. App-Specific Recommendations

Chat: springGentle entrance (user right, assistant left). Sidebar: layoutId indicator, conversation stagger. Dashboard: 40ms card stagger, AnimatedCounter. Lab: spring pop results, scaleX progress. Gmail: layout on rows. Modals: spring(300/28). Theme: View Transitions API. Toasts: spring+swipe.

---

## 11. Performance

16.67ms/frame. Never animate width/height/margin. will-change max 20. Reduced motion done. Mobile: no 3D, less stagger, content-visibility.

---

## 12. Priority

T1(1-2h): sidebar layoutId, chat entrance, stat counters, card stagger, toast spring.
T2(2-4h): shared elements, theme crossfade, modal spring, email layout, tab indicator.
T3(4-8h): scroll header, 3D tilt, directional routes, lab progress, odometer.
T4: scroll CSS, gradient mesh, noise, parallax, Lottie.

---

## 13. Tools

Have: Framer Motion 12 (95% coverage), React 19, Vite 7.
Consider: Lottie (~15KB). Skip: GSAP, R3F.
Native: View Transitions, scroll-driven, @property, contain, content-visibility.

---

## Appendix

Duration: instant(50), micro(100), fast(150), normal(200), emphasis(300), slow(400), dramatic(700)ms
Easing: standard, decelerate, accelerate, emphasized, spring, apple, out-expo, in-out-quart
Springs: Snappy(400/30/1), Gentle(200/25/1), Layout(500/35/0.8)

*Purpose over polish.*