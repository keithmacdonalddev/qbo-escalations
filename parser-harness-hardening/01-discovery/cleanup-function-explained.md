# The silent cleanup function — `recoverCanonicalTemplateBlock` — explained in plain English

Question E from the PM: the user wants a step-by-step plain-English account of what this function is, what it does, why it was added, examples of messy AI output it would silently fix, and why turning it off helps.

Location: `server/src/services/image-parser.js:1417-1437`. Called from `buildStructuredParseResult` at `services/image-parser.js:1454`.

Introduced in commit `d69ad58` ("chore: checkpoint app updates and cleanup") on Mon May 18 — exactly **one day before** today. Author: keithmacdonalddev (the user). So this is recent code, not legacy. The commit message gives no design rationale; the function was added as part of a larger 345-line image-parser refactor.

## What goes in (input)

A blob of text — whatever the AI wrote in response to "transcribe this escalation screenshot." Could be:

- A perfectly clean canonical block ("COID/MID: 12345 / 67890\nCASE: 098765\n..." with all 9 expected labels each on their own line).
- A messy version with the right pieces but extra commentary at the start or end.
- A version where the AI helpfully added formatting that breaks the strict shape — markdown fences, bullet points, headings, line wraps in unhelpful places.
- A version that has nothing recognisable.

## What it does to the input, step by step

In plain words, no code-speak:

1. **Receive the AI's raw text.** If the text is empty or just whitespace, give back an empty string and stop.
2. **Build a list of the 9 labels the canonical escalation template uses.** These are the labels the validator will look for: `COID/MID`, `CASE`, `CLIENT/CONTACT`, `CX IS ATTEMPTING TO`, `EXPECTED OUTCOME`, `ACTUAL OUTCOME`, `KB/TOOLS USED`, `TRIED TEST ACCOUNT`, `TS STEPS`.
3. **Search the AI's text for the very first place any one of those labels appears.** If none of them appear anywhere, give back the AI's text unchanged and stop.
4. **If a label was found, throw away everything before that first label.** So "Here is the parse you asked for: COID/MID: 123" becomes "COID/MID: 123". The polite preamble is gone.
5. **Normalise line endings.** Replace Windows-style `\r\n` (carriage return + newline) and bare `\r` (carriage return) with Unix-style `\n` so the regex engine sees one consistent shape.
6. **Walk through the remaining text and find every place where a canonical label appears mid-text.** Wherever a label like `EXPECTED OUTCOME:` shows up after a space or after some other text rather than at the start of a line, insert a newline before it. This makes every label start its own line, which is what the validator expects.
7. **Trim leading and trailing whitespace.** Return the cleaned-up text.

That's it. Seven steps.

## What comes out (output)

A reshaped string that looks like the canonical 9-label block — labels are each on their own line, no commentary before the first label, no carriage returns. The actual values between labels are NOT touched; only the structural placement of the labels.

This output then gets handed to the strict validator (`validateCanonicalEscalationTemplateText` at `server/src/lib/escalation-template-contract.js:47`) which checks that every required label is present in the right order.

## Why it was added

The commit message ("chore: checkpoint app updates and cleanup") doesn't say. But by tracing the file structure: it was added alongside a refactor of `buildStructuredParseResult`, which now calls both `validateCanonicalEscalationTemplateText` on the **raw** text AND on the **recovered** text, then records both results separately (`canonicalTemplate.passed` for raw, `canonicalTemplate.recoveredPassed` for the rescued version).

So the design intent was clearly: "be lenient with the AI's output but record whether it would have passed without leniency." The route then treats `passed` as `validation.passed && canonicalTemplate.ok` (raw, no rescue) at `image-parser.js:1478`, but the recovered text is what gets used for downstream field extraction (`textForFields = recoveredText || text` at `image-parser.js:1457`). So the rescued version powers the downstream pipeline but the raw version is what's scored.

The likely motivation: production needs to keep working when the AI is chatty. Today's frontier models (Claude, GPT-5) usually produce clean output, but defensive coding wanted a safety net.

For the harness-hardening goal, that safety net is exactly the problem.

## Concrete examples of "messy AI output" the cleanup would silently fix

### Example 1 — chatty preamble

**AI output (raw):**
```
Sure! Here is the parsed escalation template:

COID/MID: 12345 / 67890
CASE: 098765
CLIENT/CONTACT: jane@example.com
CX IS ATTEMPTING TO: import 1099 forms
EXPECTED OUTCOME: forms upload successfully
ACTUAL OUTCOME: getting error 5050
KB/TOOLS USED: INV-7733
TRIED TEST ACCOUNT: NA
TS STEPS: cleared cache, re-logged in
```

**After cleanup runs:**
```
COID/MID: 12345 / 67890
CASE: 098765
CLIENT/CONTACT: jane@example.com
CX IS ATTEMPTING TO: import 1099 forms
EXPECTED OUTCOME: forms upload successfully
ACTUAL OUTCOME: getting error 5050
KB/TOOLS USED: INV-7733
TRIED TEST ACCOUNT: NA
TS STEPS: cleared cache, re-logged in
```

The "Sure! Here is the parsed escalation template:" preamble was discarded. The validator passes. From the user's standpoint, the AI looks like it followed the format. From the harness's standpoint, the AI didn't — it added commentary.

### Example 2 — labels jammed onto fewer lines

**AI output (raw):**
```
COID/MID: 12345 / 67890 CASE: 098765 CLIENT/CONTACT: jane@example.com CX IS ATTEMPTING TO: import 1099 forms EXPECTED OUTCOME: forms upload successfully ACTUAL OUTCOME: getting error 5050 KB/TOOLS USED: INV-7733 TRIED TEST ACCOUNT: NA TS STEPS: cleared cache, re-logged in
```

(All on one line, no newlines.)

**After cleanup runs:**

Same content as Example 1's output — each label gets a newline inserted before it because the cleanup walks every label and inserts `\n` when the label isn't already at line-start.

The validator passes. But the AI failed: it ignored the instruction to put each label on its own line. The harness has no way to detect that failure post-cleanup.

### Example 3 — extra trailing commentary

**AI output (raw):**
```
COID/MID: 12345 / 67890
CASE: 098765
CLIENT/CONTACT: jane@example.com
CX IS ATTEMPTING TO: import 1099 forms
EXPECTED OUTCOME: forms upload successfully
ACTUAL OUTCOME: getting error 5050
KB/TOOLS USED: INV-7733
TRIED TEST ACCOUNT: NA
TS STEPS: cleared cache, re-logged in

I hope this helps! Let me know if you'd like me to extract any other details.
```

**After cleanup runs:**

The cleanup walks labels from start-to-finish and inserts newlines before them. Since the trailing commentary doesn't contain a canonical label, it stays at the end of the output. The validator at `validateCanonicalEscalationTemplateText` does check for "extra trailing text" and would flag this — so this case is one the cleanup doesn't actually fix; it still fails. But the cleanup hides Example 1 and Example 2, which is enough harm on its own.

## Why turning it off helps the hardening goal

The hardening goal is: get a weak model to produce 100% byte-for-byte canonical output on its own, without help. With the cleanup on, the harness can't tell which models actually behaved and which models were rescued — they all show "passed" or "passed via recovery" in `parseMeta`, which is exactly the failure mode the user wants to eliminate. The cleanup function is well-intentioned camouflage.

With the cleanup off, every chatty preamble, every flattened-onto-one-line response, every wandering commentary becomes a visible Fail. The prompt and the runtime can then be tuned (anti-normalization clauses, structured output schema, temperature pinning) until the canary weak model produces clean output natively. **Then** turning the cleanup back on becomes a real safety net for the rare production miss, not a permanent camouflage layer.

Decision D1 makes the cleanup off by default and adds a UI toggle, which is the right compromise: hardening cycles see the truth; production cycles can still opt in to leniency.

Last updated: 2026-05-19
