# Stage 3A Product/UX Brief — Snapshot Reconciliation

**Direction:** `stage-3a-reconciliation-v1`
**Design impact:** Major
**Product boundary:** Development-only verification workbench; the accepted Connected Accounts journey remains unchanged.

## User goal

Manually create one trustworthy portfolio snapshot, inspect exactly what was normalized and saved, and prove that failures never replace complete evidence with partial data. This is an acceptance workbench, not the future Investments workspace.

## Entry and next action

Enter through **Settings → Developer Tools → Questrade snapshot reconciliation**. If disconnected, the first action is **Open Connected Accounts**. If connected or using safe simulation, the first action is **Run snapshot verification**.

## Information architecture

Use one compact working surface:

1. Header and persistent development-only trust line.
2. Command bar for source, fixture case when applicable, and the primary run action.
3. Current verification steps beside the latest complete snapshot evidence.
4. Secondary **Local data and privacy** section with deletion.

No Investments navigation, activities/history, risk, AI, monitoring, market data, upstream stream controls, or trading controls belong here.

## Stable frame

Keep a maximum-width working column inside Settings. The header, command bar, current-run region, and latest-snapshot region stay in place while their contents change. Realtime recovery changes one compact trust line; it never rearranges the page. Deletion uses a focused modal over the workbench.

## Initially visible

- **Questrade snapshot reconciliation**
- A one-line explanation of a snapshot as a complete saved copy retrieved together.
- **Development-only** privacy wording.
- Source, fixture case when applicable, and **Run snapshot verification**.
- Connection/readiness, current verification, and latest complete snapshot state.

Missing evidence is never rendered as zero balances or an empty portfolio.

## Progressive disclosure

Simulation reveals only its labelled fixture selector. A running verification shows Account, Balances, Positions, Validate completeness, and Publish snapshot. Completion shows counts, currencies, observed/fetched time, a shortened snapshot reference, and integrity status. **View normalized records** reveals bounded decimal-string evidence, never raw payloads or full account identity. **Local data and privacy** reveals stored counts and deletion.

## State matrix

- **Initial/loading:** stable frame; controls stay positioned and disabled while state loads.
- **Empty/disconnected:** explain whether the blocker is connection or no saved snapshot; provide one appropriate action.
- **Ready:** connected or simulated source is usable; run action enabled.
- **Running:** name the current step and completed-step count; never fabricate a percentage.
- **Partial/incomplete:** name the failed section, say **No new snapshot was saved**, and keep the prior complete snapshot labelled **Still latest**.
- **Error/recovery:** preserve prior evidence and provide safe retry. Reconnect/replay-gap/polling wording explains that durable state is being rechecked.
- **Success/completed:** briefly announce **Complete snapshot saved**, then settle into the durable latest snapshot.
- **Deleting/deleted:** show consequences and exact counts, block duplicates, then return to the honest no-snapshot state while keeping Questrade authorization connected.

## Continuity

Preserve source, fixture selection, workbench scroll, normalized-record disclosure, and focus across refetches. Realtime events trigger REST refetches only. Reloading during a run restores the durable run. Cancelled deletion returns focus to its trigger; completed deletion focuses the no-snapshot heading.

## Wording

Use **Run snapshot verification**, **Latest complete snapshot**, **Current verification**, **Observed by Questrade**, **Fetched by this app**, **Still latest**, **No new snapshot was saved**, and **Delete local investment data…**. Avoid internal model/field names, raw scenario IDs, and provider error codes.

## Trust and privacy

Show **Margin account**, never an account number. Keep CAD and USD separate. Preserve negative values; show missing values as **Unknown**, never zero. The client displays server-provided decimal strings and performs no money arithmetic. Sanitized evidence contains no real identity, holdings, symbols, balances, token, raw response, or provider destination.

Deletion says: **Delete local investment data from this computer?** It removes Stage 3A account metadata, verification runs, and snapshots; Questrade authorization and all non-Investments data remain. It requires `DELETE INVESTMENT DATA` and cannot be undone.

## Desktop and mobile

Desktop uses a compact two-column workbench: current run at roughly one-third and latest evidence at two-thirds. At exactly 390px, source, fixture, and action stack; current steps precede snapshot evidence; tables become labelled key/value rows with no horizontal page scrolling.

## Keyboard and accessibility

Use labelled source/fixture controls, an ordered list for steps, definitions/tables for evidence, text-plus-symbol status, polite loading/completion announcements, alerts for failures, and a true deletion dialog with focus trapping, Escape cancellation before deletion begins, and correct focus return.

## Reduced motion

Use restrained hover/focus/disclosure transitions only. Do not animate progress or pulse evidence. Reduced motion removes transforms, fades, and spinner rotation while explicit status text remains.

## Production versus development

The entire workbench, fixture controls, transport-fault controls, verification references, and diagnostics are absent from production navigation and DOM. Live verification remains manual and read-only. Nothing synchronizes at startup.

## Visual craft and Slate fit

Use the existing Slate palette, compact spacing, flat dividers, readable secondary text, and blue action/focus treatment. Prefer one divided surface over metric cards. Transport detail remains quiet unless it affects trust.

## Scope and approval triggers

In scope: the development-only workbench, manual complete snapshots, run recovery, safe normalized evidence, and Stage 3A local-data deletion. Renew approval before changing Connected Accounts, adding production navigation, automatic/background synchronization, new stored record types beyond Stage 3A, activities/history, the Stage 3B workspace, Main Chat, events carrying values, risk/AI/monitoring/market-data/trading capability, broader deletion, remote storage, or wider permissions/cost.
