// FALLBACK-ONLY constants and timing knobs. The real pipeline is driven by
// useStageOrchestrator via /api/chat SSE. These exports remain only for:
//   - STAGE_KEYS / STAGE_LABELS / STAGE_DESCRIPTIONS (UI labels)
//   - TIMING.widgetSlideMs / analystFollowupMin/Max (slide transition fall-throughs)
//   - randomBetween (small helper still used elsewhere)
// Do NOT consume MOCK_PARSED_FIELDS / MOCK_TRIAGE / MOCK_ANALYST_TURNS in widgets.
export const MOCK_CASE = {
  caseId: 'ESC-2026-0516-A4',
  customerName: 'Larkspur Roasters LLC',
  realm: '9341 0027 5512',
  region: 'San Mateo, CA',
  plan: 'QBO Payroll Premium',
  phoneAgent: 'Maya R. (T2, badge 4419)',
  capturedAt: '11:42',
  fileName: 'escalation-template-2026-05-16.png',
  fileDims: '1,242 × 1,876',
  fileSize: '328 KB',
};

export const MOCK_PARSED_FIELDS = [
  { key: 'attemptingTo', label: 'Attempting to', value: 'Run unscheduled payroll for terminated employee in CA' },
  { key: 'expectedOutcome', label: 'Expected outcome', value: 'Issue terminated employee’s final paycheque dated 05/16' },
  { key: 'actualOutcome', label: 'Actual outcome', value: 'Payroll wizard blocks at step 3 — "Termination date is after pay period start"' },
  { key: 'customerInfo', label: 'Customer info', value: 'Larkspur Roasters LLC · realm 9341 0027 5512 · San Mateo, CA' },
  { key: 'agentInfo', label: 'Agent info', value: 'Maya R. (T2, badge 4419)' },
  { key: 'stepsTried', label: 'Steps tried', value: '1) Verified term date 05/14 in employee record  ·  2) Tried changing pay period to 05/10–05/16 (greyed out)  ·  3) Cleared cache, signed out / back in  ·  4) Switched browsers' },
  { key: 'testAccount', label: 'Test account', value: 'qa-payroll-ca-sandbox-04' },
  { key: 'triedTestAccount', label: 'Tried test account', value: 'Yes — reproduces identically on QA sandbox with matching termination/period dates' },
  { key: 'notes', label: 'Notes', value: 'PSE_TERM_DATE_AFTER_PERIOD toast — no error code surfaced to customer. Payroll Premium tier.' },
];

export const MOCK_TRIAGE = {
  category: 'payroll',
  severity: 'P2',
  fastRead: 'Customer is mid-payroll: terminated employee’s final cheque can’t process because the termination date (05/14) sits after the pay period start (05/16). The wizard’s own validator is right — the operator needs to override the pay period start, not the termination date.',
  nextStep: 'Walk Maya through switching the run to an off-cycle paycheque with period 05/01–05/14. Bypasses the validator without backdating the termination.',
  missingInfo: ['Customer’s preferred deposit method (direct / paper)', 'Whether final cheque includes accrued PTO'],
  confidence: 'high',
};

export const MOCK_INV_MATCHES = [
  {
    id: 'INV-147914',
    title: 'Terminated employee final paycheque blocked — period start after term date (CA)',
    similarity: 96,
    status: 'resolved',
    age: '4 months ago',
    note: 'same root cause',
    best: true,
  },
  {
    id: 'INV-152038',
    title: 'Unscheduled payroll greyed out for QBO Payroll Premium after term date change',
    similarity: 82,
    status: 'resolved',
    age: '6 weeks ago',
    note: '',
  },
  {
    id: 'INV-149220',
    title: 'Off-cycle paycheque flow missing for terminated employees on iOS',
    similarity: 61,
    status: 'open',
    age: '2 weeks ago',
    note: 'adjacent issue',
  },
];

export const MOCK_ANALYST = {
  name: 'Avery Lin',
  role: 'Senior escalation analyst',
  initials: 'AL',
};

export const MOCK_ANALYST_TURNS = [
  {
    role: 'analyst',
    text: 'I’ve got the case. Larkspur Roasters’ final cheque is being blocked by the period-start validator, not the termination itself. INV-147914 was the same case in January; the fix held.\n\nTwo options for Maya:\n• Off-cycle paycheque with period 05/01–05/14 — cleanest, what we did last time\n• Backdate the scheduled run to the prior period — works, but creates a manual reconciliation later\n\nI’d push her toward option one. Want me to draft the DM?',
  },
  {
    role: 'analyst',
    text: 'Drafting now. Also flagging two missing items so Maya can grab them on the same call:\n• Direct deposit vs. paper cheque preference\n• Whether the final cheque should include accrued PTO (CA requires it on termination)',
  },
];

export const MOCK_PARSER_MODEL = 'claude-haiku-4.5';

export const STAGE_KEYS = ['parser', 'triage', 'inv', 'main'];

export const STAGE_LABELS = {
  parser: 'Image Parser',
  triage: 'Triage Agent',
  inv: 'INV Search Agent',
  main: 'QBO Assistant',
};

export const STAGE_DESCRIPTIONS = {
  parser: 'reads the screenshot',
  triage: 'categorizes & sizes',
  inv: 'finds prior cases',
  main: 'writes the response',
};

export const TIMING = {
  parserMin: 3200,
  parserMax: 4600,
  triageDelayAfterParserMin: 200,
  triageDelayAfterParserMax: 500,
  triageRunMin: 3800,
  triageRunMax: 5600,
  invDelayAfterParserMin: 400,
  invDelayAfterParserMax: 900,
  invRunMin: 4400,
  invRunMax: 6400,
  mainDelayAfterTriageMin: 800,
  mainDelayAfterTriageMax: 1400,
  mainRunMin: 1600,
  mainRunMax: 2400,
  widgetSlideMs: 520,
  analystFollowupMin: 1600,
  analystFollowupMax: 2400,
};

export function randomBetween(min, max) {
  return Math.round(min + Math.random() * (max - min));
}
