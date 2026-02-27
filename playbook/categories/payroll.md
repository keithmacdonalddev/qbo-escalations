# Payroll Escalations

## Common Issues

- Vacation/sick accrual not calculating, not saving, or reverting after payroll run
- Tax amounts incorrect — wrong withholding on paychecks
- Wrong tax table being applied (state, local, or federal)
- Direct deposit setup failures or bank rejection
- Payroll won't process — stuck on "Submitting" or "Processing"
- Garnishment or deduction configuration not applying correctly
- Employee misclassified as contractor (or vice versa)
- W-2 or 1099 generation errors — missing employees, wrong amounts
- Payroll tax form filing failures (941, 940, state returns)
- Retroactive pay adjustments not calculating taxes correctly
- Terminated employee still showing as active in payroll
- Pay schedule mismatch — wrong pay dates being generated
- Overtime not calculating correctly per state rules

## Quick Diagnosis

**Always ask first:**
1. What payroll subscription? (Core, Premium, Elite) — this determines available features
2. When did it last work correctly? What changed since then?
3. Is this affecting one employee or all employees?
4. What state(s) are employees in?
5. Has any payroll been run since the issue started?

**Check these in order:**
1. **Gear icon > Payroll Settings** — verify company-level settings are correct
2. **Payroll > Employees > [Employee name] > Edit** — check individual employee setup
3. **Taxes > Payroll Tax > Tax Setup** — verify tax agencies and filing frequencies
4. **Reports > Standard > Payroll Summary** — compare expected vs actual amounts

## Common Resolutions

### Vacation/Sick Accrual Not Saving
1. Navigate: **Gear icon > Payroll Settings > Time Off Policies**
2. Verify the policy is assigned to the affected employee(s)
3. Check the "Beginning balance" date — if set after hire date, accruals may not calculate for the gap
4. Verify accrual rate: per hour worked vs per pay period vs annually
5. If accrual reverts after payroll: check if there is a conflicting policy or if the employee has exceeded the carryover maximum
6. **Common trap:** Editing the policy AFTER a payroll run does NOT retroactively adjust. Must do a payroll adjustment.

### Wrong Tax Withholding
1. **Employee > Edit > Tax withholdings** — verify W-4 information entered correctly
2. Check filing status and number of allowances/dependents
3. Verify the employee's work state matches their tax setup
4. For multi-state: ensure both work state and resident state are configured
5. **Reports > Payroll Tax and Wage Summary** — compare to expected rates
6. If rates look correct but amounts are wrong, check if employee has additional withholding or exempt status set

### Direct Deposit Failures
1. Check bank rejection reason in **Payroll > [Pay Run] > View Details**
2. Common rejection codes:
   - R01: Insufficient funds (employer account)
   - R02: Account closed
   - R03: No account/unable to locate
   - R04: Invalid account number
3. Verify routing and account numbers: **Employees > [Name] > Edit > Payment method**
4. New direct deposit setup requires 1-2 payroll cycles for bank verification (prenote period)
5. If bank recently changed: employee must re-enter DD info, old info does not carry over

### Payroll Stuck Processing
1. Do NOT re-submit — this can cause duplicate payroll
2. Check **Payroll > Payroll History** — if the run shows there, it may have completed
3. Wait 30 minutes, then refresh
4. If still stuck after 30 min: check **qbo.intuit.com/app/payroll** directly (not via navigation)
5. Clear browser cache and try in incognito window
6. If payroll is genuinely stuck, this requires Intuit Payroll Support escalation — the payroll batch may need to be released on the backend

### Employee vs Contractor Misclassification
1. **Cannot convert** an employee to contractor (or reverse) in QBO — this is by design
2. Resolution: set up the person correctly as a new employee/contractor
3. If paychecks were issued to a contractor (or 1099 payments to employee), will need:
   - Corrected tax forms (W-2c or corrected 1099)
   - Possible amended payroll tax returns
4. **Escalate to Intuit Payroll Support** for any misclassification affecting filed tax forms

### W-2/1099 Issues
1. **Payroll > Tax Forms > Annual Forms** — check if forms are available
2. W-2s typically available by January 31
3. Missing employees on W-2: verify they had at least one paycheck in the tax year
4. Wrong amounts: compare to **Payroll Tax and Wage Summary** report for the full year
5. For 1099s: verify contractor payments via **Reports > 1099 Transaction Detail**
6. If forms were already filed and need correction, this requires Intuit support

## Known QBO Bugs

<!-- Add confirmed bugs as they are encountered. Format:
### [Brief description]
- **Status**: Active / Resolved in [date]
- **Symptoms**: What the user sees
- **Workaround**: Temporary fix if available
- **Intuit Case#**: Reference number if available
-->

*No confirmed bugs documented yet. Add entries as they are identified and verified.*

## When to Escalate Further

- Payroll is stuck processing for more than 1 hour
- Tax forms were filed with incorrect amounts
- Employee/contractor misclassification affecting filed tax returns
- State tax agency sent a notice related to QBO-filed returns
- Direct deposit went to wrong account (money sent to wrong person)
- Payroll data is missing or corrupted (employees, pay runs disappeared)
- Customer needs retroactive corrections spanning multiple quarters

## Cross-References

- **[Permissions](permissions.md)** — Employee cannot see/edit their own payroll info? Check user role and payroll access settings
- **[Bank Feeds](bank-feeds.md)** — Direct deposit issues can appear as bank feed problems when transactions don't match
- **[Tax](tax.md)** — Payroll tax issues overlap with general tax configuration
- **[Billing](billing.md)** — Payroll subscription is separate from QBO subscription — check both
- **[Reports](reports.md)** — Payroll reports showing wrong data? May be a date range or filter issue, not a payroll bug
