#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { BROAD_REACT_PROP_TYPE_PATTERN } from './component-validator-shared.mjs';

const REQUIRED_SECTIONS = [
  'Component definition',
  'Evidence and design determination',
  'Component boundary',
  'Anatomy',
  'Core design thesis',
  'Canonical default',
  'Variant, state, and size architecture',
  'Visual system',
  'Interaction and state journey',
  'Responsive behavior',
  'Accessibility',
  'Content guidance',
  'Public API',
  'Invalid combinations and safeguards',
  'Relationship to neighboring components',
  "Do / don't guidance",
  'Acceptance criteria',
  'Independent critique',
  'Decision summary',
  'One-sentence definition',
];

const BASE_SECTION_MINIMUMS = new Map([
  ['Component definition', 70],
  ['Evidence and design determination', 150],
  ['Component boundary', 80],
  ['Anatomy', 80],
  ['Core design thesis', 70],
  ['Canonical default', 90],
  ['Variant, state, and size architecture', 120],
  ['Visual system', 140],
  ['Interaction and state journey', 50],
  ['Responsive behavior', 80],
  ['Accessibility', 120],
  ['Content guidance', 70],
  ['Public API', 120],
  ['Invalid combinations and safeguards', 100],
  ['Relationship to neighboring components', 80],
  ["Do / don't guidance", 80],
  ['Acceptance criteria', 120],
  ['Independent critique', 90],
  ['Decision summary', 80],
  ['One-sentence definition', 12],
]);

const TOTAL_MINIMUMS = {
  primitive: 1500,
  composition: 1700,
  'interactive-control': 2100,
  'workflow-pattern': 2400,
};

const EXPECTED_EVIDENCE_HEADERS = [
  'current evidence',
  'design implication',
  'decision',
  'strongest rejected alternative',
];

const normalizeHeading = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const wordCount = (value) => (value.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
const stripCode = (value) => value.replace(/```[\s\S]*?```/g, ' ');
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = fs.realpathSync(path.resolve(SCRIPT_DIRECTORY, '..', '..', '..', '..'));

function issue(code, message) {
  return { code, message };
}

function extractSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const ordered = [];
  let current = null;

  const commit = () => {
    if (current !== null) {
      current.body = current.buffer.join('\n').trim();
      delete current.buffer;
      ordered.push(current);
    }
  };

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      commit();
      current = { heading: match[1], key: normalizeHeading(match[1]), buffer: [] };
    } else if (current !== null) {
      current.buffer.push(line);
    }
  }

  commit();

  const byKey = new Map();
  for (const section of ordered) {
    const currentSections = byKey.get(section.key) ?? [];
    currentSections.push(section);
    byKey.set(section.key, currentSections);
  }

  return { ordered, byKey };
}

function parseMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

function parseEvidenceTable(body) {
  const lines = body.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const cells = parseMarkdownRow(line);
    return cells?.some((cell) => normalizeHeading(cell) === 'current evidence');
  });

  if (headerIndex < 0) return { header: null, separator: null, rows: [] };

  const header = parseMarkdownRow(lines[headerIndex]);
  const separator = parseMarkdownRow(lines[headerIndex + 1] ?? '');
  const rows = [];

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const cells = parseMarkdownRow(lines[index]);
    if (!cells) break;
    rows.push(cells);
  }

  return { header, separator, rows };
}

function sectionBody(sections, heading) {
  return sections.byKey.get(normalizeHeading(heading))?.[0]?.body ?? '';
}

function sectionMinimum(heading, componentType) {
  const base = BASE_SECTION_MINIMUMS.get(heading) ?? 50;
  if (heading === 'One-sentence definition') return base;
  if (heading === 'Interaction and state journey') {
    if (componentType === 'interactive-control') return 180;
    if (componentType === 'workflow-pattern') return 220;
    return 50;
  }
  if (componentType === 'primitive') return Math.max(45, Math.round(base * 0.75));
  if (componentType === 'composition') return Math.max(50, Math.round(base * 0.85));
  return base;
}

function validate(markdown) {
  const problems = [];
  const add = (code, message) => problems.push(issue(code, message));
  const sections = extractSections(markdown);
  const totalWords = wordCount(stripCode(markdown));

  if (!/^#\s+.+(?:—|-)\s+Component Design Explanation\s*$/m.test(markdown)) {
    add('title-format', 'Add a level-one title in the form “# Name — Component Design Explanation”.');
  }

  const documentLines = markdown.split(/\r?\n/);
  const titleLineIndex = documentLines.findIndex((line) => /^#\s+.+(?:—|-)\s+Component Design Explanation\s*$/.test(line));
  let typeLineIndex = titleLineIndex + 1;
  while (typeLineIndex > 0 && typeLineIndex < documentLines.length && documentLines[typeLineIndex].trim() === '') {
    typeLineIndex += 1;
  }
  const typeMatch = documentLines[typeLineIndex]?.match(/^Component type:\s*`?(primitive|composition|interactive-control|workflow-pattern)`?\s*$/i);
  const componentType = typeMatch?.[1]?.toLowerCase() ?? null;
  if (!componentType) {
    add('component-type', 'Place “Component type: primitive | composition | interactive-control | workflow-pattern” as the first non-empty line below the title.');
  }

  const requiredKeys = REQUIRED_SECTIONS.map(normalizeHeading);
  for (const required of REQUIRED_SECTIONS) {
    const key = normalizeHeading(required);
    const matches = sections.byKey.get(key) ?? [];
    if (matches.length === 0) {
      add('missing-section', `Missing required section: ## ${required}`);
      continue;
    }
    if (matches.length > 1) {
      add('duplicate-section', `Required section appears ${matches.length} times: ## ${required}`);
    }

    const minimum = sectionMinimum(required, componentType);

    const count = wordCount(stripCode(matches[0]?.body ?? ''));
    if (matches.length > 0 && count < minimum) {
      add('section-depth', `Section “${required}” has ${count} prose words; its component-type-aware floor is ${minimum}.`);
    }
  }

  const recognizedOrder = sections.ordered
    .map((section) => section.key)
    .filter((key) => requiredKeys.includes(key));
  const firstOccurrences = recognizedOrder.filter((key, index) => recognizedOrder.indexOf(key) === index);
  if (firstOccurrences.join('|') !== requiredKeys.join('|')) {
    add('section-order', 'Required level-two sections are not in the mandated order.');
  }

  const totalMinimum = TOTAL_MINIMUMS[componentType] ?? 1800;
  if (totalWords < totalMinimum) {
    add('total-depth', `Explanation has ${totalWords} prose words; the ${componentType ?? 'unclassified'} completeness floor is ${totalMinimum}.`);
  }

  const evidenceBody = sectionBody(sections, 'Evidence and design determination');
  const evidence = parseEvidenceTable(evidenceBody);
  const normalizedHeaders = evidence.header?.map(normalizeHeading) ?? [];
  if (normalizedHeaders.join('|') !== EXPECTED_EVIDENCE_HEADERS.join('|')) {
    add('evidence-header', 'Evidence table must have exactly four columns: Current evidence, Design implication, Decision, and Strongest rejected alternative.');
  }
  if (!evidence.separator || evidence.separator.length !== 4
    || evidence.separator.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    add('evidence-separator', 'Evidence table needs a valid four-column Markdown separator row.');
  }
  if (evidence.rows.length < 5) {
    add('evidence-row-count', `Evidence table has ${evidence.rows.length} decision rows; at least five material decisions are required.`);
  }

  const rowSignatures = new Set();
  for (const [index, row] of evidence.rows.entries()) {
    if (row.length !== 4 || row.some((cell) => cell.trim().length === 0)) {
      add('evidence-row-shape', `Evidence row ${index + 1} must contain exactly four non-empty cells.`);
      continue;
    }
    const minimumCellWords = [4, 6, 5, 7];
    row.forEach((cell, cellIndex) => {
      if (wordCount(cell) < minimumCellWords[cellIndex]) {
        add('evidence-cell-depth', `Evidence row ${index + 1}, column ${cellIndex + 1} is too thin to show a real determination.`);
      }
    });
    const signature = row.map((cell) => normalizeHeading(cell)).join('|');
    if (rowSignatures.has(signature)) {
      add('evidence-duplicate-row', `Evidence row ${index + 1} duplicates an earlier row.`);
    }
    rowSignatures.add(signature);
  }

  const citationPattern = /((?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.(?:md|css|jsx?|tsx?|html)):(\d+)(?:-(\d+))?/g;
  const evidenceCitations = new Set();
  for (const row of evidence.rows) {
    for (const match of row[0]?.matchAll(citationPattern) ?? []) {
      const [, rawRelativePath, rawStart, rawEnd] = match;
      const relativePath = rawRelativePath.replace(/[\\/]/g, path.sep);
      const absolutePath = path.resolve(REPOSITORY_ROOT, relativePath);
      const relativeToRoot = path.relative(REPOSITORY_ROOT, absolutePath);
      const startsOutsideRoot = relativeToRoot === '..'
        || relativeToRoot.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeToRoot);
      const startLine = Number(rawStart);
      const endLine = Number(rawEnd ?? rawStart);

      if (startsOutsideRoot || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        add('evidence-citation-validity', `Evidence citation does not resolve to a repository file: ${match[0]}.`);
        continue;
      }

      const lineCount = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/).length;
      if (startLine < 1 || endLine < startLine || endLine > lineCount) {
        add('evidence-citation-validity', `Evidence citation is outside the current file's line range: ${match[0]} (file has ${lineCount} lines).`);
        continue;
      }

      evidenceCitations.add(`${relativeToRoot}:${startLine}-${endLine}`);
    }
  }
  if (evidenceCitations.size < 3) {
    add('evidence-citations', `Evidence table contains ${evidenceCitations.size} verified repository citations; at least three are required.`);
  }

  const boundaryBody = sectionBody(sections, 'Component boundary');
  if (!/\bowns\b/i.test(boundaryBody) || !/(parent|workflow|consumer|feature).{0,40}\bowns\b/i.test(boundaryBody)) {
    add('ownership-boundary', 'Component boundary must explicitly state what the component owns and what the parent, workflow, or consumer owns.');
  }

  const anatomyBody = sectionBody(sections, 'Anatomy');
  if (!/```text[\s\S]*?```/i.test(anatomyBody)
    || !/required/i.test(anatomyBody) || !/optional|conditional/i.test(anatomyBody)) {
    add('anatomy-contract', 'Anatomy needs a fenced text tree that marks required and optional or conditional parts.');
  }

  const visualBody = sectionBody(sections, 'Visual system');
  const designTokens = new Set(visualBody.match(/--[a-z0-9-]+/gi) ?? []);
  if (designTokens.size < 3) {
    add('visual-token-evidence', `Visual system names ${designTokens.size} governed tokens; at least three are required to prove Slate alignment.`);
  }

  const interactionBody = sectionBody(sections, 'Interaction and state journey');
  if (componentType === 'primitive' || componentType === 'composition') {
    if (!/(non-interactive|static|inapplicable|not applicable)/i.test(interactionBody)) {
      add('static-interaction-boundary', 'A static primitive or composition must explicitly explain why interaction states are inapplicable.');
    }
  } else if (componentType === 'interactive-control' || componentType === 'workflow-pattern') {
    const requiredStateConcepts = [
      ['rest', /\brest(?:ing)?\b/i],
      ['hover', /\bhover\b/i],
      ['keyboard focus', /keyboard[\s-]+focus|focus-visible/i],
      ['pressed', /\bpress(?:ed)?\b/i],
      ['disabled', /disabled|unavailable/i],
      ['waiting', /loading|waiting|busy/i],
      ['outcome', /success|complete|completed/i],
      ['failure', /error|failure|failed/i],
      ['recovery', /recovery|retry|recover/i],
      ['reduced motion', /reduced[\s-]+motion|prefers-reduced-motion/i],
    ];
    for (const [concept, pattern] of requiredStateConcepts) {
      if (!pattern.test(interactionBody)) {
        add('interactive-state-coverage', `Interaction journey does not resolve ${concept}.`);
      }
    }
  }

  const apiBody = sectionBody(sections, 'Public API');
  const apiFences = [...apiBody.matchAll(/```(?:tsx|jsx|ts|js)\s*\n([\s\S]*?)```/gi)].map((match) => match[1]);
  if (apiFences.length < 3) {
    add('api-examples', `Public API contains ${apiFences.length} TypeScript/JavaScript fences; require a type, minimal example, and full example.`);
  }
  if (!apiFences.some((fence) => /\b(type|interface)\s+[A-Za-z]/.test(fence))) {
    add('api-type-contract', 'Public API needs a concrete type or interface contract.');
  }
  if (!/minimal valid (?:use|example)/i.test(apiBody) || !/full .{0,40}(?:use|example)/i.test(apiBody)) {
    add('api-example-labels', 'Label one minimal valid example and one full example explicitly.');
  }
  if (!/(deliberately excludes|component excludes|excluded)/i.test(apiBody)
    || !/(style|className|color|children|\bas\b)/i.test(apiBody)) {
    add('api-escape-hatches', 'Public API must explicitly define which tempting styling or composition escape hatches are excluded.');
  }
  if (apiFences.some((fence) => /\bstyle\??\s*:/.test(fence) && !/\bstyle\??\s*:\s*never\b/.test(fence))) {
    add('api-inline-style-escape', 'A governed component API cannot expose an unrestricted inline style prop while claiming to exclude arbitrary visual styling.');
  }
  const inheritedAttributePattern = BROAD_REACT_PROP_TYPE_PATTERN;
  for (const fence of apiFences.filter((candidate) => inheritedAttributePattern.test(candidate))) {
    const usesOmit = /\bOmit\s*</.test(fence);
    const explicitlyOmitsStyle = usesOmit && /['"]style['"]/.test(fence);
    const explicitlyOmitsClassName = usesOmit && /['"]className['"]/.test(fence);
    const explicitlyProhibitsStyle = /\bstyle\??\s*:\s*never\b/.test(fence);
    const explicitlyProhibitsClassName = /\bclassName\??\s*:\s*never\b/.test(fence);
    const picksVisualEscapeHatch = /\bPick\s*<[\s\S]*?['"](?:style|className)['"]/.test(fence);
    if (picksVisualEscapeHatch
      || !(explicitlyOmitsStyle || explicitlyProhibitsStyle)
      || !(explicitlyOmitsClassName || explicitlyProhibitsClassName)) {
      add('api-inherited-style-escape', 'An API inheriting React HTML attributes must explicitly omit or prohibit both style and className before claiming governed visual styling.');
    }
  }
  if (apiFences.some((fence) => /\bclassName\??\s*:/.test(fence))
    && !/(placement only|layout placement|not an alternate (?:theme|theming|styling) API)/i.test(apiBody)) {
    add('api-classname-boundary', 'If className is exposed, document its placement-only boundary and state that it is not an alternate styling API.');
  }

  const invalidBody = sectionBody(sections, 'Invalid combinations and safeguards');
  const safeguardItems = invalidBody.match(/^\s*[-*]\s+/gm) ?? [];
  const safeguardConcepts = new Set((invalidBody.match(/invalid|warn|reject|ignore|fallback|clamp|prohibit|disallow|cannot|must not|excluded/gi) ?? []).map((value) => value.toLowerCase()));
  if (safeguardItems.length < 5 || safeguardConcepts.size < 3) {
    add('invalid-safeguards', 'Invalid combinations need at least five explicit safeguards using at least three distinct prevention behaviors.');
  }

  const acceptanceBody = sectionBody(sections, 'Acceptance criteria');
  const acceptanceItems = acceptanceBody.match(/^\s*[-*]\s+\[[ xX]\]\s+/gm) ?? [];
  if (acceptanceItems.length < 15) {
    add('acceptance-count', `Acceptance criteria contain ${acceptanceItems.length} checks; at least fifteen explicit checks are required.`);
  }

  const critiqueBody = sectionBody(sections, 'Independent critique');
  const critiqueParagraphs = critiqueBody.split(/\n\s*\n/).filter((paragraph) => wordCount(paragraph) >= 25);
  if (critiqueParagraphs.length < 2
    || !/(tradeoff|trade-off|risk|weak|limitation|cost|tension|reject)/i.test(critiqueBody)) {
    add('critique-depth', 'Independent critique needs at least two substantive paragraphs and a real tradeoff, risk, limitation, or rejected direction.');
  }

  const forbiddenPlaceholders = [
    /<ComponentName>/i,
    /\bTBD\b/i,
    /\bTODO\b/i,
    /lorem ipsum/i,
    /insert (?:text|content|example)/i,
  ];
  for (const pattern of forbiddenPlaceholders) {
    if (pattern.test(markdown)) {
      add('unresolved-placeholder', `Remove unresolved placeholder matching ${pattern}.`);
    }
  }

  return {
    problems,
    metrics: {
      componentType,
      totalWords,
      requiredSections: requiredKeys.filter((key) => sections.byKey.has(key)).length,
      evidenceRows: evidence.rows.length,
      evidenceCitations: evidenceCitations.size,
      acceptanceItems: acceptanceItems.length,
      apiExamples: apiFences.length,
    },
  };
}

function removeSection(markdown, heading) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) return markdown;
  const next = markdown.indexOf('\n## ', start + marker.length);
  return next < 0
    ? markdown.slice(0, start).trimEnd()
    : `${markdown.slice(0, start)}${markdown.slice(next + 1)}`;
}

function expectCode(markdown, code, label) {
  const result = validate(markdown);
  if (!result.problems.some((problem) => problem.code === code)) {
    throw new Error(`${label}: expected error code ${code}; received ${result.problems.map((problem) => problem.code).join(', ')}`);
  }
}

function runSelfTest() {
  const examplePath = fileURLToPath(new URL('../examples/button-component-design-explanation.md', import.meta.url));
  const exemplar = fs.readFileSync(examplePath, 'utf8');
  const positive = validate(exemplar);
  if (positive.problems.length > 0) {
    throw new Error(`positive exemplar failed: ${positive.problems.map((problem) => `[${problem.code}] ${problem.message}`).join('; ')}`);
  }

  for (const heading of REQUIRED_SECTIONS) {
    expectCode(removeSection(exemplar, heading), 'missing-section', `missing ${heading}`);
  }

  expectCode(
    exemplar.replace('## Evidence and design determination', '## Component definition\n\nDuplicate body.\n\n## Evidence and design determination'),
    'duplicate-section',
    'duplicate required heading',
  );

  expectCode(
    exemplar
      .replace('## Component definition', '## __swap__')
      .replace('## Evidence and design determination', '## Component definition')
      .replace('## __swap__', '## Evidence and design determination'),
    'section-order',
    'shuffled required headings',
  );

  expectCode(
    exemplar.replace('| Current evidence | Design implication | Decision | Strongest rejected alternative |', '| Current evidence | Design implication | Strongest rejected alternative |'),
    'evidence-header',
    'missing Decision evidence column',
  );

  const evidenceRowPattern = /^\| `DESIGN\.md:428-439`.*$/m;
  const firstEvidenceRow = exemplar.match(evidenceRowPattern)?.[0];
  if (!firstEvidenceRow) throw new Error('self-test could not locate canonical evidence row');
  expectCode(
    exemplar.replace(firstEvidenceRow, `${firstEvidenceRow}\n${firstEvidenceRow}`),
    'evidence-duplicate-row',
    'duplicate evidence row',
  );

  expectCode(
    exemplar.replace(firstEvidenceRow, '| Generic evidence repeated | Generic implication repeated without substance |  | Generic alternative repeated without a reason |'),
    'evidence-row-shape',
    'empty evidence decision cell',
  );

  expectCode(
    exemplar.replace(/`(?:DESIGN\.md|client\/src\/[^`]+|docs\/design-system\/[^`]+):\d+(?:-\d+)?`/g, 'generic source'),
    'evidence-citations',
    'generic padded evidence without repository citations',
  );

  expectCode(
    exemplar.replace('`DESIGN.md:428-439`', '`made-up.md:9999`'),
    'evidence-citation-validity',
    'invented repository citation',
  );

  expectCode(
    exemplar.replace("'children' | 'className' | 'disabled' | 'style'", "'children' | 'disabled'"),
    'api-inherited-style-escape',
    'inherited style escape hatch',
  );

  expectCode(
    exemplar
      .replace('React.ButtonHTMLAttributes', 'React.HTMLAttributes')
      .replace("'children' | 'className' | 'disabled' | 'style'", "'children' | 'disabled'"),
    'api-inherited-style-escape',
    'base HTMLAttributes style escape hatch',
  );

  expectCode(
    exemplar.replace(
      'type ButtonProps = Omit<',
      "type UnsafeVisualProps = Pick<React.HTMLAttributes<HTMLDivElement>, 'style' | 'className'>;\n\ntype ButtonProps = Omit<",
    ),
    'api-inherited-style-escape',
    'Pick exposes inherited style escape hatch',
  );

  expectCode(
    exemplar.replace('Component type: `interactive-control`\n\n> Quality-floor', '> Quality-floor\n\nComponent type: `interactive-control`'),
    'component-type',
    'component type placed after explanatory prose',
  );

  const interactionHeading = '## Interaction and state journey';
  const responsiveHeading = '## Responsive behavior';
  const staticInteraction = `${interactionHeading}\n\nThis primitive is deliberately non-interactive. It has no hover, focus, pressed, selected, disabled, loading, or recovery behavior because it presents information and performs no action. It never enters the tab order or moves focus. Dynamic announcements, updates, and any neighboring controls remain parent-owned. If a future requirement adds activation, the object must be reclassified and redesigned as an interactive control rather than receiving a click handler.\n\n`;
  const staticFixture = exemplar
    .replace('Component type: `interactive-control`', 'Component type: `primitive`')
    .replace(new RegExp(`${interactionHeading}[\\s\\S]*?(?=${responsiveHeading})`), staticInteraction);
  const staticResult = validate(staticFixture);
  if (staticResult.problems.some((problem) => problem.code === 'section-depth' || problem.code === 'static-interaction-boundary')) {
    throw new Error('substantive static inapplicability explanation did not pass the component-type-aware interaction gate');
  }

  expectCode(`${exemplar}\n\nTODO`, 'unresolved-placeholder', 'placeholder variant');

  process.stdout.write('SELF-TEST PASS: positive exemplar and targeted regression cases behaved as expected.\n');
}

const argument = process.argv[2];

if (!argument || argument === '--help') {
  process.stdout.write('Usage: node validate-component-explanation.mjs <explanation.md>\n');
  process.stdout.write('       node validate-component-explanation.mjs --self-test\n');
  process.exit(argument ? 0 : 2);
}

if (argument === '--self-test') {
  runSelfTest();
  process.exit(0);
}

const explanationPath = path.resolve(argument);
if (!fs.existsSync(explanationPath) || !fs.statSync(explanationPath).isFile()) {
  process.stderr.write(`STRUCTURE FAIL: explanation file not found: ${explanationPath}\n`);
  process.exit(2);
}

const markdown = fs.readFileSync(explanationPath, 'utf8');
const result = validate(markdown);

if (result.problems.length > 0) {
  process.stderr.write(`STRUCTURE FAIL: ${explanationPath}\n`);
  for (const problem of result.problems) {
    process.stderr.write(`- [${problem.code}] ${problem.message}\n`);
  }
  process.stderr.write(`Metrics: ${JSON.stringify(result.metrics)}\n`);
  process.exit(1);
}

process.stdout.write(`STRUCTURE PASS: ${explanationPath}\n`);
process.stdout.write('This does not prove design quality, factual accuracy, or prototype agreement.\n');
process.stdout.write(`Metrics: ${JSON.stringify(result.metrics)}\n`);
