# INV Investigation Cases

## What Are INVs?

INV (Investigation) cases are Intuit's internal tracking numbers for product bugs and issues that are actively under investigation by engineering or product teams. They are posted in the Slack channel **#sitel-stcats-sbseg-articles** by team leads and senior agents.

**Format:** `INV-XXXXXX - [issue description]`
**Example:** `INV-147914 - No option to select a bank account when receiving payment using android app`

Each INV entry includes:
- Timestamp (when it was posted)
- Agent name (who reported/posted it)
- Team designation (FE-SBG-T2, T2/CA, etc.)
- INV number
- Subject/issue description
- **Affected users list** — customers whose accounts are experiencing the issue. Phone agents add customers to this list through their internal Intuit tools. Once added, the customer receives email notifications when engineering resolves the investigation.

INVs in the Slack channel do not carry explicit open/closed status indicators. However, investigations do get resolved — engineering closes them when fixes are deployed, and affected users are notified via email. In this app, you can track status locally: Active (under investigation), Monitoring (fix deployed, watching for recurrence), Resolved (confirmed fixed).

## Why INVs Matter for Escalations

When a customer calls in with a problem that matches a known INV, the escalation path changes completely:

1. **No need to troubleshoot from scratch** — the issue is already identified and under investigation
2. **Faster resolution for the phone agent** — "This is a known issue, INV-XXXXXX, Intuit engineering is investigating"
3. **Sets correct customer expectations** — the customer knows it's not something on their end
4. **Reduces unnecessary escalations** — the agent doesn't need to escalate further if the INV already covers their issue
5. **The customer gets added to the affected users list** and receives automatic email notifications when the fix is deployed — they're not left wondering
6. **It increases the investigation's visibility/priority within Intuit engineering** — more affected users = higher priority

## How to Use INVs During Escalations

### When an escalation comes in:

1. **Check for matching INVs first** — before diving into troubleshooting, search the investigation database for keywords that match the customer's issue
2. **Match on symptoms, not exact wording** — a customer saying "I can't pick my bank when taking a payment on my phone" matches `INV-147914 - No option to select a bank account when receiving payment using android app`
3. **Give the agent the INV number and tell them to add the customer to the investigation's affected users list** — this is the most important action. The customer will receive email notifications when engineering resolves the issue. The agent should also document the INV number on the case.
4. **If a workaround exists, provide it** so the customer can continue working while waiting for the fix

### Response template when an INV matches:

> This is a known issue — **INV-XXXXXX**: [brief description].
>
> **Action for the agent:** Add the customer to the affected users list for INV-XXXXXX. The customer will receive email notifications when engineering resolves this.
>
> [**Workaround:** brief workaround / **No workaround** is currently available at this time.]
>
> There is no ETA for a fix — engineering is actively investigating.

### When no INV matches:

- Proceed with normal troubleshooting
- If the issue appears to be a product bug (not user error, not configuration), note it — it may become an INV later
- If multiple customers report the same unresolved issue, flag it to your lead for potential INV creation

## Common INV Categories

INVs span every area of QBO. The most frequent categories include:

| Category | Example Issues |
|----------|---------------|
| **Bank Feeds** | Connections failing for specific banks, transactions not downloading, duplicate transactions |
| **Payments** | Payment processing errors, mobile payment bugs, payment link failures |
| **Invoicing** | Invoice rendering issues, email delivery failures, recurring invoice bugs |
| **Reports** | Reports showing incorrect data, export failures, custom report bugs |
| **Mobile App** | Features missing or broken on iOS/Android, sync issues between mobile and web |
| **Inventory** | Quantity tracking errors, inventory valuation discrepancies |
| **Payroll** | Tax calculation errors, direct deposit failures, form generation issues |
| **Permissions** | Users unable to access features they should have, role assignment bugs |
| **Chart of Accounts** | Account type issues, merge/rename bugs, default account problems |
| **Sales Tax** | Rate calculation errors, nexus issues, AST (Automated Sales Tax) bugs |

## INV vs Normal Troubleshooting

| Situation | Action |
|-----------|--------|
| Issue matches a known INV exactly | Reference the INV, provide workaround if available, skip troubleshooting |
| Issue is similar but not identical to an INV | Troubleshoot normally — similar symptoms can have different causes |
| Issue has no matching INV | Full troubleshooting, standard escalation path |
| Customer demands a fix timeline for an INV issue | No ETAs are provided through INV channels — say "Intuit engineering is actively investigating but no timeline has been communicated" |
| Multiple customers hitting the same unmatched issue | Flag to team lead for potential INV creation |

## Workarounds

Workarounds are tracked per-INV in the app's investigation database. The AI surfaces them automatically when matching escalations to known INVs — if a workaround is stored for an INV, it appears in the response without the user needing to look it up.

When providing a workaround:

1. **Be explicit that this is a temporary measure** — "Until the fix is released, you can work around this by..."
2. **Common workaround patterns:**
   - Mobile app issue: try the desktop/web version instead
   - Browser-specific issue: try a different browser or clear cache
   - Feature-specific issue: use an alternative workflow (e.g., manual entry instead of bank feed import)
   - Calculation issue: manually verify and adjust the numbers
3. **If no workaround exists**, say so directly — don't invent one

## Resolution Notes

**Known Issue — INV Match:**
> Customer issue matches **INV-[NUMBER]** — [issue description]. Informed agent this is a known issue under investigation. Instructed agent to add customer to affected users list for email notifications on resolution. [Provided workaround: ... / No workaround available]. Agent will document INV number on the case.

**Known Issue — Partial Match:**
> Customer issue is similar to **INV-[NUMBER]** but [key difference]. Proceeded with standard troubleshooting. [Resolution or further escalation details].

**Potential New INV:**
> Customer issue appears to be a product bug — [description]. No matching INV found. [Number] customers have reported similar symptoms. Flagged to [lead name] for potential INV creation.

## Cross-References

- **[Bank Feeds](bank-feeds.md)** — Bank connection INVs often overlap with bank feed troubleshooting
- **[Invoicing](invoicing.md)** — Invoice rendering and email delivery INVs affect invoice workflows
- **[Payroll](payroll.md)** — Payroll calculation INVs are high-priority and time-sensitive (pay runs)
- **[Tax](tax.md)** — Sales tax calculation INVs affect invoice totals and reports
- **[Technical](technical.md)** — Browser and platform-specific INVs overlap with general technical troubleshooting
