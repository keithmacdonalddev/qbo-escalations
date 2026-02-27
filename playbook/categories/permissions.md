# Permissions Escalations

## Common Issues

- User cannot access QBO after invitation — invite expired or failed
- Accountant invited but shows "Pending" indefinitely
- User can see data they should not have access to
- User cannot see or access specific features (payroll, reports, banking)
- Master admin transfer needed — original admin left the company
- Too many users — hit subscription limit
- User deleted accidentally — need to restore access
- Custom roles not working as expected (Advanced plan only)
- "You don't have permission" error on specific actions
- Accountant vs regular user confusion — wrong access level granted

## Quick Diagnosis

**Always ask first:**
1. What is the user's role? (Master Admin, Company Admin, Standard user, Reports only, Time tracking only, Accountant)
2. What specifically can they not do? (exact action, exact screen)
3. What subscription tier? (Simple Start, Essentials, Plus, Advanced — determines user limits and role options)
4. Was this a new invite, or did an existing user lose access?
5. Any recent subscription or billing changes?

**Check these in order:**
1. **Gear icon > Manage Users** — verify the user exists and their role
2. Check the user's status: Active, Invited, Deleted
3. **Gear icon > Account and Settings > Billing & Subscription** — verify user count against plan limit
4. For accountant access: **Gear icon > Manage Users > Accounting firms** tab

## Common Resolutions

### Invite Not Working / Expired
1. Invitations expire after **30 days** in QBO
2. To resend: **Gear icon > Manage Users > [User] > Resend invite** (if still showing Invited)
3. If invite expired: delete the user, then re-invite with the same email
4. Common email issues:
   - Invitation went to spam/junk folder
   - User has a different Intuit account associated with that email
   - Email address was mistyped (check for .com vs .con, extra spaces)
5. User must accept the invite from the SAME email account it was sent to
6. If user already has an Intuit account: they may need to sign in with existing credentials rather than creating a new account

### Accountant Stuck as Pending
1. Accountant invites go to the **accountant's email**, not through the regular user invite flow
2. The accountant must accept via **QuickBooks Online Accountant (QBOA)** — not regular QBO
3. Check if the accountant already has 2 accountant slots filled (per subscription limits)
4. If accountant has QBOA: they accept from their QBOA dashboard under **Client list > Accept invitation**
5. If accountant does NOT have QBOA: they need to create a free QBOA account first at quickbooks.intuit.com/accountants
6. To fix stuck invite: delete the accountant invitation, then re-invite

### User Sees Too Much Data
1. Check their role: **Gear icon > Manage Users > [User]**
2. Standard roles and what they can access:
   - **Admin**: Everything
   - **Standard (All Access)**: Most features, cannot manage users or subscriptions
   - **Standard (Limited Access)**: Only assigned customers/vendors
   - **Reports Only**: View reports, nothing else
   - **Time Tracking Only**: Enter/view own time, nothing else
3. To restrict access: edit the user's role or switch to a more limited role
4. **Note:** On Simple Start and Essentials, custom roles are NOT available. Only Plus and Advanced support granular permissions.
5. On Advanced: **Gear icon > Manage Users > Roles** — create or edit custom roles

### Master Admin Transfer
1. Only the current Master Admin can transfer the role
2. **Gear icon > Manage Users > [Current Master Admin] > Transfer Master Admin**
3. If the current Master Admin is unavailable (left company, deceased, etc.):
   - Call Intuit Support directly — this requires identity verification
   - Will need: business EIN, billing details on file, authorized signer
   - This CANNOT be done through standard escalation — requires Intuit internal process
4. Master Admin can also be transferred by the accountant if they have QBOA access and the proper permissions

### User Deleted Accidentally
1. Deleted users can be re-invited with the same email
2. Their previous transaction history, time entries, and activity remain in QBO
3. However, any user-specific settings (saved reports, dashboard customizations) are lost
4. To re-add: **Gear icon > Manage Users > Add User** — use the same email address
5. Assign the correct role during re-invitation

### "You Don't Have Permission" Error
1. Check the user's exact role: **Gear icon > Manage Users > [User]**
2. Common permission gaps:
   - Standard users cannot: manage other users, change subscription, view audit log, modify company settings
   - Reports Only users cannot: create transactions, modify data
   - Time Tracking Only users can only: enter time for themselves
3. If user needs a specific permission: either upgrade their role or (on Advanced) create a custom role
4. If the user IS an admin and still gets this error:
   - Try logging out and back in (session may be stale)
   - Clear browser cache
   - Check if the feature requires a higher subscription tier

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

- Master Admin transfer where the current admin is unreachable
- User has admin role but is blocked from critical functions (possible account-level restriction)
- Subscription shows more users than actually exist (billing discrepancy)
- Customer needs custom roles but is on Plus (custom roles require Advanced)
- Security concern: unauthorized user has access to the company file

## Cross-References

- **[Billing](billing.md)** — User limits are tied to subscription tier. Adding users may require a plan upgrade.
- **[Payroll](payroll.md)** — Payroll access is a separate permission layer — a user can have QBO access but no payroll access
- **[Reports](reports.md)** — "Reports Only" role issues often surface when users expect to be able to edit data
- **[Technical](technical.md)** — Permission errors that appear after browser cache clear or browser switch may be session-related, not actual permission issues
