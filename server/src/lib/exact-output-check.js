'use strict';

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function splitLines(value) {
  return safeString(value).split('\n');
}

function splitChars(value) {
  return Array.from(safeString(value));
}

function charsEqual(actualChar, expectedChar) {
  if (actualChar === expectedChar) return true;
  if (!actualChar || !expectedChar) return false;
  return actualChar.toLocaleLowerCase('en-US') === expectedChar.toLocaleLowerCase('en-US')
    || actualChar.toLocaleUpperCase('en-US') === expectedChar.toLocaleUpperCase('en-US');
}

function compareLine(actualLine, expectedLine, lineIndex, actualExists = true, expectedExists = true) {
  const actualChars = splitChars(actualLine);
  const expectedChars = splitChars(expectedLine);
  const maxChars = Math.max(actualChars.length, expectedChars.length);
  const chars = [];
  let passedCharacters = 0;
  let failedCharacters = 0;

  for (let index = 0; index < maxChars; index += 1) {
    const actualMissing = index >= actualChars.length;
    const expectedMissing = index >= expectedChars.length;
    const actualChar = actualMissing ? '' : actualChars[index];
    const expectedChar = expectedMissing ? '' : expectedChars[index];
    const passed = !actualMissing && !expectedMissing && charsEqual(actualChar, expectedChar);
    const kind = passed
      ? 'match'
      : actualMissing
        ? 'missing'
        : expectedMissing
          ? 'extra'
          : 'mismatch';

    if (passed) passedCharacters += 1;
    else failedCharacters += 1;

    chars.push({
      index,
      actualChar,
      expectedChar,
      passed,
      kind,
    });
  }

  if (maxChars === 0 && actualExists !== expectedExists) {
    failedCharacters += 1;
    chars.push({
      index: 0,
      actualChar: actualExists ? '\n' : '',
      expectedChar: expectedExists ? '\n' : '',
      passed: false,
      kind: actualExists ? 'extra' : 'missing',
    });
  }

  const passed = actualExists
    && expectedExists
    && actualChars.length === expectedChars.length
    && chars.every((char) => char.passed);
  return {
    lineNumber: lineIndex + 1,
    passed,
    actualExists,
    expectedExists,
    actualText: actualLine,
    expectedText: expectedLine,
    actualLength: actualChars.length,
    expectedLength: expectedChars.length,
    passedCharacters,
    failedCharacters,
    chars,
  };
}

function buildExactOutputComparison({ actual, expected }) {
  const actualText = safeString(actual);
  const expectedText = safeString(expected);
  const actualLines = splitLines(actualText);
  const expectedLines = splitLines(expectedText);
  const maxLines = Math.max(actualLines.length, expectedLines.length);
  const lines = [];
  let passedLines = 0;
  let failedLines = 0;
  let passedCharacters = 0;
  let failedCharacters = 0;

  for (let index = 0; index < maxLines; index += 1) {
    const actualExists = index < actualLines.length;
    const expectedExists = index < expectedLines.length;
    const line = compareLine(
      actualExists ? actualLines[index] : '',
      expectedExists ? expectedLines[index] : '',
      index,
      actualExists,
      expectedExists
    );
    if (line.passed) passedLines += 1;
    else failedLines += 1;
    passedCharacters += line.passedCharacters;
    failedCharacters += line.failedCharacters;
    lines.push(line);
  }

  const passed = lines.length > 0
    ? lines.every((line) => line.passed)
    : actualText === expectedText;

  return {
    passed,
    summary: {
      caseSensitive: false,
      actualLength: splitChars(actualText).length,
      expectedLength: splitChars(expectedText).length,
      actualLineCount: actualLines.length,
      expectedLineCount: expectedLines.length,
      lineCount: maxLines,
      passedLines,
      failedLines,
      passedCharacters,
      failedCharacters,
    },
    lines,
  };
}

module.exports = {
  buildExactOutputComparison,
};
