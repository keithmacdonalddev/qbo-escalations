# MetadataLine design release record

**Component:** `MetadataLine`

**Design impact:** Material reusable component

**User-approved direction:** August 16, 2026

**Independent verdict:** `YES — RELEASE QUALITY`

## Approved contract

- Presents one to four parent-supplied supporting facts.
- Canonical default is bare, icon-free, static, non-interactive, and silent.
- Labels use readable secondary ink; values use primary ink with stronger weight.
- Centered-dot separators appear only at normal widths and remain hidden from assistive technology.
- An optional decorative icon is valid only when it clarifies the whole line.
- At an exact 390px browser viewport, separators disappear and facts reflow into parent-supplied label/value rows.
- The primitive owns no status, semantic color, action, formatting logic, data behavior, surface, border, padding, or elevation.
- More than four valid facts produce a development warning while all facts remain rendered to prevent data loss.

## Evidence

- Approved prototype: `MetadataLine-prototype-v2.png`
- Rendered production component, desktop: `MetadataLine-implementation-desktop.png`
- Rendered production component, exact 390px: `MetadataLine-implementation-390.png`
- Exact-390 measurement: viewport `390px`, document width `390px`, horizontal overflow `0px`.
- Responsive measurement: facts use grid reflow and separators are not displayed at 390px.
- Browser evidence contained no page errors; only normal Vite and React development messages were present.
- Focused component contract: `client/src/components/design-system/MetadataLine.test.jsx` — five tests passed.

All screenshots use fabricated, non-sensitive specimen content. No account identifier, credential, portfolio value, or provider payload appears in the evidence.

## Independent review

**Reviewer:** project `design_experience_reviewer` role, separate from the builder

**Question:** “Would Apple release this complete experience as part of one of its products?”

**Verdict:** `YES — RELEASE QUALITY`

The reviewer found that the desktop and exact-390 renders faithfully match the approved primitive: bare, quiet, readable, icon-free by default, with clear label/value hierarchy and restrained separators. The compact and optional-icon forms remain disciplined. At 390px, separators disappear, facts reflow cleanly, and no clipping or horizontal overflow is visible. Documentation framing remains visually distinct from component anatomy.

## Release boundary

This record accepts the reusable primitive itself. It does not approve adoption on the Investments page or any other product screen; each integration must still be judged within its complete surrounding experience.
