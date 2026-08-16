# Sidebar Settings Flyout Product/UX Brief

**Classification:** Major user-visible work

**Designer:** Registered Product/UX Designer, GPT-5.6 Sol, high reasoning, vision-capable

**Direction date:** 2026-08-16

**Status:** Implemented direction; release still requires focused verification and an independent design-experience verdict.

## User goal

Give people one predictable Settings control at the bottom of the main sidebar. It opens a compact menu for full Settings, the design-system documentation, and the two preferences that affect the sidebar itself. Opening the control must never navigate directly.

## Entry, hierarchy, and wording

The footer trigger shows a gear and **Settings** when the sidebar is expanded. In the collapsed sidebar it remains an icon button with the accessible name **Open sidebar settings menu**.

The menu order and wording are fixed:

1. **Open Settings** → `#/settings`
2. **Design system** → `/docs`
3. A quiet **Sidebar** group label
4. **Expand on hover**
5. **Show collapsed labels**

The two preferences are menu checkboxes. Their values, defaults, meanings, and existing browser-storage keys do not change. The main Settings view keeps general text, hints, and header-layout controls but no longer repeats these sidebar-specific preferences. The existing header Settings button remains because it carries separate alert behavior.

## Stable frame and progressive disclosure

- Opening the menu preserves the current page, route, sidebar width, and navigation selection.
- A collapsed sidebar stays visually expanded while the menu is open so moving to the menu cannot detach it from its trigger.
- On desktop, the menu is a compact floating surface beside the footer trigger and grows upward within the viewport.
- At exactly 390px, it opens upward inside the modal drawer without creating horizontal page overflow.
- The menu contains no explanatory card, nested submenu, provider status, customer data, or diagnostics.
- **Open Settings** is the explicit path to the complete Settings workspace; **Design system** is a normal same-site link that preserves browser link behavior.

## Interaction and continuity

- Pointer click, Enter, and Space open the menu and move focus to its first item.
- Arrow Up/Down, Home, and End move through the menu.
- Enter or Space activates the focused item.
- Escape and outside dismissal close the menu and restore focus when the trigger remains available.
- Tab leaves the non-modal menu cleanly; focus is never trapped.
- A preference updates immediately and leaves the menu open so both options can be adjusted.
- A route change or mobile-drawer dismissal closes the menu.
- Menu-open state is temporary and is never persisted.

The fixed menu always has content and reads local values synchronously, so loading and empty states do not apply. There is no destructive action, so confirmation does not apply. A browser-storage failure must not make the visible control unusable for the current visit.

## Visual, accessibility, and motion direction

- Match the supplied VS Code reference's compact hierarchy and separators without copying its branding.
- Use the Slate system's floating surface, border, text, accent, radius, shadow, and focus tokens.
- Keep icon/check, label, and trailing-indicator columns aligned.
- Use a real button with `aria-haspopup="menu"`; use a `menu` and `menuitemcheckbox` semantics with accurate expanded and checked states.
- Selection must be communicated by both a checkmark and accessibility state, not color alone.
- Motion is limited to a restrained 150–200ms reveal. Reduced motion removes the transform and meaningful duration.

## Scope and approval boundary

In scope: sidebar/footer UI and focused tests, preference prop wiring, removal of the two duplicate controls and stale copy from the main Settings view, exact Settings/docs destinations, and desktop/mobile rendered verification.

Renew user approval before removing or consolidating the header gear, changing preference meanings/defaults/keys, adding menu commands, changing the docs destination behavior, widening this into shared menu infrastructure, or redesigning the broader Settings experience.
