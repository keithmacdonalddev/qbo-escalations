# Technical Escalations

## Common Issues

- QBO is slow or unresponsive — pages take a long time to load
- "Something went wrong" or "Oops" generic error messages
- Features missing from the UI after a QBO update
- Cannot log in — authentication loops, "wrong password" despite correct credentials
- Browser compatibility issues — features not working in specific browsers
- QBO app (mobile/desktop) not syncing with web version
- Print/PDF issues — invoices or reports not printing correctly
- Integrations not working (third-party apps, Zapier, API connections)
- Data import failures (CSV, QFX, IIF files)
- White screen or blank page when accessing specific features
- Multi-company switching issues — wrong company data showing
- Two-factor authentication (2FA) problems — locked out, lost device

## Quick Diagnosis

**Always ask first:**
1. What browser and version? (Chrome, Edge, Firefox, Safari — and version number)
2. What device? (Windows PC, Mac, iPad, phone)
3. Does the issue happen in incognito/private mode?
4. When did it start? Did anything change recently? (browser update, OS update, new extension)
5. Is it affecting one user or all users in the company?

**Check these in order:**
1. Check browser — QBO officially supports: Chrome (latest 3 versions), Firefox (latest 3 versions), Edge (latest 3 versions), Safari 14+
2. Test in incognito/private window with all extensions disabled
3. Check Intuit status page: https://status.quickbooks.intuit.com — verify no active outages
4. Try a different browser — if it works, the issue is browser-specific

## Common Resolutions

### QBO is Slow or Unresponsive
1. **First:** Check Intuit status page for known performance issues
2. Clear browser cache and cookies for intuit.com:
   - Chrome: Settings > Privacy > Clear browsing data > select "Cookies and other site data" + "Cached images and files" > Clear data
   - Firefox: Settings > Privacy > Cookies and Site Data > Clear Data
   - Edge: Settings > Privacy > Clear browsing data
3. Disable browser extensions — ad blockers and privacy extensions are common culprits
4. Try incognito/private mode
5. If slow only on specific features (reports, bank feeds):
   - Large data volume can cause slowdowns — narrow date ranges, use summary views
   - Bank feed connections can slow the Banking page — disconnect unused accounts
6. Check internet speed — QBO requires a stable broadband connection
7. If slow for ALL users in the company: the company file may be large. Check transaction count in **Gear icon > Account and Settings > Usage**

### Generic Error Messages ("Something went wrong")
1. Note the exact error text and any error codes
2. Clear browser cache and retry
3. Try incognito/private mode
4. Try a different browser
5. If the error is on a specific action (saving an invoice, running a report):
   - Try the action on a simpler record (new invoice with one line item)
   - If it works, the issue may be with the specific data (corrupted transaction, invalid characters)
6. Check the browser console for detailed error info (F12 > Console tab) — share with Intuit support if needed
7. If error persists across all browsers and users: this is a server-side issue. Check Intuit status page and, if no outage is reported, escalate to Intuit.

### Cannot Log In
1. Verify the correct login page: **qbo.intuit.com** (not quickbooks.com, which redirects)
2. Reset password via **"I forgot my password"** on the login page
3. If resetting password fails:
   - Check that the email address is correct (typos, work vs personal email)
   - The Intuit account may be locked after too many failed attempts — wait 30 minutes
   - If using Google/Apple sign-in: use the same sign-in method originally used to create the account
4. Authentication loop (redirects back to login):
   - Clear all cookies for intuit.com AND quickbooks.com
   - Try incognito mode
   - Disable VPN if using one (some VPNs interfere with Intuit's auth)
5. 2FA issues:
   - Lost phone: use backup codes (provided during 2FA setup)
   - If no backup codes: contact Intuit support for identity verification and 2FA reset
   - 2FA SMS not arriving: check if phone number is correct in Intuit account settings

### Print/PDF Issues
1. QBO uses the browser's built-in print dialog — not a separate print system
2. Common fixes:
   - Set print margins to "Default" or "None" in the browser print dialog
   - Use Chrome or Edge for best print results (Firefox and Safari handle print CSS differently)
   - If invoice is cutting off: **Gear icon > Account and Settings > Sales > Invoice customization > Content** — reduce font size or remove optional fields
3. For PDF export: click **Print** on the invoice/report, then select **Save as PDF** as the printer
4. If PDF is blank: disable hardware acceleration in browser settings

### Integration Issues (Third-Party Apps)
1. Check if the third-party app shows an error (each app has its own error messages)
2. Common integration issues:
   - **OAuth token expired**: the app needs to be reconnected to QBO
   - **Gear icon > Account and Settings > Connected apps** — check if the app is listed and authorized
   - If listed but not working: disconnect and reconnect
3. For popular integrations:
   - **Stripe/PayPal**: check if the payment processor account is still active
   - **Zapier**: check the Zap's trigger/action configuration and QBO connection
   - **Time tracking apps (TSheets/QB Time)**: verify the integration is enabled in Payroll settings
4. API rate limits: if the app makes many API calls, it may be rate-limited by Intuit. The app developer needs to handle this.
5. After QBO updates, some integrations may break temporarily — check the app's status page

### Data Import Failures
1. CSV import: **Gear icon > Import Data > [Transaction type]**
2. Common CSV issues:
   - Wrong column mapping — QBO guesses columns, but may guess wrong
   - Date format mismatch — use MM/DD/YYYY format
   - Amount format — no currency symbols, use negative numbers for credits
   - Extra blank rows at the end of the file
   - Special characters in names or descriptions (fix: save as UTF-8 CSV)
3. Bank file import (QFX/OFX/QBO):
   - Download the file from the bank's website (not the mobile app)
   - Some banks generate QFX files that are not strictly compliant — try OFX format instead
   - If the file opens in a browser instead of importing: right-click > Save As, then import the saved file
4. IIF files (legacy format):
   - QBO has LIMITED IIF support (primarily for lists, not transactions)
   - For transactions, use CSV import or the QBO API
   - IIF import: **Gear icon > Import Data > Import Desktop Data**

### Multi-Company Issues
1. If data from the wrong company is showing:
   - Sign out completely, clear cookies, sign back in
   - Select the correct company from the company switcher (top-left dropdown)
2. If company switcher is not showing all companies:
   - The user may have different Intuit accounts for different companies
   - Check: **accounts.intuit.com** — see which companies are associated with the current Intuit ID
3. Data does NOT transfer between company files — each company is fully isolated

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

- Persistent errors across all browsers and all users — likely server-side issue requiring Intuit engineering
- Data corruption suspected (transactions missing, amounts changed without user edits)
- Security breach concern (unauthorized access, suspicious activity)
- 2FA lockout with no backup codes and user cannot verify identity
- Integration requires API-level debugging by Intuit's partner support team

## Resolution Notes

**Resolved — Browser Issue Fixed:**
> Issue was caused by [browser cache / extension conflict / outdated browser / pop-up blocker]. Customer [cleared cache / disabled extension / updated browser / whitelisted qbo.intuit.com]. Feature now works correctly in [browser name]. Advised customer to keep browser updated and avoid extensions that modify page content.

**Resolved — Login Issue Fixed:**
> Customer was [using wrong sign-in method / had locked account / needed password reset / had 2FA issue]. [Reset password / waited 30 minutes for unlock / used backup codes / contacted Intuit for 2FA reset]. Customer can now sign in successfully.

**Resolved — Integration Reconnected:**
> [App name] was disconnected from QBO due to [expired OAuth token / changed permissions / app update]. Reconnected via Gear > Account and Settings > Connected Apps > [Disconnect and re-authorize]. Data syncing has resumed.

**Resolved — Import Successful:**
> [CSV/QFX/OFX] import was failing because [wrong date format / special characters / extra blank rows / wrong column mapping / file encoding issue]. Fixed the [issue] in the source file and re-imported. [N] transactions imported successfully.

**Resolved — Escalated:**
> Issue persists across all browsers, all users, incognito mode. This appears to be a [server-side issue / data corruption / platform bug]. Escalated to Intuit Engineering with Case #[NUMBER]. Customer advised to [workaround / wait].

## Similar Symptoms Across Categories

| Symptom | Could Also Be | How to Tell |
|---------|--------------|-------------|
| "Something went wrong" error | **Any category** — generic error can appear on any feature | Note the URL when the error appears — it tells you which module is affected |
| "Feature is missing" | **Billing** — feature requires higher tier / **Permissions** — role doesn't include access | Check subscription tier first, then user role |
| "Page won't load" | **Billing** — account suspended due to payment failure | Check if ANY QBO page loads, or just specific ones |
| "App not syncing" | **Bank Feeds** — if the "app" is a bank connection, it's a bank feed issue | Check if it's a financial institution (bank feeds) or a third-party app (technical) |
| "Can't print/export" | **Reports** — report too large for the selected format | Try a smaller date range or different export format first |

## Cross-References

- **[Bank Feeds](bank-feeds.md)** — Bank connection issues are often browser-related (pop-up blockers, extensions)
- **[Billing](billing.md)** — Billing page not loading? May be a browser issue, not a billing problem
- **[Permissions](permissions.md)** — "You don't have permission" errors may be browser cache showing stale session
- **[Reports](reports.md)** — Slow reports may be a data volume issue rather than a technical issue
