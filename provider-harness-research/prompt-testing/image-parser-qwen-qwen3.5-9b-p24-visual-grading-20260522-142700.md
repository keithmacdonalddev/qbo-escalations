# Qwen 3.5 9B Image Parser P24 Visual Grading

Run source:

- Raw response JSONL: `provider-harness-research/prompt-testing/image-parser-qwen-qwen3.5-9b-p24-scale-test-20260522-142700.jsonl`
- Model: `qwen/qwen3.5-9b`
- Provider path: `llm-gateway`
- Prompt version: `P24`
- Prompt hash: `00e66094cdf121bd9ca46465161c713d9213f20378c003a43736bf60f4cd2617`

This grading is manual visual grading only. It ignores app structural validation, `parseFields`, `parseMeta`, field counts, semantic scores, and route pass/fail status.

Grade meanings:

- Exact: visually copied the screenshot values into the expected template with no material transcription differences.
- Near: within 1-2 single-character transcription issues.
- Fail: wrong field ownership, missing field value, moved text between labels, hallucinated value, or more than 1-2 character-level issues.

## Summary

- Total images: 11
- Exact: 1 / 11
- Near: 3 / 11
- Fail: 7 / 11
- Exact or near: 4 / 11

## Results

| Fixture | Grade | Visual notes |
| --- | --- | --- |
| `IMG_008AC2E0-241B-4221-832D-C94E666F100A.JPEG` | Fail | Missed the opening `Cx had called in yesterday for payedits, and this agent Diane...`; embedded case number appears to drop a `4`; `TS STEPS` should be `n/a` but model left it blank. |
| `IMG_05844904-B207-4081-BBE2-AB527B8355E0.JPEG` | Near | Main fields are close. `CASE` is missing one visible `4`: image shows `15154488745`, model returned `1515488745`. |
| `IMG_06048310-AEF4-4768-88EE-C5E0C7EA009B (1).JPEG` | Fail | Moved the visible `TS STEPS` value into `TRIED TEST ACCOUNT` and left `TS STEPS` blank. This is field ownership failure, not a minor character issue. |
| `IMG_0B353539-D34F-479C-A398-C26C6D1A9361.JPEG` | Fail | Wrong `CLIENT/CONTACT` and wrong `CASE`; model returned `Claude Klogo Nyatepe K.` and `1514531492`, while the screenshot shows `Doug Mckensie` and `15154531492`. It also omitted the visible `TS STEPS` value. |
| `IMG_0D56E242-2516-485C-AA03-0B71EE3215A4.JPEG` | Exact | Values match the visible screenshot content. |
| `IMG_2D333EEF-9405-437F-98C5-70BCADD453F9.JPEG` | Fail | Filled `CLIENT/CONTACT` from the chat header even though the template line is blank. Also changed visible `NA` to `N/A`. |
| `IMG_64BC25E3-372D-4D45-B072-9F7F3BE3A070.JPEG` | Fail | `COID/MID` is missing a digit, `CX IS ATTEMPTING TO` misses the opening phrase about the MA/company, and `EXPECTED OUTCOME` is wrong. |
| `IMG_A48EF4ED-74C1-4CFF-B077-E0977FA38187.JPEG` | Fail | Main top fields are close, but not within the 1-2 character target: repeated `n\a` values were returned as `n\la`, the visible `TRIED IN TEST ACCOUNT` label/value area was not copied exactly, and punctuation spacing changed. |
| `IMG_B4EC0F38-053B-41BD-A8D4-73F121CA944E.JPEG` | Near | Only clear issue found is the long `COID/MID`: image shows `9341455177633883`, model returned `934145517763883`, missing one `3`. |
| `IMG_BFD049AE-F5FA-428F-96D6-698D97E82DE3.jpeg` | Fail | Moved `CX's clients` from `EXPECTED OUTCOME` into `CX IS ATTEMPTING TO`, omitted `for the` from expected outcome, and left `TS STEPS` blank even though the screenshot shows `N/A`. |
| `IMG_EC4F1F21-8B86-4AB0-B01E-15CB9F2B8FB0.JPEG` | Near | Values are otherwise fixed from earlier attempts. The visible text appears to have no space before the opening quote after `message`; model inserted one space. |

## Readout

P24 improved some blank-field and `N/A` placement behavior, but it did not reach scale reliability. The main remaining failure modes are:

1. Long numeric identifiers still lose repeated adjacent digits.
2. The model still moves text between neighboring labels.
3. The model sometimes uses visible chat header data to fill a blank template field.
4. The model still misses the start or end of long wrapped values.
5. The model is fragile around odd visible template labels or typo-like values such as `n\a`.

The next prompt change should target field ownership and repeated digit copying without making the prompt image-specific.
