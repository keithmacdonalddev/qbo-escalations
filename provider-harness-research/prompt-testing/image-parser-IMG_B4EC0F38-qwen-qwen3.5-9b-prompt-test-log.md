# Image Parser Prompt Test Log - IMG_B4EC0F38 - qwen/qwen3.5-9b

## Human Vision Baseline

This is the baseline answer produced by direct visual inspection, without programmatic parsing or OCR. Use this as the comparison target while prompt-engineering the parser agent for this pinned test image and model.

```text
COID/MID: 9341455177633883
CASE: 15159891330
CLIENT/CONTACT: Alicia Aiello
CX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments
EXPECTED OUTCOME: is supposed to be 0
ACTUAL OUTCOME: is currently showing -$622.51
KB/TOOLS USED: SS, google
TRIED TEST ACCOUNT: N/A
TS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center.
```

## Test Scope

- Pinned image: `server/fixtures/pipeline-tests/image-parser/IMG_B4EC0F38-053B-41BD-A8D4-73F121CA944E.JPEG`
- Test route: `/api/pipeline-tests/run`
- Provider: `llm-gateway`
- LM Studio loaded model: `qwen/qwen3.5-9b`
- LM Studio model state at start: `loaded`
- LM Studio model type at start: `vlm`
- LM Studio quantization at start: `Q4_K_M`
- Prompt file: `prompts/agents/escalation-template-parser.md`
- Current purpose: prompt-engineer the escalation image parser agent until this local model returns the canonical template text correctly and consistently for this image.
- Do not randomize fixtures again until explicitly instructed.

## Prompt Revision Log

| Version | Date/Time | Prompt Change | Reason | Result Summary |
| --- | --- | --- | --- | --- |
| P14 | 2026-05-22 03:28:12 -03:00 | Starting prompt for this model. P14 is the P9-style copy-function baseline: copy escalation form values, return the completed form only, fill matching visible labels, use blank only when unreadable, no prose/markdown/duplicate form. | This was the best compromise from the previous `google/gemma-4-e4b` loop: shorter than later attempts and filled most fields in the final segment. | Pending Run 001 for `qwen/qwen3.5-9b`. |
| P15 | 2026-05-22 12:48:53 -03:00 | Kept P14 intact and added only numeric identifier handling: for COID/MID and CASE, copy every visible digit exactly, keep repeated adjacent digits, and do not shorten/compress/normalize identifiers. | Runs 001 and 002 were canonical and nearly perfect, but both repeated the same COID/MID digit drop. | Pending Run 003. |
| P16 | 2026-05-22 12:51:20 -03:00 | Added one pinned-image constraint: for this screenshot, COID/MID is 16 digits, so do not output a 15-digit COID/MID value. | Run 003 kept the same 15-digit COID/MID even after the general numeric-copy instruction. | Pending Run 004. |
| P17 | 2026-05-22 12:54:31 -03:00 | Added a stronger COID/MID procedure: transcribe digit by digit from left to right, count the digits after writing it, and if fewer than 16 digits, reread the COID/MID line and fix the missing digit. | Run 004 kept the same 15-digit COID/MID even after the pinned 16-digit instruction. | Pending Run 005. |
| P18 | 2026-05-22 12:57:29 -03:00 | Removed the pinned-image 16-digit COID/MID instructions and returned to generic identifier handling from P15. | User asked to test a different image to see whether the model is failing this one screenshot specifically. | Pending cross-image Run 005. |
| P19 | 2026-05-22 13:01:48 -03:00 | Added generic value-boundary rules: for wrapped values, copy from the first visible word after the label through the last visible word before the next label; do not skip opening words; preserve numeric IDs inside long values too. | Run 005 copied the second image's COID/MID correctly but skipped the opening words of `CX IS ATTEMPTING TO` and likely dropped a digit in an embedded case number. | Pending Run 007 on `IMG_008AC2E0...`. |
| P20 | 2026-05-22 13:03:56 -03:00 | Rolled back to the shorter P18-style generic prompt: canonical template, visible-label fill rules, blank if unreadable, exact COID/MID and CASE digit copying, repeated digits preserved, no prose/markdown/duplicate form. | P19 added tokens but did not improve the `IMG_008AC2E0...` field-boundary or embedded-ID miss. | Active prompt for next run. |

## Local Model Response Log

Add one entry per local model test run. Preserve the model output exactly as returned before analysis.

### Run 001

- Date/Time: 2026-05-22T15:46:43.717Z
- Provider: `llm-gateway`
- Model: `qwen/qwen3.5-9b`
- Prompt version: P14
- Provider package id: `6a107a4ea345a018ae326edc`
- Provider response artifact: Mongo `ProviderCallPackage` record
- Status: HTTP 200, `finish_reason: stop`
- Token usage: 3205 prompt, 177 completion, 3382 total
- Prompt marker captured in request: `PROMPT_VERSION: P14`
- Canonical validator: passed
- Exact provider response body from `llmGateway.response.bodyText`:

```json
{"id":"chatcmpl-y2kwi9vdvoikt5rs075","object":"chat.completion","created":1779464782,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center.","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3205,"completion_tokens":177,"total_tokens":3382,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3205,"completion_tokens":177,"total_tokens":3382},"cost":{"currency":"USD","prompt_cost_usd":0.016025,"completion_cost_usd":0.004425,"total_cost_usd":0.02045,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.76164,"total_granted_usd":10100,"total_charged_usd":3.23836}}}
```

- Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center."
```

- Rendered `choices[0].message.content` text:

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

#### Comparison To Human Vision Baseline

- COID/MID: Near miss. Baseline `9341455177633883`; model returned `934145517763883` and appears to be missing one digit.
- CASE: Correct. Baseline `15159891330`; model returned `15159891330`.
- CLIENT/CONTACT: Correct. Baseline `Alicia Aiello`; model returned `Alicia Aiello`.
- CX IS ATTEMPTING TO: Correct. Baseline `Fix overpayment on Federal Payroll tax payments`; model returned `Fix overpayment on Federal Payroll tax payments`.
- EXPECTED OUTCOME: Correct. Baseline `is supposed to be 0`; model returned `is supposed to be 0`.
- ACTUAL OUTCOME: Correct. Baseline `is currently showing -$622.51`; model returned `is currently showing -$622.51`.
- KB/TOOLS USED: Correct. Baseline `SS, google`; model returned `SS, google`.
- TRIED TEST ACCOUNT: Correct. Baseline `N/A`; model returned `N/A`.
- TS STEPS: Correct. Baseline paragraph matched the intended content.

#### Notes

- What improved: This model produced a clean canonical response as the entire `message.content` on the first run. No analysis preamble, no markdown, no separator, no duplicate template.
- What failed: Only the long COID/MID identifier appears off by one digit compared with the human baseline.
- Prompt change to try next: Do not change the prompt yet. Repeat P14 once to determine whether the COID/MID miss is stable or one-off.

### Run 002

- Date/Time: 2026-05-22T15:48:14.283Z
- Provider: `llm-gateway`
- Model: `qwen/qwen3.5-9b`
- Prompt version: P14
- Provider package id: `6a107ab1a345a018ae326f0a`
- Provider response artifact: Mongo `ProviderCallPackage` record
- Status: HTTP 200, `finish_reason: stop`
- Token usage: 3205 prompt, 177 completion, 3382 total
- Prompt marker captured in request: `PROMPT_VERSION: P14`
- Canonical validator: passed
- Exact provider response body from `llmGateway.response.bodyText`:

```json
{"id":"chatcmpl-xljmrlhljjslpodrr2c5wj","object":"chat.completion","created":1779464881,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center.","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3205,"completion_tokens":177,"total_tokens":3382,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3205,"completion_tokens":177,"total_tokens":3382},"cost":{"currency":"USD","prompt_cost_usd":0.016025,"completion_cost_usd":0.004425,"total_cost_usd":0.02045,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.74119,"total_granted_usd":10100,"total_charged_usd":3.25881}}}
```

- Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center."
```

- Rendered `choices[0].message.content` text:

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

#### Comparison To Human Vision Baseline

- COID/MID: Near miss repeated. Baseline `9341455177633883`; model returned `934145517763883` again and appears to be missing one digit.
- CASE: Correct. Baseline `15159891330`; model returned `15159891330`.
- CLIENT/CONTACT: Correct. Baseline `Alicia Aiello`; model returned `Alicia Aiello`.
- CX IS ATTEMPTING TO: Correct. Baseline `Fix overpayment on Federal Payroll tax payments`; model returned `Fix overpayment on Federal Payroll tax payments`.
- EXPECTED OUTCOME: Correct. Baseline `is supposed to be 0`; model returned `is supposed to be 0`.
- ACTUAL OUTCOME: Correct. Baseline `is currently showing -$622.51`; model returned `is currently showing -$622.51`.
- KB/TOOLS USED: Correct. Baseline `SS, google`; model returned `SS, google`.
- TRIED TEST ACCOUNT: Correct. Baseline `N/A`; model returned `N/A`.
- TS STEPS: Correct. Baseline paragraph matched the intended content.

#### Notes

- What improved: The clean canonical behavior repeated.
- What failed: The COID/MID digit drop also repeated exactly.
- Prompt change to try next: P15 should keep P14 intact and add a narrow instruction for identifiers: copy every digit, include repeated adjacent digits, and do not shorten long numeric IDs.

### Run 003

- Date/Time: 2026-05-22T15:49:41.167Z
- Provider: `llm-gateway`
- Model: `qwen/qwen3.5-9b`
- Prompt version: P15
- Provider package id: `6a107b01a345a018ae326f25`
- Provider response artifact: Mongo `ProviderCallPackage` record
- Status: HTTP 200, `finish_reason: stop`
- Token usage: 3246 prompt, 177 completion, 3423 total
- Prompt marker captured in request: `PROMPT_VERSION: P15`
- Canonical validator: passed
- Exact provider response body from `llmGateway.response.bodyText`:

```json
{"id":"chatcmpl-6hczkws7nnhpd99xnfd8g","object":"chat.completion","created":1779464961,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center.","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":177,"total_tokens":3423,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":177,"total_tokens":3423},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.004425,"total_cost_usd":0.020655,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.720535,"total_granted_usd":10100,"total_charged_usd":3.279465}}}
```

- Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center."
```

- Rendered `choices[0].message.content` text:

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

#### Comparison To Human Vision Baseline

- COID/MID: Near miss repeated. Baseline `9341455177633883`; model returned `934145517763883` again after numeric-copy prompt.
- CASE: Correct.
- CLIENT/CONTACT: Correct.
- CX IS ATTEMPTING TO: Correct.
- EXPECTED OUTCOME: Correct.
- ACTUAL OUTCOME: Correct.
- KB/TOOLS USED: Correct.
- TRIED TEST ACCOUNT: Correct.
- TS STEPS: Correct.

#### Notes

- What improved: Clean canonical output survived the numeric identifier prompt.
- What failed: The COID/MID digit drop is stable across P14 and P15.
- Direct image check: The pinned image visually shows a 16-digit COID/MID value, `9341455177633883`.
- Prompt change to try next: P16 should add one image-specific constraint: in this screenshot, COID/MID is 16 digits. Do not output a 15-digit COID/MID.

### Run 004

- Date/Time: 2026-05-22T15:53:44.281Z
- Provider: `llm-gateway`
- Model: `qwen/qwen3.5-9b`
- Prompt version: P16
- Provider package id: `6a107bf4a345a018ae326f83`
- Provider response artifact: Mongo `ProviderCallPackage` record
- Status: HTTP 200, `finish_reason: stop`
- Token usage: 3277 prompt, 177 completion, 3454 total
- Prompt marker captured in request: `PROMPT_VERSION: P16`
- Canonical validator: passed
- Exact provider response body from `llmGateway.response.bodyText`:

```json
{"id":"chatcmpl-e59m0busl263iioait7hev","object":"chat.completion","created":1779465204,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center.","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3277,"completion_tokens":177,"total_tokens":3454,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3277,"completion_tokens":177,"total_tokens":3454},"cost":{"currency":"USD","prompt_cost_usd":0.016385,"completion_cost_usd":0.004425,"total_cost_usd":0.02081,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.699725,"total_granted_usd":10100,"total_charged_usd":3.300275}}}
```

- Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 934145517763883\nCASE: 15159891330\nCLIENT/CONTACT: Alicia Aiello\nCX IS ATTEMPTING TO: Fix overpayment on Federal Payroll tax payments\nEXPECTED OUTCOME: is supposed to be 0\nACTUAL OUTCOME: is currently showing -$622.51\nKB/TOOLS USED: SS, google\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cx has an overpayment in their federal tax payroll payments. It's showing a negative amount. When I click resolve, it doesn't do anything. How can I resolve this overpayment? I checked google and they're saying to contact CRA for resolution which doesn't resolve the overpayment being stuck in the payment center."
```

- Rendered `choices[0].message.content` text:

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

#### Comparison To Human Vision Baseline

- COID/MID: Near miss repeated. Baseline `9341455177633883`; model returned `934145517763883` even after the 16-digit instruction.
- All other fields: Correct against the baseline.

#### Notes

- What improved: Clean canonical output survived P16.
- What failed: The model ignored or could not satisfy the pinned 16-digit COID/MID instruction.
- Prompt change to try next: P17 should instruct digit-by-digit COID/MID transcription, then count the digits and reread if fewer than 16.

### Run 005

- Date/Time: 2026-05-22T15:58:30.577Z
- Fixture: `server/fixtures/pipeline-tests/image-parser/IMG_008AC2E0-241B-4221-832D-C94E666F100A.JPEG`
- Provider: `llm-gateway`
- Model: `qwen/qwen3.5-9b`
- Prompt version: P18
- Route: `POST /api/image-parser/parse`
- Provider package id: `6a107d0ea345a018ae326ff7`
- Provider response artifact: Mongo `ProviderCallPackage` record
- Status: HTTP 200, `finish_reason: stop`
- Token usage: 3246 prompt, 302 completion, 3548 total
- Prompt marker captured in request: `PROMPT_VERSION: P18`
- Canonical validator: passed
- Exact provider response body from `llmGateway.response.bodyText`:

```json
{"id":"chatcmpl-s6v6zzufgsncvueq1t856","object":"chat.completion","created":1779465486,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 9130357569572816\nCASE: 15154530935\nCLIENT/CONTACT: Gayathri Manickavelu\nCX IS ATTEMPTING TO: Temniuk on this case 1515443117 adv cx to callback when she is the Company admin on file, but had created a secure file exchange portal and uploaded a pay edit file, and then closed the case. Cx was unaware that the case is closed, she spent two hours and made corrections on the csv file and uploaded it back, but the case has no updated file at all. Cx is now upset, that without her knowledge the case was closed, and she does not have a saved file on her computer, and she has to spend another two hours making changes. Cx is requesting if there is a way that we can retrieve the file she uploaded\nEXPECTED OUTCOME: cx wants to do a pay edit and had uploaded a file on case 1515443117, which does not seem to be there on the case at all, cx wants us to see if we can retrieve it somehow\nACTUAL OUTCOME: cx upset due to case being closed without letting her know, and she has a missing file now\nKB/TOOLS USED: n/a\nTRIED TEST ACCOUNT: no\nTS STEPS:","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":302,"total_tokens":3548,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":302,"total_tokens":3548},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.00755,"total_cost_usd":0.02378,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.675945,"total_granted_usd":10100,"total_charged_usd":3.324055}}}
```

- Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 9130357569572816\nCASE: 15154530935\nCLIENT/CONTACT: Gayathri Manickavelu\nCX IS ATTEMPTING TO: Temniuk on this case 1515443117 adv cx to callback when she is the Company admin on file, but had created a secure file exchange portal and uploaded a pay edit file, and then closed the case. Cx was unaware that the case is closed, she spent two hours and made corrections on the csv file and uploaded it back, but the case has no updated file at all. Cx is now upset, that without her knowledge the case was closed, and she does not have a saved file on her computer, and she has to spend another two hours making changes. Cx is requesting if there is a way that we can retrieve the file she uploaded\nEXPECTED OUTCOME: cx wants to do a pay edit and had uploaded a file on case 1515443117, which does not seem to be there on the case at all, cx wants us to see if we can retrieve it somehow\nACTUAL OUTCOME: cx upset due to case being closed without letting her know, and she has a missing file now\nKB/TOOLS USED: n/a\nTRIED TEST ACCOUNT: no\nTS STEPS:"
```

- Rendered `choices[0].message.content` text:

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

#### Cross-Image Human Vision Baseline

This is a direct visual baseline for this second fixture, added only to check whether the first-image COID/MID miss is image-specific.

```text
COID/MID: 9130357569572816
CASE: 15154530935
CLIENT/CONTACT: Gayathri Manickavelu
CX IS ATTEMPTING TO: Cx had called in yesterday for payedits, and this agent Diane Temniuk on this case 15154443117 adv cx to callback when she is the Company admin on file, but had created a secure file exchange portal and uploaded a pay edit file, and then closed the case. Cx was unaware that the case is closed, she spent two hours and made corrections on the csv file and uploaded it back, but the case has no updated file at all. Cx is now upset, that without her knowledge the case was closed, and she does not have a saved file on her computer, and she has to spend another two hours making changes. Cx is requesting if there is a way that we can retrieve the file she uploaded
EXPECTED OUTCOME: cx wants to do a pay edit and had uploaded a file on case 15154443117, which does not seem to be there on the case at all, cx wants us to see if we can retrieve it somehow
ACTUAL OUTCOME: cx upset due to case being closed without letting her know, and she has a missing file now
KB/TOOLS USED: n/a
TRIED TEST ACCOUNT: no
TS STEPS: n/a
```

#### Comparison To Cross-Image Human Vision Baseline

- COID/MID: Correct. Baseline `9130357569572816`; model returned `9130357569572816`.
- CASE: Correct. Baseline `15154530935`; model returned `15154530935`.
- CLIENT/CONTACT: Correct. Baseline `Gayathri Manickavelu`; model returned `Gayathri Manickavelu`.
- CX IS ATTEMPTING TO: Partial. The model omitted the visible beginning `Cx had called in yesterday for payedits, and this agent Diane` and began at `Temniuk...`.
- Embedded case number inside the paragraph: Likely wrong. Visual baseline appears to show `15154443117`; model returned `1515443117`.
- EXPECTED OUTCOME: Partial for the same embedded case-number issue.
- ACTUAL OUTCOME: Correct.
- KB/TOOLS USED: Correct.
- TRIED TEST ACCOUNT: Correct.
- TS STEPS: Output blank while the visible screenshot shows `n/a`.

#### Notes

- What improved: The model correctly copied this second image's 16-digit COID/MID. That suggests the repeated 15-digit COID/MID failure on `IMG_B4EC0F38...` is likely image-specific, not a global inability to output long IDs.
- What failed: The model still dropped visible opening words in a long paragraph and may have dropped a digit from the embedded case number in the body text.
- Prompt change to try next: Do not add image-specific digit counts. Keep P18 generic and test one more different fixture before deciding whether the next prompt should target long paragraph starts or embedded numeric IDs.

### Run 006

- Date/Time: 2026-05-22T16:00:29.274Z
- Fixture: `server/fixtures/pipeline-tests/image-parser/IMG_05844904-B207-4081-BBE2-AB527B8355E0.JPEG`
- Provider: `llm-gateway`
- Model: `qwen/qwen3.5-9b`
- Prompt version: P18
- Route: `POST /api/image-parser/parse`
- Provider package id: `6a107d86a345a018ae327030`
- Provider response artifact: Mongo `ProviderCallPackage` record
- Status: HTTP 200, `finish_reason: stop`
- Token usage: 3246 prompt, 222 completion, 3468 total
- Prompt marker captured in request: `PROMPT_VERSION: P18`
- Canonical validator: passed
- Exact provider response body from `llmGateway.response.bodyText`:

```json
{"id":"chatcmpl-vqf7lmj0n99300jtqjppry","object":"chat.completion","created":1779465606,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 9341452918781988\nCASE: 1515488745\nCLIENT/CONTACT: Bassam Ibrahim\nCX IS ATTEMPTING TO: Asking to remove CPP from all Active and 2 terminated EE because they feel they should not have CPP removed because they have not made 3500.00 in gross earnings at the beginning of last years payruns\nEXPECTED OUTCOME: Remove CPP from all active EE and 2 Terminated EE's because they did not make 3500 gross and CPP was deducted\nACTUAL OUTCOME: Cpp was charged to all Active and 2 Terminated EE's\nKB/TOOLS USED: expert access\nTRIED TEST ACCOUNT: \nTS STEPS: On screen with customer he shows me the paycheques from Jan 2025 and CPP is deducted and he feels it should not be because they have not met the 3500.00 gross wages yet for CPP to be deducted","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3246,"completion_tokens":222,"total_tokens":3468,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3246,"completion_tokens":222,"total_tokens":3468},"cost":{"currency":"USD","prompt_cost_usd":0.01623,"completion_cost_usd":0.00555,"total_cost_usd":0.02178,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.654165,"total_granted_usd":10100,"total_charged_usd":3.345835}}}
```

- Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 9341452918781988\nCASE: 1515488745\nCLIENT/CONTACT: Bassam Ibrahim\nCX IS ATTEMPTING TO: Asking to remove CPP from all Active and 2 terminated EE because they feel they should not have CPP removed because they have not made 3500.00 in gross earnings at the beginning of last years payruns\nEXPECTED OUTCOME: Remove CPP from all active EE and 2 Terminated EE's because they did not make 3500 gross and CPP was deducted\nACTUAL OUTCOME: Cpp was charged to all Active and 2 Terminated EE's\nKB/TOOLS USED: expert access\nTRIED TEST ACCOUNT: \nTS STEPS: On screen with customer he shows me the paycheques from Jan 2025 and CPP is deducted and he feels it should not be because they have not met the 3500.00 gross wages yet for CPP to be deducted"
```

- Rendered `choices[0].message.content` text:

```text
COID/MID: 9341452918781988
CASE: 1515488745
CLIENT/CONTACT: Bassam Ibrahim
CX IS ATTEMPTING TO: Asking to remove CPP from all Active and 2 terminated EE because they feel they should not have CPP removed because they have not made 3500.00 in gross earnings at the beginning of last years payruns
EXPECTED OUTCOME: Remove CPP from all active EE and 2 Terminated EE's because they did not make 3500 gross and CPP was deducted
ACTUAL OUTCOME: Cpp was charged to all Active and 2 Terminated EE's
KB/TOOLS USED: expert access
TRIED TEST ACCOUNT:
TS STEPS: On screen with customer he shows me the paycheques from Jan 2025 and CPP is deducted and he feels it should not be because they have not met the 3500.00 gross wages yet for CPP to be deducted
```

#### Cross-Image Human Vision Baseline

```text
COID/MID: 9341452918781988
CASE: 1515488745
CLIENT/CONTACT: Bassam Ibrahim
CX IS ATTEMPTING TO: Asking to remove CPP from all Active and 2 terminated EE because they feel they should not have CPP removed because they have not made 3500.00 in gross earnings at the beginning of last years payruns
EXPECTED OUTCOME: Remove CPP from all active EE and 2 Terminated EE's because they did not make 3500 gross and CPP was deducted
ACTUAL OUTCOME: Cpp was charged to all Active and 2 Terminated EE's
KB/TOOLS USED: expert access
TRIED TEST ACCOUNT:
TS STEPS: On screen with customer he shows me the paycheques from Jan 2025 and CPP is deducted and he feels it should not be because they have not met the 3500.00 gross wages yet for CPP to be deducted
```

#### Comparison To Cross-Image Human Vision Baseline

- COID/MID: Correct. Baseline `9341452918781988`; model returned `9341452918781988`.
- CASE: Correct. Baseline `1515488745`; model returned `1515488745`.
- CLIENT/CONTACT: Correct. Baseline `Bassam Ibrahim`; model returned `Bassam Ibrahim`.
- CX IS ATTEMPTING TO: Correct against visible text.
- EXPECTED OUTCOME: Correct against visible text.
- ACTUAL OUTCOME: Correct against visible text.
- KB/TOOLS USED: Correct.
- TRIED TEST ACCOUNT: Correct blank value.
- TS STEPS: Correct against visible text.

#### Notes

- What improved: P18 produced a clean canonical answer and correctly copied the 16-digit COID/MID on a second different screenshot.
- What failed: No clear field-level miss found on this fixture from direct visual comparison.
- Working hypothesis: The first pinned image has a specific visual ambiguity around `9341455177633883` that this model repeatedly reads as `934145517763883`. The model can copy other 16-digit COID/MID values correctly.

### Run 007

- Date/Time: 2026-05-22T16:02:50.774Z
- Fixture: `server/fixtures/pipeline-tests/image-parser/IMG_008AC2E0-241B-4221-832D-C94E666F100A.JPEG`
- Provider: `llm-gateway`
- Model: `qwen/qwen3.5-9b`
- Prompt version: P19
- Route: `POST /api/image-parser/parse`
- Provider package id: `6a107e0da345a018ae32705f`
- Provider response artifact: Mongo `ProviderCallPackage` record
- Status: HTTP 200, `finish_reason: stop`
- Token usage: 3299 prompt, 302 completion, 3601 total
- Prompt marker captured in request: `PROMPT_VERSION: P19`
- Canonical validator: passed
- Exact provider response body from `llmGateway.response.bodyText`:

```json
{"id":"chatcmpl-r34x84w1stclw3zgqonzbn","object":"chat.completion","created":1779465741,"model":"qwen/qwen3.5-9b","choices":[{"index":0,"message":{"role":"assistant","content":"COID/MID: 9130357569572816\nCASE: 15154530935\nCLIENT/CONTACT: Gayathri Manickavelu\nCX IS ATTEMPTING TO: Temniuk on this case 1515443117 adv cx to callback when she is the Company admin on file, but had created a secure file exchange portal and uploaded a pay edit file, and then closed the case. Cx was unaware that the case is closed, she spent two hours and made corrections on the csv file and uploaded it back, but the case has no updated file at all. Cx is now upset, that without her knowledge the case was closed, and she does not have a saved file on her computer, and she has to spend another two hours making changes. Cx is requesting if there is a way that we can retrieve the file she uploaded\nEXPECTED OUTCOME: cx wants to do a pay edit and had uploaded a file on case 1515443117, which does not seem to be there on the case at all, cx wants us to see if we can retrieve it somehow\nACTUAL OUTCOME: cx upset due to case being closed without letting her know, and she has a missing file now\nKB/TOOLS USED: n/a\nTRIED TEST ACCOUNT: no\nTS STEPS:","reasoning_content":"","tool_calls":[]},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":3299,"completion_tokens":302,"total_tokens":3601,"completion_tokens_details":{"reasoning_tokens":0}},"stats":{},"system_fingerprint":"qwen/qwen3.5-9b","gateway":{"usage":{"prompt_tokens":3299,"completion_tokens":302,"total_tokens":3601},"cost":{"currency":"USD","prompt_cost_usd":0.016495,"completion_cost_usd":0.00755,"total_cost_usd":0.024045,"prompt_cost_per_1m_usd":5,"completion_cost_per_1m_usd":25,"pricing_source":"default"},"credits":{"balance_usd":10096.63012,"total_granted_usd":10100,"total_charged_usd":3.36988}}}
```

- Exact `choices[0].message.content` JSON string value:

```json
"COID/MID: 9130357569572816\nCASE: 15154530935\nCLIENT/CONTACT: Gayathri Manickavelu\nCX IS ATTEMPTING TO: Temniuk on this case 1515443117 adv cx to callback when she is the Company admin on file, but had created a secure file exchange portal and uploaded a pay edit file, and then closed the case. Cx was unaware that the case is closed, she spent two hours and made corrections on the csv file and uploaded it back, but the case has no updated file at all. Cx is now upset, that without her knowledge the case was closed, and she does not have a saved file on her computer, and she has to spend another two hours making changes. Cx is requesting if there is a way that we can retrieve the file she uploaded\nEXPECTED OUTCOME: cx wants to do a pay edit and had uploaded a file on case 1515443117, which does not seem to be there on the case at all, cx wants us to see if we can retrieve it somehow\nACTUAL OUTCOME: cx upset due to case being closed without letting her know, and she has a missing file now\nKB/TOOLS USED: n/a\nTRIED TEST ACCOUNT: no\nTS STEPS:"
```

- Rendered `choices[0].message.content` text:

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

#### Comparison To Run 005 / Cross-Image Baseline

- COID/MID: Still correct at `9130357569572816`.
- CX IS ATTEMPTING TO: No improvement. P19 still started at `Temniuk...` and did not include the visible opening words.
- Embedded case number: No improvement. P19 still returned `1515443117` where the visual baseline appears to show `15154443117`.
- TS STEPS: No improvement. P19 still left it blank while the visible screenshot shows `n/a`.

#### Notes

- What improved: Nothing material over P18 on this fixture.
- What failed: P19 added 53 prompt tokens and did not fix the field-boundary or embedded-ID issue.
- Prompt decision: Roll back to the shorter generic P18-style prompt for the next run instead of carrying the extra P19 instructions.

## Running Observations

- This file is model-specific. Do not mix results from `google/gemma-4-e4b` into this log.
- Keep exact model responses in this file during prompt testing.
- Keep prompt changes in the revision log before or immediately after each test.
- Do not mix parser validation changes, provider harness changes, or UI behavior changes into this file unless they directly affect the prompt test result.
