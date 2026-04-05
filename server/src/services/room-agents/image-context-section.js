'use strict';

const FIELD_LABELS = Object.freeze({
  coid: 'COID',
  mid: 'MID',
  caseNumber: 'Case',
  clientContact: 'Client/Contact',
  agentName: 'Agent',
  attemptingTo: 'Attempting To',
  expectedOutcome: 'Expected Outcome',
  actualOutcome: 'Actual Outcome',
  tsSteps: 'TS Steps',
  triedTestAccount: 'Tried Test Account',
  category: 'Category',
  severity: 'Severity',
});

function hasRenderableValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return true;
  return Boolean(value.trim());
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildRoomImageContextSection(imageContext) {
  if (!imageContext || typeof imageContext !== 'object') return '';

  const sections = ['--- Image Context ---'];
  const transcription = typeof imageContext.transcription === 'string'
    ? imageContext.transcription.trim()
    : '';

  if (transcription) {
    sections.push(`Transcription:\n${transcription}`);
  }

  const detectedFieldLines = Object.entries(imageContext.parseFields || {})
    .filter(([, value]) => hasRenderableValue(value))
    .map(([field, value]) => `- ${FIELD_LABELS[field] || field}: ${formatValue(value)}`);

  if (detectedFieldLines.length > 0) {
    sections.push(`Detected Fields:\n${detectedFieldLines.join('\n')}`);
  }

  if (typeof imageContext.confidence === 'string' && imageContext.confidence.trim()) {
    sections.push(`Confidence: ${imageContext.confidence.trim()}`);
  }

  if (typeof imageContext.role === 'string' && imageContext.role.trim()) {
    sections.push(`Role: ${imageContext.role.trim()}`);
  }

  if (sections.length === 1) return '';
  sections.push('--- End Image Context ---');
  return `\n\n${sections.join('\n')}`;
}

module.exports = {
  buildRoomImageContextSection,
};
