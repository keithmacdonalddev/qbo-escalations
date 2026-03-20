# Zendesk Garden Design System -- Application to QBO Escalation Tool

**Report Date:** 2026-03-19
**Company:** Zendesk (Garden Design System, v9)
**Relevance:** HIGHEST -- Both Zendesk and this QBO tool serve support agents who spend 8+ hours daily resolving customer issues. Zendesk is the industry standard for support-agent tooling.

---

## 1. Executive Summary

Zendesk Garden is the most directly relevant design system for the QBO escalation tool because both products serve the identical user persona: a support specialist who spends an entire workday triaging, diagnosing, and resolving customer issues through a multi-panel interface with chat, email, knowledge base, and ticket management.

Garden core insight is that support-agent UX is fundamentally different from consumer UX. Agents need calm professionalism over visual excitement, information density without clutter, trust-signaling color (green/teal = things are under control), context always one glance away, and keyboard-first workflows that reduce time-per-ticket by 20-40%.

---

## 2. Zendesk Design Philosophy

### 2.1 The Garden Metaphor
Composable primitives (buttons, inputs, tags, wells, panes, drawers) assembled per workflow. Not pixel-perfect prescriptions.

### 2.2 Support-Agent-First Design
Neutral backgrounds (#F8F9F9). Blue (#1F73B7) for interactivity only. Status colors sparingly. Dense panel-based layouts.

### 2.3 Calm Professionalism
No gradients, animations, or illustrations in workspace. Calm competence. Aligns with QBO Warm Authority -- different temperature, same intent.

### 2.4 Kale Brand Identity
Kale (#17494D): deep muted teal-green. Dark sidebar anchor, light content.

---

## 3. Key Design Patterns

### 3.1 Three-Column Agent Workspace
Left Sidebar (nav), Center (conversation + composer), Right Context Panel (customer info, knowledge, apps). Center is sacred. Context panel toggleable, resizable, persistent width.

### 3.2 Customer Context Sidebar (THE #1 PATTERN)
All in single resizable panel: User (contact/history), Knowledge (search/link/quote articles), Side Conversations (parallel threads), Related Tickets (similar/merge), Apps (integrations), Record Preview, Tasks.

**QBO parallel:** AgentDock is #1 adoption target. Surface playbook, escalation history, INV cases alongside chat.

### 3.3 Contextual Workspaces
Dynamic reconfiguration per ticket: conditions, forms, macros, apps, layouts, knowledge filters. Recommendation over restriction.

**QBO parallel:** INV vs. general questions trigger different tools. Fixes wrong-workflow friction.

### 3.4 Macro System
Searchable list, keyboard shortcut, contextual filtering. **QBO:** Surface templates inline via /template shortcut.

### 3.5 Knowledge Panel
Search, link, quote articles, flag outdated, filter by brand/language. **QBO:** Playbook search alongside chat eliminates switching.

### 3.6 Custom Layouts and CSAT
Drag-drop layout builder. CSAT per-ticket/agent/team, binary good/bad.

---

## 4. Color System

### 4.1 Palette
Blue (#1F73B7) = interactive. Red (#CC3340) = danger. Green (#037F52/#228F67) = success. Grey (12 shades #293239-#F8F9F9) = neutral. Kale (#17494D/#03363D) = brand.

### 4.2 Elevation
Recessed (wells) < Default (page bg) < Subtle (alerts) < Raised (modals).

### 4.3 Priority Thermal Gradient
Urgent=Red, High=Orange (#ED961C), Normal=Blue, Low=Grey.

### 4.4 QBO Comparison
QBO ember accent more distinctive. QBO muted gold warning better for long shifts. QBO warm backgrounds reduce fatigue. Consider blue as secondary link color only.

---

## 5. Typography and Spacing

### 5.1 Typography
Zendesk: system fonts, 14px, 20px line-height, semibold 600. QBO: Inter (better consistency), 14.5px, 22.5px line-height (more generous = better), bold 700 (consider 600 for headings).

### 5.2 Spacing
Garden base-4 (4-32px). QBO finer granularity (4-36px with 6/14/28 steps). No changes needed.

### 5.3 Border Radius
Garden conservative (2/4/8). QBO softer (4/8/12/16). Keep QBO values.

---

## 6. Motion and Interaction
Standard=0.25s, Quick=0.1s. No springs. Use 0.1s for high-freq actions. Focus: double-ring excellent in both. Disabled: Garden specific colors (#848F99) better than QBO opacity.

---

## 7. Accessibility
Principles: keyboard-reachable, all state readable, no ARIA > bad ARIA. QBO gaps: modal focus trapping, ARIA live regions, keyboard shortcuts docs, color-only status labels.

---

## 8. Component Library
60+ components. QBO gaps: Combobox, Accordion, Stepper, Progress, Breadcrumbs, Avatar.

---

## 9. Application to QBO App

### 9.1 CRITICAL: Context Panel Alongside Chat
Transform AgentDock into context panel: Playbook Search, Escalation History, INV Cases, Templates, AI Chat tabs. Eliminates #1 workflow friction (5-10s per switch). MEDIUM effort.

### 9.2 HIGH: Inline Template System
/template shortcut in chat: searchable, filtered by category, preview, one-keystroke insert. 30-50% faster common responses. MEDIUM effort.

### 9.3 HIGH: Adaptive Interface by Input Type
INV-123456 = INV panel + known-issues. Screenshots = error-matching. payroll/bank-feeds = pre-filter playbook. General = default. Fixes wrong-workflow. HIGH effort.

### 9.4 MEDIUM: Priority Colors, Panel Persistence, Quote-to-Chat
Consistent thermal gradient. localStorage panel widths. Playbook quote insertion.

### 9.5 LOW: Combobox, Stepper, Avatars
Searchable dropdowns, resolution flow, chat message indicators.

---

## 10. What NOT to Copy

1. **Cool color temperature** -- QBO warmth reduces fatigue
2. **Conservative radius** (2/4/8) -- QBO 8/12/16 is modern
3. **Blue primary accent** -- Keep ember, blue for links only
4. **Dark sidebar** -- Clashes with warm content
5. **System fonts** -- Inter is better
6. **60+ components** -- Single-user, adopt specific patterns
7. **Flat buttons** -- QBO gradient buttons have better depth

---

## 11. Implementation Priority

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P0** | Context panel alongside chat | Eliminates #1 friction | Medium |
| **P1** | Inline template system | 30-50% faster | Medium |
| **P1** | Adaptive interface by input | Fixes workflow | High |
| **P2** | Panel width persistence | Friction removal | Low |
| **P2** | Quote-to-chat playbook | Faster lookup | Low-Med |
| **P2** | Specific disabled colors | Accessibility | Low |
| **P3** | ARIA live regions | Accessibility | Low |
| **P3** | Modal focus trapping | Accessibility | Low |
| **P3** | Searchable combobox | Better UX | Low |
| **P4** | Resolution stepper | Clarity | Low |
| **P4** | Chat avatars | Scanability | Low |

---

## 12. Sources

- [Garden Home](https://garden.zendesk.com/)
- [Design Overview](https://garden.zendesk.com/design/)
- [Color Tokens](https://garden.zendesk.com/design/color/)
- [Palette Tokens](https://garden.zendesk.com/design/palette/)
- [Components](https://garden.zendesk.com/components/)
- [Typography](https://garden.zendesk.com/components/typography/)
- [Theme Object](https://garden.zendesk.com/components/theme-object/)
- [Designing with Garden](https://developer.zendesk.com/documentation/apps/app-design-guidelines/using-zendesk-garden/)
- [About Agent Workspace](https://support.zendesk.com/hc/en-us/articles/4408821259930)
- [Optimizing Workspace](https://support.zendesk.com/hc/en-us/articles/4408824058138)
- [Contextual Workspaces](https://support.zendesk.com/hc/en-us/articles/4408833498906)
- [Custom Layouts](https://support.zendesk.com/hc/en-us/articles/5447837546138)
- [Context Panel](https://support.zendesk.com/hc/en-us/articles/4408836526362)
- [Workspace Best Practices](https://support.zendesk.com/hc/en-us/articles/4408828930202)
- [Zendesk Accessibility](https://www.zendesk.com/company/agreements-and-terms/accessibility/)
- [Accessibility in Garden](https://www.slideshare.net/slideshow/accessibility-in-the-zendesk-garden-design-system/113809633)
- [Zendesk Garden GitHub](https://github.com/zendeskgarden)
- [React Components](https://github.com/zendeskgarden/react-components)
- [Garden on designsystems.surf](https://designsystems.surf/design-systems/zendesk)
