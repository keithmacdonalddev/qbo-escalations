# Image Parser Scale Test - qwen/qwen3.5-9b - P20

## Scope

- Fixture set: `server/fixtures/pipeline-tests/image-parser`
- Fixture count: 11
- Provider: `llm-gateway`
- Model: `qwen/qwen3.5-9b`
- Route: `POST /api/image-parser/parse`
- Prompt file: `prompts/agents/escalation-template-parser.md`
- Prompt version during run: `P20`
- Prompt hash count during run: 1
- Current prompt version after run: `P20`
- Current prompt hash matches run: yes
- Started: 2026-05-22T16:23:40.869Z
- Finished: 2026-05-22T16:29:16.958Z

## Success Definitions

- Provider success means the app route returned HTTP 200 with `ok: true`.
- Capture success means the returned `providerPackageId` was found in Mongo.
- Canonical success means the app canonical-template validator passed.
- Clean automated parse means provider success, Mongo package found, canonical pass, parser pass, no parser issues, and at least 8 parsed fields.
- These automated scores do not prove the text is visually perfect. Exact visual correctness still needs human baseline comparison.

## Summary

- Provider route success: 11/11 (100%)
- Mongo provider package captured: 11/11 (100%)
- Canonical template pass: 10/11 (90.9%)
- Parser pass: 10/11 (90.9%)
- Clean automated parse: 6/11 (54.5%)

## Run Table

| # | Fixture | Provider OK | Mongo Package | Canonical | Parser | Fields | Issues | COID/MID Digits | First Line | Provider Package ID | Elapsed |
| --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- | --- | ---: |
| 1 | `IMG_008AC2E0-241B-4221-832D-C94E666F100A.JPEG` | yes | yes | yes | yes | 8 | missing_tsSteps | 16 | COID/MID: 9130357569572816 | `6a10830da345a018ae32722d` | 26399ms |
| 2 | `IMG_05844904-B207-4081-BBE2-AB527B8355E0.JPEG` | yes | yes | yes | yes | 8 |  | 16 | COID/MID:9341452918781988 | `6a108333a345a018ae327241` | 22157ms |
| 3 | `IMG_06048310-AEF4-4768-88EE-C5E0C7EA009B (1).JPEG` | yes | yes | yes | yes | 8 |  | 16 | COID/MID: 9341456180306625 | `6a108355a345a018ae32726a` | 17432ms |
| 4 | `IMG_0B353539-D34F-479C-A398-C26C6D1A9361.JPEG` | yes | yes | yes | yes | 9 |  | 16 | COID/MID:9341452197744835 | `6a108371a345a018ae327273` | 19112ms |
| 5 | `IMG_0D56E242-2516-485C-AA03-0B71EE3215A4.JPEG` | yes | yes | yes | yes | 9 |  | 16 | COID/MID: 9341455913004738 | `6a108390a345a018ae32728f` | 19141ms |
| 6 | `IMG_2D333EEF-9405-437F-98C5-70BCADD453F9.JPEG` | yes | yes | yes | yes | 9 |  | 16 | COID/MID: 9130351102335406 | `6a1083afa345a018ae327298` | 19748ms |
| 7 | `IMG_64BC25E3-372D-4D45-B072-9F7F3BE3A070.JPEG` | yes | yes | yes | yes | 7 | missing_tsSteps | 15 | COID/MID: 934145385791319 | `6a1083d2a345a018ae3272b4` | 18552ms |
| 8 | `IMG_A48EF4ED-74C1-4CFF-B077-E0977FA38187.JPEG` | yes | yes | no | no | 8 | canonical_FIELD_ORDER_OR_LABEL_MISMATCH, canonical_NON_CANONICAL_FIELD, canonical_EXTRA_TEXT | 16 | COID/MID:9341455743597823 | `6a1083f6a345a018ae3272bd` | 15425ms |
| 9 | `IMG_B4EC0F38-053B-41BD-A8D4-73F121CA944E.JPEG` | yes | yes | yes | yes | 9 |  | 15 | COID/MID: 934145517763883 | `6a108412a345a018ae3272d9` | 19180ms |
| 10 | `IMG_BFD049AE-F5FA-428F-96D6-698D97E82DE3.jpeg` | yes | yes | yes | yes | 8 | missing_tsSteps | 15 | COID/MID: 123146180142619 | `6a108431a345a018ae3272e2` | 11220ms |
| 11 | `IMG_EC4F1F21-8B86-4AB0-B01E-15CB9F2B8FB0.JPEG` | yes | yes | yes | yes | 7 |  | 16 | COID/MID: 9130350484590926 | `6a10844aa345a018ae3272fe` | 18737ms |

## Exact Responses

### 1. IMG_008AC2E0-241B-4221-832D-C94E666F100A.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a10830da345a018ae32722d`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 8
- Issues: missing_tsSteps
- Response id: `chatcmpl-cs4z75eknbjrhjxuzladmb`
- Finish reason: `stop`
- Elapsed: 26399ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 9130357569572816\nCASE: 15154530935\nCLIENT/CONTACT: Gayathri Manickavelu\nCX IS ATTEMPTING TO: Temniuk on this case 1515443117 adv cx to callback when she is the Company admin on file, but had created a secure file exchange portal and uploaded a pay edit file, and then closed the case. Cx was unaware that the case is closed, she spent two hours and made corrections on the csv file and uploaded it back, but the case has no updated file at all. Cx is now upset, that without her knowledge the case was closed, and she does not have a saved file on her computer, and she has to spend another two hours making changes. Cx is requesting if there is a way that we can retrieve the file she uploaded\nEXPECTED OUTCOME: cx wants to do a pay edit and had uploaded a file on case 1515443117, which does not seem to be there on the case at all, cx wants us to see if we can retrieve it somehow\nACTUAL OUTCOME: cx upset due to case being closed without letting her know, and she has a missing file now\nKB/TOOLS USED: n/a\nTRIED TEST ACCOUNT: no\nTS STEPS:"
```

Rendered `choices[0].message.content`:

```text
COID/MID: 9130357569572816
CASE: 15154530935
CLIENT/CONTACT: Gayathri Manickavelu
CX IS ATTEMPTING TO: Temniuk on this case 1515443117 adv cx to callback when she is the Company admin on file, but had created a secure file exchange portal and uploaded a pay edit file, and then closed the case. Cx was unaware that the case is closed, she spent two hours and made corrections on the csv file and uploaded it back, but the case has no updated file at all. Cx is now upset, that without her knowledge the case was closed, and she does not have a saved file on her computer, and she has to spend another two hours making changes. Cx is requesting if there is a way that we can retrieve the file she uploaded
EXPECTED OUTCOME: cx wants to do a pay edit and had uploaded a file on case 1515443117, which does not seem to be there on the case at all, cx wants us to see if we can retrieve it somehow
ACTUAL OUTCOME: cx upset due to case being closed without letting her know, and she has a missing file now
KB/TOOLS USED: n/a
TRIED TEST ACCOUNT: no
TS STEPS:
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-cs4z75eknbjrhjxuzladmb","object":"chat.completion","created":1779467021,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 9130357569572816\nCASE: 15154530935\nCLIENT/CONTACT: Gayathri Manickavelu\nCX IS ATTEMPTING TO: Temniuk on this case 1515443117 adv cx to callback when she is the Company admin on file, but had created a secure file exchange portal and uploaded a pay edit file, and then closed the case. Cx was unaware that the case is closed, she spent two hours and made corrections on the csv file and uploaded it back, but the case has no updated file at all. Cx is now upset, that without her knowledge the case was closed, and she does not have a saved file on her computer, and she has to spend another two hours making changes. Cx is requesting if there is a way that we can retrieve the file she uploaded\nEXPECTED OUTCOME: cx wants to do a pay edit and had uploaded a file on case 1515443117, which does not seem to be there on the case at all, cx wants us to see if we can retrieve it somehow\nACTUAL OUTCOME: cx upset due to case being closed without letting her know, and she has a missing file now\nKB/TOOLS USED: n/a\nTRIED TEST ACCOUNT: no\nTS STEPS:","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":302,"total_tokens":3548,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":302,"total_tokens":3548},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.00755,"total_cost_usd":0.02378,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.60634,"total_granted_usd":10100,"total_charged_usd":3.39366}}}
```

### 2. IMG_05844904-B207-4081-BBE2-AB527B8355E0.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a108333a345a018ae327241`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 8
- Issues: none
- Response id: `chatcmpl-5xzkqe67rqf53s0sluh0jk`
- Finish reason: `stop`
- Elapsed: 22157ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID:9341452918781988\nCASE:1515488745\nCLIENT/CONTACT:Bassam Ibrahim\nCX IS ATTEMPTING TO:Asking to remove CPP from all Active and 2 terminated EE because they feel they should not have CPP removed because they have not made 3500.00 in gross earnings at the beginning of last years payruns\nEXPECTED OUTCOME:Remove CPP from all active EE and 2 Terminated EE's because they did not make 3500 gross and CPP was deducted\nACTUAL OUTCOME:Cpp was charged to all Active and 2 Terminated EE's\nKB/TOOLS USED:expert access\nTRIED TEST ACCOUNT:\nTS STEPS:On screen with customer he shows me the paycheques from Jan 2025 and CPP is deducted and he feels it should not be because they have not met the 3500.00 gross wages yet for CPP to be deducted"
```

Rendered `choices[0].message.content`:

```text
COID/MID:9341452918781988
CASE:1515488745
CLIENT/CONTACT:Bassam Ibrahim
CX IS ATTEMPTING TO:Asking to remove CPP from all Active and 2 terminated EE because they feel they should not have CPP removed because they have not made 3500.00 in gross earnings at the beginning of last years payruns
EXPECTED OUTCOME:Remove CPP from all active EE and 2 Terminated EE's because they did not make 3500 gross and CPP was deducted
ACTUAL OUTCOME:Cpp was charged to all Active and 2 Terminated EE's
KB/TOOLS USED:expert access
TRIED TEST ACCOUNT:
TS STEPS:On screen with customer he shows me the paycheques from Jan 2025 and CPP is deducted and he feels it should not be because they have not met the 3500.00 gross wages yet for CPP to be deducted
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-5xzkqe67rqf53s0sluh0jk","object":"chat.completion","created":1779467059,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID:9341452918781988\nCASE:1515488745\nCLIENT/CONTACT:Bassam Ibrahim\nCX IS ATTEMPTING TO:Asking to remove CPP from all Active and 2 terminated EE because they feel they should not have CPP removed because they have not made 3500.00 in gross earnings at the beginning of last years payruns\nEXPECTED OUTCOME:Remove CPP from all active EE and 2 Terminated EE's because they did not make 3500 gross and CPP was deducted\nACTUAL OUTCOME:Cpp was charged to all Active and 2 Terminated EE's\nKB/TOOLS USED:expert access\nTRIED TEST ACCOUNT:\nTS STEPS:On screen with customer he shows me the paycheques from Jan 2025 and CPP is deducted and he feels it should not be because they have not met the 3500.00 gross wages yet for CPP to be deducted","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":220,"total_tokens":3466,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":220,"total_tokens":3466},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.0055,"total_cost_usd":0.02173,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.58461,"total_granted_usd":10100,"total_charged_usd":3.41539}}}
```

### 3. IMG_06048310-AEF4-4768-88EE-C5E0C7EA009B (1).JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a108355a345a018ae32726a`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 8
- Issues: none
- Response id: `chatcmpl-imqiqqyj6zfngutjzz41dm`
- Finish reason: `stop`
- Elapsed: 17432ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 9341456180306625\nCASE: 15154547445\nCLIENT/CONTACT: Jenny Breau\nCX IS ATTEMPTING TO: change vacation accrual from 8% to 6%\nEXPECTED OUTCOME: set vacation accrual to 6%\nACTUAL OUTCOME: customer changes the vacation accrual to 6% and clicks save but it doesn't save the change and switches back to 8%\nKB/TOOLS USED: \nTRIED TEST ACCOUNT: \nTS STEPS: diff browser, incognito, i tried to update in expert access and it did the same thing. tried a different device and different user."
```

Rendered `choices[0].message.content`:

```text
COID/MID: 9341456180306625
CASE: 15154547445
CLIENT/CONTACT: Jenny Breau
CX IS ATTEMPTING TO: change vacation accrual from 8% to 6%
EXPECTED OUTCOME: set vacation accrual to 6%
ACTUAL OUTCOME: customer changes the vacation accrual to 6% and clicks save but it doesn't save the change and switches back to 8%
KB/TOOLS USED:
TRIED TEST ACCOUNT:
TS STEPS: diff browser, incognito, i tried to update in expert access and it did the same thing. tried a different device and different user.
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-imqiqqyj6zfngutjzz41dm","object":"chat.completion","created":1779467093,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 9341456180306625\nCASE: 15154547445\nCLIENT/CONTACT: Jenny Breau\nCX IS ATTEMPTING TO: change vacation accrual from 8% to 6%\nEXPECTED OUTCOME: set vacation accrual to 6%\nACTUAL OUTCOME: customer changes the vacation accrual to 6% and clicks save but it doesn't save the change and switches back to 8%\nKB/TOOLS USED: \nTRIED TEST ACCOUNT: \nTS STEPS: diff browser, incognito, i tried to update in expert access and it did the same thing. tried a different device and different user.","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":158,"total_tokens":3404,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":158,"total_tokens":3404},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.00395,"total_cost_usd":0.02018,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.56443,"total_granted_usd":10100,"total_charged_usd":3.43557}}}
```

### 4. IMG_0B353539-D34F-479C-A398-C26C6D1A9361.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a108371a345a018ae327273`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 9
- Issues: none
- Response id: `chatcmpl-hx26dk3ekivtrenii6fr3l`
- Finish reason: `stop`
- Elapsed: 19112ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID:9341452197744835\nCASE:1514531492\nCLIENT/CONTACT:Claude Klogo Nyatepe K.\nCX IS ATTEMPTING TO:Customer is calling to download the XML for his T4 but for some reason it didn't download the T4 summary when he downloaded the XMI\nEXPECTED OUTCOME:wanted to send in his T4 to CRA\nACTUAL OUTCOME:missing the T4 summary\nKB/TOOLS USED:HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.\nTRIED TEST ACCOUNT:n/a\nTS STEPS:Cust0mer is calling about to download his T4 to CRA when he downloaded the T4 XML the T4 summary didn't download the summary I have gone in and went to the archived and deleted it and try to get it to repopulate but it didn't work"
```

Rendered `choices[0].message.content`:

```text
COID/MID:9341452197744835
CASE:1514531492
CLIENT/CONTACT:Claude Klogo Nyatepe K.
CX IS ATTEMPTING TO:Customer is calling to download the XML for his T4 but for some reason it didn't download the T4 summary when he downloaded the XMI
EXPECTED OUTCOME:wanted to send in his T4 to CRA
ACTUAL OUTCOME:missing the T4 summary
KB/TOOLS USED:HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.
TRIED TEST ACCOUNT:n/a
TS STEPS:Cust0mer is calling about to download his T4 to CRA when he downloaded the T4 XML the T4 summary didn't download the summary I have gone in and went to the archived and deleted it and try to get it to repopulate but it didn't work
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-hx26dk3ekivtrenii6fr3l","object":"chat.completion","created":1779467121,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID:9341452197744835\nCASE:1514531492\nCLIENT/CONTACT:Claude Klogo Nyatepe K.\nCX IS ATTEMPTING TO:Customer is calling to download the XML for his T4 but for some reason it didn't download the T4 summary when he downloaded the XMI\nEXPECTED OUTCOME:wanted to send in his T4 to CRA\nACTUAL OUTCOME:missing the T4 summary\nKB/TOOLS USED:HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.\nTRIED TEST ACCOUNT:n/a\nTS STEPS:Cust0mer is calling about to download his T4 to CRA when he downloaded the T4 XML the T4 summary didn't download the summary I have gone in and went to the archived and deleted it and try to get it to repopulate but it didn't work","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":197,"total_tokens":3443,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":197,"total_tokens":3443},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.004925,"total_cost_usd":0.021155,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.543275,"total_granted_usd":10100,"total_charged_usd":3.456725}}}
```

### 5. IMG_0D56E242-2516-485C-AA03-0B71EE3215A4.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a108390a345a018ae32728f`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 9
- Issues: none
- Response id: `chatcmpl-lpmvdq478ddt3s9m3kgug`
- Finish reason: `stop`
- Elapsed: 19141ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 9341455913004738\nCASE: 15154512220\nCLIENT/CONTACT: Lan Tat\nCX IS ATTEMPTING TO: Bringing in data from Corfix, a connected app. Services do not get populated correctly in weekly timesheet. Also, cx asks the sequence of listing customers in timesheet\nEXPECTED OUTCOME: Correct services should be populated. Wants to know sequence\nACTUAL OUTCOME: Currently, services that cx sees in Corfix do not match with QB and sequence is random not day wise\nKB/TOOLS USED: SF, QB Admin Tool, SS, Google\nTRIED TEST ACCOUNT: Yes\nTS STEPS: Checked multiple timesheets, most do not have correct services, sequence is random"
```

Rendered `choices[0].message.content`:

```text
COID/MID: 9341455913004738
CASE: 15154512220
CLIENT/CONTACT: Lan Tat
CX IS ATTEMPTING TO: Bringing in data from Corfix, a connected app. Services do not get populated correctly in weekly timesheet. Also, cx asks the sequence of listing customers in timesheet
EXPECTED OUTCOME: Correct services should be populated. Wants to know sequence
ACTUAL OUTCOME: Currently, services that cx sees in Corfix do not match with QB and sequence is random not day wise
KB/TOOLS USED: SF, QB Admin Tool, SS, Google
TRIED TEST ACCOUNT: Yes
TS STEPS: Checked multiple timesheets, most do not have correct services, sequence is random
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-lpmvdq478ddt3s9m3kgug","object":"chat.completion","created":1779467152,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 9341455913004738\nCASE: 15154512220\nCLIENT/CONTACT: Lan Tat\nCX IS ATTEMPTING TO: Bringing in data from Corfix, a connected app. Services do not get populated correctly in weekly timesheet. Also, cx asks the sequence of listing customers in timesheet\nEXPECTED OUTCOME: Correct services should be populated. Wants to know sequence\nACTUAL OUTCOME: Currently, services that cx sees in Corfix do not match with QB and sequence is random not day wise\nKB/TOOLS USED: SF, QB Admin Tool, SS, Google\nTRIED TEST ACCOUNT: Yes\nTS STEPS: Checked multiple timesheets, most do not have correct services, sequence is random","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":172,"total_tokens":3418,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":172,"total_tokens":3418},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.0043,"total_cost_usd":0.02053,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.522745,"total_granted_usd":10100,"total_charged_usd":3.477255}}}
```

### 6. IMG_2D333EEF-9405-437F-98C5-70BCADD453F9.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a1083afa345a018ae327298`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 9
- Issues: none
- Response id: `chatcmpl-rysgwj200niltuuyjr4zio`
- Finish reason: `stop`
- Elapsed: 19748ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 9130351102335406\nCASE: 15154505320\nCLIENT/CONTACT: Imaduddin Hyder Mohammed M.\nCX IS ATTEMPTING TO: cx has been charged 2 transactions on her account by intuit on jan 14, 2025 1st transaction 25$, 2nd transaction 3,062.80\nEXPECTED OUTCOME: to know the reason for the charge and get back the refund\nACTUAL OUTCOME: cx was linked to a wrong INV before and now she didn't receive any update on the INV\nKB/TOOLS USED: NA\nTRIED TEST ACCOUNT: NA\nTS STEPS: checked the old case and found that cx was linked to other customer specific INV due to which she didn't receive any updates"
```

Rendered `choices[0].message.content`:

```text
COID/MID: 9130351102335406
CASE: 15154505320
CLIENT/CONTACT: Imaduddin Hyder Mohammed M.
CX IS ATTEMPTING TO: cx has been charged 2 transactions on her account by intuit on jan 14, 2025 1st transaction 25$, 2nd transaction 3,062.80
EXPECTED OUTCOME: to know the reason for the charge and get back the refund
ACTUAL OUTCOME: cx was linked to a wrong INV before and now she didn't receive any update on the INV
KB/TOOLS USED: NA
TRIED TEST ACCOUNT: NA
TS STEPS: checked the old case and found that cx was linked to other customer specific INV due to which she didn't receive any updates
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-rysgwj200niltuuyjr4zio","object":"chat.completion","created":1779467183,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 9130351102335406\nCASE: 15154505320\nCLIENT/CONTACT: Imaduddin Hyder Mohammed M.\nCX IS ATTEMPTING TO: cx has been charged 2 transactions on her account by intuit on jan 14, 2025 1st transaction 25$, 2nd transaction 3,062.80\nEXPECTED OUTCOME: to know the reason for the charge and get back the refund\nACTUAL OUTCOME: cx was linked to a wrong INV before and now she didn't receive any update on the INV\nKB/TOOLS USED: NA\nTRIED TEST ACCOUNT: NA\nTS STEPS: checked the old case and found that cx was linked to other customer specific INV due to which she didn't receive any updates","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":189,"total_tokens":3435,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":189,"total_tokens":3435},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.004725,"total_cost_usd":0.020955,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.50179,"total_granted_usd":10100,"total_charged_usd":3.49821}}}
```

### 7. IMG_64BC25E3-372D-4D45-B072-9F7F3BE3A070.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a1083d2a345a018ae3272b4`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 7
- Issues: missing_tsSteps
- Response id: `chatcmpl-noc6h8xhq2acio7fz4ll3`
- Finish reason: `stop`
- Elapsed: 18552ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 934145385791319\nCASE: 15154505915\nCLIENT/CONTACT: alicepoirier15@gmail.com\nCX IS ATTEMPTING TO: connect as MA doesn't exist no more and is logged in with a new email address but she is the CA on that... So sending her MA claim to recover her account But cx wants to downgrade subs to easy start.. can we do that as she can't at the moment ? or...\nEXPECTED OUTCOME: Downgrade subscription to easy start\nACTUAL OUTCOME: Unable to--No autorisation\nKB/TOOLS USED: New email:alicepoirier15@gmail.com\nTRIED TEST ACCOUNT: \nTS STEPS:"
```

Rendered `choices[0].message.content`:

```text
COID/MID: 934145385791319
CASE: 15154505915
CLIENT/CONTACT: alicepoirier15@gmail.com
CX IS ATTEMPTING TO: connect as MA doesn't exist no more and is logged in with a new email address but she is the CA on that... So sending her MA claim to recover her account But cx wants to downgrade subs to easy start.. can we do that as she can't at the moment ? or...
EXPECTED OUTCOME: Downgrade subscription to easy start
ACTUAL OUTCOME: Unable to--No autorisation
KB/TOOLS USED: New email:alicepoirier15@gmail.com
TRIED TEST ACCOUNT:
TS STEPS:
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-noc6h8xhq2acio7fz4ll3","object":"chat.completion","created":1779467218,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 934145385791319\nCASE: 15154505915\nCLIENT/CONTACT: alicepoirier15@gmail.com\nCX IS ATTEMPTING TO: connect as MA doesn't exist no more and is logged in with a new email address but she is the CA on that... So sending her MA claim to recover her account But cx wants to downgrade subs to easy start.. can we do that as she can't at the moment ? or...\nEXPECTED OUTCOME: Downgrade subscription to easy start\nACTUAL OUTCOME: Unable to--No autorisation\nKB/TOOLS USED: New email:alicepoirier15@gmail.com\nTRIED TEST ACCOUNT: \nTS STEPS:","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":168,"total_tokens":3414,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":168,"total_tokens":3414},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.0042,"total_cost_usd":0.02043,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.48136,"total_granted_usd":10100,"total_charged_usd":3.51864}}}
```

### 8. IMG_A48EF4ED-74C1-4CFF-B077-E0977FA38187.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a1083f6a345a018ae3272bd`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: no
- Parser passed: no
- Fields found: 8
- Issues: canonical_FIELD_ORDER_OR_LABEL_MISMATCH, canonical_NON_CANONICAL_FIELD, canonical_EXTRA_TEXT
- Response id: `chatcmpl-ic1b30otcsnujn1t3qoel`
- Finish reason: `stop`
- Elapsed: 15425ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID:9341455743597823\nCASE:15154491216\nCLIENT/CONTACT:Dharmika Mithaiwala\nCX IS ATTEMPTING TO:Payroll suspended\nEXPECTED OUTCOME:vbd reset\nACTUAL OUTCOME:IDV - 15149615753 case completed, uploaded the supported documents\nKB/TOOLS USER:n/a\nTRIED IN TEST ACCOUNT:n/a\nTS STEPS: checked Bank Account Setup : SUSPENDED"
```

Rendered `choices[0].message.content`:

```text
COID/MID:9341455743597823
CASE:15154491216
CLIENT/CONTACT:Dharmika Mithaiwala
CX IS ATTEMPTING TO:Payroll suspended
EXPECTED OUTCOME:vbd reset
ACTUAL OUTCOME:IDV - 15149615753 case completed, uploaded the supported documents
KB/TOOLS USER:n/a
TRIED IN TEST ACCOUNT:n/a
TS STEPS: checked Bank Account Setup : SUSPENDED
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-ic1b30otcsnujn1t3qoel","object":"chat.completion","created":1779467254,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID:9341455743597823\nCASE:15154491216\nCLIENT/CONTACT:Dharmika Mithaiwala\nCX IS ATTEMPTING TO:Payroll suspended\nEXPECTED OUTCOME:vbd reset\nACTUAL OUTCOME:IDV - 15149615753 case completed, uploaded the supported documents\nKB/TOOLS USER:n/a\nTRIED IN TEST ACCOUNT:n/a\nTS STEPS: checked Bank Account Setup : SUSPENDED","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":124,"total_tokens":3370,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":124,"total_tokens":3370},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.0031,"total_cost_usd":0.01933,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.46203,"total_granted_usd":10100,"total_charged_usd":3.53797}}}
```

### 9. IMG_B4EC0F38-053B-41BD-A8D4-73F121CA944E.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a108412a345a018ae3272d9`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 9
- Issues: none
- Response id: `chatcmpl-11ulczt3tvdq8mutd1yxmh`
- Finish reason: `stop`
- Elapsed: 19180ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center."
```

Rendered `choices[0].message.content`:

```text
COID/MID: 934145517763883
CASE: 15159891330
CLIENT/CONTACT: Alicia Aiello
CX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments
EXPECTED OUTCOME: is supposed to be 0
ACTUAL OUTCOME: is currently showing -$622.51
KB/TOOLS USED: SS, google
TRIED TEST ACCOUNT: N/A
TS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center.
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-11ulczt3tvdq8mutd1yxmh","object":"chat.completion","created":1779467282,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center.","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":177,"total_tokens":3423,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":177,"total_tokens":3423},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.004425,"total_cost_usd":0.020655,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.441375,"total_granted_usd":10100,"total_charged_usd":3.558625}}}
```

### 10. IMG_BFD049AE-F5FA-428F-96D6-698D97E82DE3.jpeg

- Route status: 200
- Provider OK: yes
- Provider package id: `6a108431a345a018ae3272e2`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 8
- Issues: missing_tsSteps
- Response id: `chatcmpl-fqlckhphgaodhgpq3vu9am`
- Finish reason: `stop`
- Elapsed: 11220ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 123146180142619\nCASE: 15155056959\nCLIENT/CONTACT: Charlotte\nCX IS ATTEMPTING TO: Create a report for Credit Memos\nEXPECTED OUTCOME: Create a report that shows all credit memos for the CX's clients\nACTUAL OUTCOME: Because of the way QBO registers Credit memos, i dont think we can do this, in custom reports tehre is no way to select a credit memo\nKB/TOOLS USED: Smartlook\nTRIED TEST ACCOUNT: N/A\nTS STEPS:"
```

Rendered `choices[0].message.content`:

```text
COID/MID: 123146180142619
CASE: 15155056959
CLIENT/CONTACT: Charlotte
CX IS ATTEMPTING TO: Create a report for Credit Memos
EXPECTED OUTCOME: Create a report that shows all credit memos for the CX's clients
ACTUAL OUTCOME: Because of the way QBO registers Credit memos, i dont think we can do this, in custom reports tehre is no way to select a credit memo
KB/TOOLS USED: Smartlook
TRIED TEST ACCOUNT: N/A
TS STEPS:
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-fqlckhphgaodhgpq3vu9am","object":"chat.completion","created":1779467313,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 123146180142619\nCASE: 15155056959\nCLIENT/CONTACT: Charlotte\nCX IS ATTEMPTING TO: Create a report for Credit Memos\nEXPECTED OUTCOME: Create a report that shows all credit memos for the CX's clients\nACTUAL OUTCOME: Because of the way QBO registers Credit memos, i dont think we can do this, in custom reports tehre is no way to select a credit memo\nKB/TOOLS USED: Smartlook\nTRIED TEST ACCOUNT: N/A\nTS STEPS:","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":1902,"completion_tokens":137,"total_tokens":2039,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":1902,"completion_tokens":137,"total_tokens":2039},"cost":{"currency":"USD","prompt_cost_usd":0.00951,"completion_cost_usd":0.003425,"total_cost_usd":0.012935,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.42844,"total_granted_usd":10100,"total_charged_usd":3.57156}}}
```

### 11. IMG_EC4F1F21-8B86-4AB0-B01E-15CB9F2B8FB0.JPEG

- Route status: 200
- Provider OK: yes
- Provider package id: `6a10844aa345a018ae3272fe`
- Mongo package found: yes
- Prompt version: `P20`
- Canonical template passed: yes
- Parser passed: yes
- Fields found: 7
- Issues: none
- Response id: `chatcmpl-a4j3xsqh3r9hyybr27tg2b`
- Finish reason: `stop`
- Elapsed: 18737ms

Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 9130350484590926\nCASE: 15154529119\nCLIENT/CONTACT: oumeima hammadi\nCX IS ATTEMPTING TO: Cx has payroll sync issues with error message \"Account with name Dépôt direct payable and id 129 is not present, please restore to sync the transactions again\" and wants to know how to fix it\nEXPECTED OUTCOME: \nACTUAL OUTCOME: can't match her paycheques to her bank transactions\nKB/TOOLS USED: N/A\nTRIED TEST ACCOUNT: \nTS STEPS: Attempted to fix sync issue through Cs Server but still get the same error message, checked with cx in COA and the mentioned account is active"
```

Rendered `choices[0].message.content`:

```text
COID/MID: 9130350484590926
CASE: 15154529119
CLIENT/CONTACT: oumeima hammadi
CX IS ATTEMPTING TO: Cx has payroll sync issues with error message "Account with name Dépôt direct payable and id 129 is not present, please restore to sync the transactions again" and wants to know how to fix it
EXPECTED OUTCOME:
ACTUAL OUTCOME: can't match her paycheques to her bank transactions
KB/TOOLS USED: N/A
TRIED TEST ACCOUNT:
TS STEPS: Attempted to fix sync issue through Cs Server but still get the same error message, checked with cx in COA and the mentioned account is active
```

Exact provider response body from Mongo:

```json
{"id":"chatcmpl-a4j3xsqh3r9hyybr27tg2b","object":"chat.completion","created":1779467338,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 9130350484590926\nCASE: 15154529119\nCLIENT/CONTACT: oumeima hammadi\nCX IS ATTEMPTING TO: Cx has payroll sync issues with error message \"Account with name Dépôt direct payable and id 129 is not present, please restore to sync the transactions again\" and wants to know how to fix it\nEXPECTED OUTCOME: \nACTUAL OUTCOME: can't match her paycheques to her bank transactions\nKB/TOOLS USED: N/A\nTRIED TEST ACCOUNT: \nTS STEPS: Attempted to fix sync issue through Cs Server but still get the same error message, checked with cx in COA and the mentioned account is active","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":170,"total_tokens":3416,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":170,"total_tokens":3416},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.00425,"total_cost_usd":0.02048,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.40796,"total_granted_usd":10100,"total_charged_usd":3.59204}}}
```

## Raw Result Artifact

- JSONL: `provider-harness-research/prompt-testing/image-parser-qwen-qwen3.5-9b-p20-scale-test-20260522-132311.jsonl`