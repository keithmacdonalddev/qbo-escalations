'use strict';

const BUILT_IN_CONFIRMED_OUTPUTS = Object.freeze({
  'IMG_A48EF4ED-74C1-4CFF-B077-E0977FA38187.JPEG': {
    fixtureName: 'IMG_A48EF4ED-74C1-4CFF-B077-E0977FA38187.JPEG',
    expectedText: [
      'COID/MID:9341455743597823',
      'CASE: 15154491216',
      'CLIENT/CONTACT: Dharmika Mithaiwala',
      'CX IS ATTEMPTING TO: Payroll suspended',
      'EXPECTED OUTCOME: vbd reset',
      'ACTUAL OUTCOME: IDV - 15149615753 case completed , uploaded the supported documents',
      'KB/TOOLS USED: n\\a',
      'TRIED TEST ACCOUNT: n\\a',
      'TS STEPS: checked Bank Account Setup : SUSPENDED',
    ].join('\n'),
    source: 'built-in-seed',
    confirmedBy: 'operator',
  },
});

function getBuiltInConfirmedOutput(fixtureName) {
  const clean = typeof fixtureName === 'string' ? fixtureName.trim() : '';
  if (!clean) return null;
  return BUILT_IN_CONFIRMED_OUTPUTS[clean] || null;
}

module.exports = {
  getBuiltInConfirmedOutput,
};
