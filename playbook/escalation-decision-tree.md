# Escalation Decision Tree

When should you resolve it yourself vs escalate further? Use this tree to decide in under 60 seconds.

---

## Step 1: Can You Diagnose It?

```
Can you identify the root cause?
├── YES → Go to Step 2
├── PARTIALLY (have a hypothesis but not sure) → Go to Step 2, but flag uncertainty
└── NO (completely stumped) → Try these before escalating:
    ├── Check edge-cases.md for cross-category patterns
    ├── Check error-messages.md for the exact error text
    ├── Check translations.md if the customer description is vague
    ├── Ask the agent for more details (screenshot, exact error, exact steps)
    └── Still no idea → Escalate with "needs-investigation" template
```

## Step 2: Can You Fix It?

```
Is the fix within your capabilities?
├── YES, it's a settings change or user guidance → RESOLVE IT yourself
├── YES, but it requires the customer to do something later → RESOLVE + schedule follow-up
├── MAYBE, it's a workaround (not a real fix) → RESOLVE with "workaround" template
│   └── Also: document the underlying issue for tracking
├── NO, it requires backend/database changes → ESCALATE to Intuit Engineering
├── NO, it requires billing/refund action → ESCALATE to Intuit Billing
└── NO, it requires data repair → ESCALATE to Intuit Data Services
```

## Step 3: How Urgent Is It?

```
What is the business impact RIGHT NOW?
├── CRITICAL: Payroll due today, can't access QBO, money went to wrong place
│   └── ESCALATE IMMEDIATELY — stay on the line, warm-transfer if possible
├── HIGH: Major feature broken, customer blocked from daily work
│   └── Resolve if you can within 15 minutes. If not, escalate with urgency flag.
├── MEDIUM: Feature issue but customer can work around it
│   └── Resolve or provide workaround. Follow up within 24-48 hours.
└── LOW: How-to question, cosmetic issue, feature request
    └── Resolve on the call. No escalation needed.
```

---

## Escalation Destinations

### When to Escalate to Intuit Payroll Support
- Payroll stuck processing for 1+ hours
- Tax forms filed with incorrect amounts
- Direct deposit sent to wrong account
- State tax notice related to QBO-filed returns
- Employee/contractor reclassification affecting filed forms
- Payroll subscription billing issues (separate from QBO billing)

### When to Escalate to Intuit Billing Support
- Customer was double-charged (confirmed, not auth hold)
- Account suspended and cannot self-reactivate
- Cancellation processed but charges continue
- Subscription shows wrong tier after change
- Refund needed for any reason

### When to Escalate to Intuit Engineering / Data Services
- Balance Sheet does not balance (data integrity failure)
- Transactions disappeared or amounts changed without user action
- Audit Log shows system-generated changes (not user-initiated)
- Same report returns different numbers on consecutive runs
- Bank feed importing into wrong company file
- Reconciliation data corrupted (wrong R/C status on transactions)

### When to Escalate to Intuit Security
- Unauthorized user has access to the company file
- Customer reports transactions they did not create (and Audit Log confirms unknown user)
- Suspected account compromise
- Suspicious API access in Connected Apps

### When to Escalate to Your Supervisor
- Customer threatening legal action
- Customer is a high-value account or enterprise client
- Issue has been escalated 3+ times without resolution
- You disagree with a previous specialist's resolution
- The issue affects multiple customers (possible platform bug)
- Media/social media threat from customer

### When to Escalate to the Customer's Accountant
- Journal entries that look intentional but customer doesn't understand
- Year-end closing adjustments needed
- Chart of accounts restructuring
- Tax basis or accounting method questions
- Complex multi-entity or multi-state configurations

---

## The "Resolve vs Escalate" Checklist

Before escalating, verify you've tried everything in your power:

- [ ] Checked the relevant category playbook page
- [ ] Checked edge-cases.md for cross-category patterns
- [ ] Checked error-messages.md for the specific error
- [ ] Tried the standard quick wins (clear cache, incognito, different browser)
- [ ] Asked the customer the 5 universal questions (from triage.md)
- [ ] Checked if the feature is available on the customer's subscription tier
- [ ] Looked at the Intuit status page for active outages

If you've done all of this and still can't resolve: escalate confidently. You've earned it.

---

## How to Escalate Well

A good escalation saves everyone time. Include:

1. **What you already tried** — the receiving team should never repeat your steps
2. **What you think the issue is** — even if uncertain, your hypothesis helps
3. **Customer impact** — how urgent, how many users affected, business consequences
4. **Customer expectations** — what did you tell them? When do they expect a callback?
5. **Contact info** — best callback number, timezone, preferred time

Use the `needs-investigation` template to structure your escalation documentation.

---

## Anti-Patterns (Things NOT to Do)

| Anti-Pattern | Why It's Bad | What to Do Instead |
|-------------|-------------|-------------------|
| Escalate without trying anything | Wastes the receiving team's time | Try the category playbook steps first |
| Escalate to avoid a difficult customer | The next specialist gets the same angry customer | Address the emotion first, then the technical issue |
| Escalate to "the wrong department" hoping someone figures it out | Issue bounces between teams, customer calls back furious | Use the destination guide above to route correctly |
| Tell the customer "I'm escalating to engineering" when you're not sure | Sets expectations you can't control | Say "I'm documenting this for our specialist team" |
| Escalate without documenting what you tried | Next specialist repeats everything, customer gets more frustrated | Fill out the template completely |
| Promise a callback time you can't guarantee | Customer calls back angry when deadline passes | Say "within 24-48 business hours" unless you have a specific commitment |
