#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { containsBroadReactPropType } from './component-validator-shared.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..', '..', '..');
const REPOSITORY_ROOT = fs.realpathSync(process.env.COMPONENT_RELEASE_REPO_ROOT || DEFAULT_REPOSITORY_ROOT);
const componentName = process.argv[2];
const suppliedSlug = process.argv[3];

function kebabCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

if (!componentName || !/^[A-Z][A-Za-z0-9]*$/.test(componentName)) {
  console.error('RELEASE FAIL');
  console.error('- USAGE: provide a PascalCase component name and optional kebab-case slug.');
  process.exit(1);
}

const slug = suppliedSlug || kebabCase(componentName);
const issues = [];
const note = (code, message) => issues.push({ code, message });
const absolute = (...parts) => path.join(REPOSITORY_ROOT, ...parts);
const relative = (file) => path.relative(REPOSITORY_ROOT, file).replaceAll('\\', '/');

function readRequired(file, code) {
  if (!fs.existsSync(file)) {
    note(code, `Missing ${relative(file)}.`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function filesUnder(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(file, predicate));
    else if (predicate(file)) files.push(file);
  }
  return files;
}

function namedPageBlock(content, name) {
  const matcher = new RegExp(`(?:export\\s+)?(?:function|const)\\s+${name}Page\\b`);
  const match = matcher.exec(content);
  if (!match) return '';
  const rest = content.slice(match.index + match[0].length);
  const next = rest.search(/\n(?:export\s+)?(?:function|const)\s+[A-Z][A-Za-z0-9]*Page\b/);
  return content.slice(match.index, next < 0 ? undefined : match.index + match[0].length + next);
}

function section(markdown, heading, nextHeading = '## ') {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const searchFrom = start + heading.length + 3;
  const end = markdown.indexOf(nextHeading, searchFrom);
  return markdown.slice(start, end < 0 ? undefined : end);
}

function sorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sameSet(left, right) {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function splitMarkdownRow(line) {
  const cells = [];
  let cell = '';
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\' && line[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (character === '|') {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells.slice(1, -1).map((value) => value.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim());
}

function propRows(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitMarkdownRow(line.trim());
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(cells[0] || '') && cells[0].toLowerCase() !== 'prop') rows.set(cells[0], cells);
  }
  return rows;
}

function numberedSection(markdown, heading) {
  const matcher = new RegExp(`^##\\s+(?:\\d+\\.\\s+)?${escapeRegExp(heading)}\\s*$`, 'm');
  const match = matcher.exec(markdown);
  if (!match) return '';
  const searchFrom = match.index + match[0].length;
  const next = markdown.slice(searchFrom).search(/^##\s+/m);
  return markdown.slice(match.index, next < 0 ? undefined : searchFrom + next);
}

function defaultImportBinding(content, specifierPattern) {
  const match = content.match(new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+['\"]${specifierPattern}['\"]`));
  return match?.[1] ?? '';
}

function matchingDelimiter(content, start, open, close) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(content) {
  const entries = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  const depth = { '(': 0, '[': 0, '{': 0 };
  const closing = { ')': '(', ']': '[', '}': '{' };
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (depth[character] !== undefined) depth[character] += 1;
    if (closing[character]) depth[closing[character]] -= 1;
    if (character === ',' && Object.values(depth).every((value) => value === 0)) {
      entries.push(content.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(content.slice(start));
  return entries;
}

function destructuredComponentProps(content, name) {
  const namedFunction = new RegExp(`function\\s+${name}\\s*\\(`).exec(content);
  const assignedComponent = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`).exec(content);
  let searchStart = -1;
  let searchEnd = content.length;
  if (namedFunction) {
    searchStart = namedFunction.index + namedFunction[0].length;
    const signatureEnd = matchingDelimiter(content, searchStart - 1, '(', ')');
    searchEnd = signatureEnd < 0 ? content.length : signatureEnd;
  } else if (assignedComponent) {
    searchStart = assignedComponent.index + assignedComponent[0].length;
    const arrow = content.indexOf('=>', searchStart);
    if (arrow >= 0) searchEnd = arrow;
  }
  if (searchStart < 0) return null;
  const objectStart = content.indexOf('{', searchStart);
  if (objectStart < 0 || objectStart > searchEnd) return null;
  const objectEnd = matchingDelimiter(content, objectStart, '{', '}');
  if (objectEnd < 0 || objectEnd > searchEnd) return null;

  const names = [];
  for (const rawEntry of splitTopLevel(content.slice(objectStart + 1, objectEnd))) {
    const entry = rawEntry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
    if (!entry || entry.startsWith('...')) continue;
    const quoted = entry.match(/^['\"]([^'\"]+)['\"]\s*:/);
    const plain = entry.match(/^([A-Za-z_$][\w$]*)\b/);
    if (quoted) names.push(quoted[1]);
    else if (plain) names.push(plain[1]);
  }
  return names;
}

function pngDimensions(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const componentDirectory = absolute('client', 'src', 'components', 'design-system', componentName);
const requiredFiles = {
  source: path.join(componentDirectory, `${componentName}.jsx`),
  styles: path.join(componentDirectory, `${componentName}.css`),
  tests: path.join(componentDirectory, `${componentName}.test.jsx`),
  explanation: path.join(componentDirectory, `${componentName}.md`),
  contract: path.join(componentDirectory, `${componentName}.contract.json`),
};

if (!fs.existsSync(componentDirectory) || !fs.statSync(componentDirectory).isDirectory()) {
  note('FOLDER', `Missing PascalCase component folder ${relative(componentDirectory)}.`);
}

const source = readRequired(requiredFiles.source, 'SOURCE');
const styles = readRequired(requiredFiles.styles, 'STYLES');
const componentTests = readRequired(requiredFiles.tests, 'TESTS');
const explanation = readRequired(requiredFiles.explanation, 'EXPLANATION');
const contractSource = readRequired(requiredFiles.contract, 'CONTRACT_MANIFEST');
let contract = null;
if (contractSource) {
  try {
    contract = JSON.parse(contractSource);
  } catch {
    note('CONTRACT_JSON', `${relative(requiredFiles.contract)} is not valid JSON.`);
  }
}
if (contract) {
  for (const field of ['name', 'slug', 'classification', 'status']) {
    if (typeof contract[field] !== 'string' || !contract[field].trim()) {
      note('CONTRACT_SCHEMA', `Contract manifest field ${field} must be a non-empty string.`);
    }
  }
  if (contract.name !== componentName || contract.slug !== slug) {
    note('CONTRACT_IDENTITY', `Contract manifest identity ${contract.name}/${contract.slug} does not match ${componentName}/${slug}.`);
  }
  if (!Array.isArray(contract.props) || contract.props.length === 0) {
    note('CONTRACT_API', `${componentName}.contract.json must contain a non-empty props array.`);
  } else {
    const propNames = [];
    for (const prop of contract.props) {
      if (!prop || typeof prop !== 'object') {
        note('CONTRACT_SCHEMA', 'Every contract prop must be an object.');
        continue;
      }
      for (const field of ['name', 'values', 'default', 'purpose']) {
        if (typeof prop[field] !== 'string' || !prop[field].trim()) {
          note('CONTRACT_SCHEMA', `Contract prop ${prop.name || '<unnamed>'} field ${field} must be a non-empty string.`);
        }
      }
      if (prop.allowed !== undefined && (!Array.isArray(prop.allowed) || !prop.allowed.length || prop.allowed.some((value) => typeof value !== 'string' || !value))) {
        note('CONTRACT_SCHEMA', `Contract prop ${prop.name || '<unnamed>'} allowed must be a non-empty string array when present.`);
      }
      if (typeof prop.name === 'string') propNames.push(prop.name);
    }
    if (new Set(propNames).size !== propNames.length) note('CONTRACT_SCHEMA', 'Contract prop names must be unique.');
  }
  if (!Array.isArray(contract.blockedProps) || contract.blockedProps.some((value) => typeof value !== 'string' || !value)) {
    note('CONTRACT_SCHEMA', 'Contract manifest blockedProps must be an array of source-rejected prop names.');
  } else if (new Set(contract.blockedProps).size !== contract.blockedProps.length) {
    note('CONTRACT_SCHEMA', 'Contract blockedProps names must be unique.');
  }
  if (!Array.isArray(contract.assertions) || contract.assertions.length === 0) {
    note('CONTRACT_ASSERTIONS', `${componentName}.contract.json must contain non-empty behavior assertions.`);
  } else {
    const assertionIds = [];
    for (const assertion of contract.assertions) {
      for (const field of ['id', 'sourceIncludes', 'testIncludes', 'docsIncludes', 'explanationIncludes']) {
        if (!assertion || typeof assertion[field] !== 'string' || !assertion[field].trim()) {
          note('CONTRACT_ASSERTIONS', `Every behavior assertion requires a non-empty ${field}.`);
        }
      }
      if (typeof assertion?.id === 'string') assertionIds.push(assertion.id);
    }
    if (new Set(assertionIds).size !== assertionIds.length) note('CONTRACT_ASSERTIONS', 'Behavior assertion ids must be unique.');
  }
}

if (explanation) {
  const validator = path.join(SCRIPT_DIRECTORY, 'validate-component-explanation.mjs');
  const result = spawnSync(process.execPath, [validator, requiredFiles.explanation], { encoding: 'utf8' });
  if (result.status !== 0) {
    note('EXPLANATION_STRUCTURE', `${componentName}.md does not pass the explanation validator.`);
  }
}

const barrelPath = absolute('client', 'src', 'components', 'design-system', 'index.js');
const barrel = readRequired(barrelPath, 'BARREL');
const exportPattern = new RegExp(`export\\s+\\{\\s*default\\s+as\\s+${componentName}\\s*\\}\\s+from\\s+['\"]\\./${componentName}(?:/${componentName}\\.jsx)?['\"]`);
if (barrel && !exportPattern.test(barrel)) {
  note('PUBLIC_EXPORT', `${componentName} is not exported from ${relative(barrelPath)}.`);
}

const navigationPath = absolute('client', 'src', 'docs', 'docsNavigation.js');
const navigation = readRequired(navigationPath, 'DOCS_NAVIGATION');
const route = `/docs/components/${slug}`;
const navigationEntryPattern = new RegExp(`path:\\s*['\"]${route.replaceAll('/', '\\/')}['\"][\\s\\S]{0,700}?title:\\s*['\"]${componentName}['\"][\\s\\S]{0,700}?status:\\s*['\"]Available['\"]`);
const isAvailable = navigationEntryPattern.test(navigation);
if (!navigation.includes(`path: '${route}'`) && !navigation.includes(`path: "${route}"`)) {
  note('DOCS_ROUTE', `${route} is not registered in docs navigation/search.`);
}
if (!navigation.includes(`title: '${componentName}'`) && !navigation.includes(`title: "${componentName}"`)) {
  note('DOCS_SEARCH', `${componentName} is not named in docs navigation/search.`);
}
if (!isAvailable) note('NAVIGATION_STATUS', `${route} must have exact Available status for a release validation.`);
if (contract && contract.status !== 'available') {
  note('CONTRACT_STATUS', `${componentName}.contract.json status must be available for a release validation.`);
}

const docsDirectory = absolute('client', 'src', 'docs');
const docsCodeFiles = filesUnder(docsDirectory, (file) => /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.[cm]?[jt]sx?$/.test(file));
const docsCode = docsCodeFiles.map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }));
const pageCandidates = docsCode.filter(({ content }) => namedPageBlock(content, componentName));
let pageSource = '';
let targetPage = '';
let pageModulePath = '';
if (pageCandidates.length !== 1) {
  note('DOCS_PAGE_COMPONENT', `Expected exactly one inspectable ${componentName}Page under client/src/docs; found ${pageCandidates.length}.`);
} else {
  pageModulePath = pageCandidates[0].file;
  pageSource = pageCandidates[0].content;
  targetPage = namedPageBlock(pageSource, componentName);
}
const routeLiteral = escapeRegExp(route);
const routeBindingPatterns = [
  new RegExp(`['\"]${routeLiteral}['\"]\\s*:\\s*${componentName}Page\\b`),
  new RegExp(`path\\s*[:=]\\s*['\"]${routeLiteral}['\"][\\s\\S]{0,240}?(?:component|element)\\s*[:=]\\s*(?:\\{?\\s*<)?${componentName}Page\\b`),
];
const mappedRoute = docsCode.some(({ content }) => routeBindingPatterns.some((pattern) => pattern.test(content)));
if (!mappedRoute) note('DOCS_PAGE_MAP', `${route} is not mapped to ${componentName}Page in the docs source tree.`);
const publicImportPattern = new RegExp(`import\\s*\\{[^}]*\\b${componentName}\\b[^}]*\\}\\s*from\\s*['\"][^'\"]*components/design-system/index\\.js['\"]`);
if (!publicImportPattern.test(pageSource)) {
  note('DOCS_PUBLIC_IMPORT', `${componentName} docs must import the public design-system barrel.`);
}
if (!new RegExp(`<${componentName}(?:\\s|>)`).test(targetPage)) {
  note('LIVE_SPECIMEN', `${componentName}Page does not visibly use the production ${componentName} export.`);
}
for (const requiredId of ['overview', 'anatomy', 'visual-system', 'states', 'usage', 'api', 'accessibility', 'quality']) {
  if (!targetPage.includes(`id="${requiredId}"`)) note('DOCS_CHAPTER', `${componentName}Page is missing the ${requiredId} chapter.`);
}
const conventionalFirstViewport = targetPage.includes('Canonical default') && targetPage.includes('CodeBlock');
const overviewIndex = targetPage.indexOf('id="overview"');
const glanceIndex = targetPage.indexOf('id="at-a-glance"');
const mapIndex = targetPage.indexOf('id="specification-map"');
const codeIndex = targetPage.indexOf('CodeBlock');
const stagedReferencePage = overviewIndex >= 0
  && glanceIndex > overviewIndex
  && mapIndex > glanceIndex
  && codeIndex > mapIndex
  && targetPage.includes('Component design specification');
if (!conventionalFirstViewport && !stagedReferencePage) {
  note('FIRST_VIEWPORT', `${componentName}Page must provide either a canonical default with a copyable example or an identity-first cover followed by a visual family, specification map, and later copyable example.`);
}
const docsContractBinding = defaultImportBinding(
  pageSource,
  `[^'\"]*components/design-system/${componentName}/${componentName}\\.contract\\.json`,
);
if (!docsContractBinding || !targetPage.includes(`${docsContractBinding}.props.map`)) {
  note('DOCS_CONTRACT_SOURCE', `${componentName}Page must render its prop table from ${componentName}.contract.json.`);
}

const docsTestFiles = filesUnder(docsDirectory, (file) => /\.test\.[cm]?[jt]sx?$/.test(file));
const docsTestCandidates = docsTestFiles
  .map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }))
  .filter(({ content }) => content.includes(route));
const docsTests = docsTestCandidates.map(({ content }) => content).join('\n');
const testRouteIndex = docsTests.indexOf(route);
const targetTest = testRouteIndex < 0 ? '' : docsTests.slice(Math.max(0, testRouteIndex - 900), testRouteIndex + 3800);
if (!targetTest.includes(route) || !targetTest.includes(`name: '${componentName}'`) || !targetTest.includes('live production specimens')) {
  note('DOCS_TEST_COVERAGE', `Focused docs tests do not cover ${route} and its ${componentName} heading.`);
}

const docsCssFiles = filesUnder(docsDirectory, (file) => file.endsWith('.css'));
for (const docsCssPath of docsCssFiles) {
  const docsCss = fs.readFileSync(docsCssPath, 'utf8');
  for (const block of docsCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!block[1].includes(`.qds-${slug}`)) continue;
    if (/(?:^|;)\s*(?:background(?:-color)?|border(?:-[a-z-]+)?|box-shadow|color|font(?:-[a-z-]+)?|opacity|outline(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|transform)\s*:/m.test(block[2])) {
      note('DOCS_STYLE_DUPLICATION', `${relative(docsCssPath)} recreates production appearance for .qds-${slug}.`);
    }
  }
}

const registryPath = absolute('docs', 'design-system', 'COMPONENT_LIBRARY.md');
const registry = readRequired(registryPath, 'REGISTRY');
const registryStart = registry.search(new RegExp('^# Component \\d+ — `' + componentName + '`', 'm'));
let registryBlock = '';
if (registryStart < 0) {
  note('REGISTRY_ENTRY', `Missing ${componentName} component entry in ${relative(registryPath)}.`);
} else {
  const rest = registry.slice(registryStart + 1);
  const next = rest.search(/^# (?:Component|Shared|Change|Release)/m);
  registryBlock = registry.slice(registryStart, next < 0 ? undefined : registryStart + 1 + next);
  if (!registryBlock.includes(`${componentName}.md`) || !registryBlock.includes(route)) {
    note('REGISTRY_LINKS', `${componentName} registry entry must name its detailed contract and live route.`);
  }
}

const registryStatus = registryBlock.match(/^\*\*Status:\*\*\s*`?([^`\s]+)`?\s*$/m)?.[1];
const registryClassification = registryBlock.match(/^\*\*Classification:\*\*\s*`?([^`\s]+)`?\s*$/m)?.[1];
const explanationClassification = explanation.match(/^Component type:\s*`([^`]+)`\s*$/m)?.[1];
if (contract) {
  if (explanationClassification !== contract.classification) {
    note('CONTRACT_CLASSIFICATION', 'Markdown Component type disagrees with the contract classification.');
  }
  if (registryClassification !== contract.classification) {
    note('REGISTRY_CLASSIFICATION', 'Registry Classification disagrees with the contract manifest.');
  }
  if (registryStatus !== contract.status) {
    note('REGISTRY_STATUS', 'Registry Status disagrees with the contract manifest.');
  }
}

if (isAvailable) {
  const unresolvedExplanation = explanation.match(/^\s*[-*+]\s+\[ \]/gm) ?? [];
  const unresolvedRegistry = registryBlock.match(/^\s*[-*+]\s+\[ \]/gm) ?? [];
  if (unresolvedExplanation.length || unresolvedRegistry.length) {
    note('UNCHECKED_ACCEPTANCE', `Available ${componentName} has ${unresolvedExplanation.length + unresolvedRegistry.length} unresolved acceptance items.`);
  }
}

const apiSection = section(explanation, 'Public API');
if (containsBroadReactPropType(apiSection)) {
  note('BROAD_API_TYPE', 'Markdown Public API must enumerate the approved pass-through surface instead of inheriting broad HTML attributes.');
}
const markdownApi = propRows(apiSection);
const registryApi = propRows(numberedSection(registryBlock, 'Public API'));
const contractProps = Array.isArray(contract?.props) ? contract.props : [];
const contractPropNames = contractProps.map((prop) => prop.name).filter((name) => typeof name === 'string');
const sourceProps = destructuredComponentProps(source, componentName);
if (!sameSet(markdownApi.keys(), contractPropNames)) {
  note('MARKDOWN_API_SET', 'Markdown Public API prop names do not exactly match the contract manifest.');
}
if (!sameSet(registryApi.keys(), contractPropNames)) {
  note('REGISTRY_API_SET', 'Registry Public API prop names do not exactly match the contract manifest.');
}
for (const prop of contractProps) {
  const markdownRow = markdownApi.get(prop.name);
  const registryRow = registryApi.get(prop.name);
  if (!markdownRow || markdownRow[1] !== prop.values || markdownRow[2] !== prop.default) {
    note('MARKDOWN_API', `${prop.name} values/default disagree with the contract manifest.`);
  }
  if (!registryRow || registryRow[1] !== prop.values || registryRow[2] !== prop.default) {
    note('REGISTRY_API', `${prop.name} values/default disagree with the contract manifest.`);
  }
  if (source && !sourceProps?.includes(prop.name)) {
    note('SOURCE_API', `Contract prop ${prop.name} is not explicit in ${componentName}.jsx.`);
  }
}
const sourceContractBinding = defaultImportBinding(source, `\\./${componentName}\\.contract\\.json`);
if (contract && (!sourceContractBinding || !source.includes(`${sourceContractBinding}.props`))) {
  note('SOURCE_CONTRACT', `${componentName}.jsx must derive governed enum/default data from its contract manifest.`);
}

if (!sourceProps) {
  note('SOURCE_API_SET', `${componentName}.jsx must expose an inspectable named destructured component boundary.`);
} else if (contract) {
  const expectedSourceProps = [...contractPropNames, ...(Array.isArray(contract.blockedProps) ? contract.blockedProps : [])];
  if (!sameSet(sourceProps, expectedSourceProps)) {
    note('SOURCE_API_SET', 'Source destructured props do not exactly match contract props plus blockedProps.');
  }
}

for (const assertion of Array.isArray(contract?.assertions) ? contract.assertions : []) {
  for (const [field, content, label] of [
    ['sourceIncludes', source, 'source'],
    ['testIncludes', componentTests, 'component test'],
    ['docsIncludes', targetPage, 'target docs page'],
    ['explanationIncludes', explanation, 'authoritative explanation'],
  ]) {
    if (!assertion[field] || !content.includes(assertion[field])) {
      note('BEHAVIOR_ASSERTION', `${assertion.id} is not synchronized with its ${label} evidence.`);
    }
  }
}

if (componentTests && !componentTests.includes(`describe('${componentName}'`)) {
  note('COMPONENT_TEST_NAME', `${componentName}.test.jsx does not contain a named ${componentName} suite.`);
}

const assetDirectory = absolute('docs', 'design-system', 'assets', slug);
let assetNames = [];
let requiredEvidenceGroups = [];
if (!fs.existsSync(assetDirectory)) {
  note('ASSET_DIRECTORY', `Missing release evidence directory ${relative(assetDirectory)}.`);
} else {
  assetNames = fs.readdirSync(assetDirectory);
  const pngs = assetNames.filter((name) => name.toLowerCase().endsWith('.png'));
  const prototypes = pngs.filter((name) => /prototype/i.test(name));
  const desktops = pngs.filter((name) => /desktop/i.test(name) && (pngDimensions(path.join(assetDirectory, name))?.width ?? 0) >= 1024);
  const exactMobile = pngs.filter((name) => /390/i.test(name) && pngDimensions(path.join(assetDirectory, name))?.width === 390);
  if (!prototypes.length) note('APPROVED_BASELINE', 'Missing approved prototype PNG.');
  if (!desktops.length) note('DESKTOP_EVIDENCE', 'Missing desktop rendered evidence PNG at least 1024px wide.');
  if (!exactMobile.length) note('MOBILE_EVIDENCE', 'Missing rendered evidence PNG whose filename and actual width are exactly 390px.');
  requiredEvidenceGroups = [
    { label: 'approved prototype', names: prototypes },
    { label: 'desktop render', names: desktops },
    { label: 'exact-390 render', names: exactMobile },
  ].filter((group) => group.names.length);
}

const releaseRecordPath = path.join(assetDirectory, 'release-record.md');
const releaseRecord = readRequired(releaseRecordPath, 'RELEASE_RECORD');
if (releaseRecord && !/^- Exact reviewer first line: `YES — RELEASE QUALITY`\s*$/m.test(releaseRecord)) {
  note('RELEASE_VERDICT', 'Release record does not contain the exact affirmative independent-verdict field.');
}
if (releaseRecord) {
  for (const phrase of ['Product/UX designer', 'Design/Experience Reviewer', 'Separate from builder?', 'Approved baseline', 'Reconciliation result', 'Focused correction rounds used:']) {
    if (!releaseRecord.includes(phrase)) note('RELEASE_RECORD_FIELD', `Release record is missing ${phrase}.`);
  }
  if (!/^\|\s*Design\/Experience Reviewer\s*\|\s*[^|]+\|\s*yes\s*\|/im.test(releaseRecord)) {
    note('REVIEWER_INDEPENDENCE', 'Release record does not prove the design reviewer was separate from the builder.');
  }
  const adoption = releaseRecord.match(/^- Adoption status:\s*(.+)$/m)?.[1]?.trim();
  if (!adoption || !/^(?:available; no legacy consumers|adopted in .+|migration pending)$/i.test(adoption)) {
    note('ADOPTION_STATUS', 'Release record must contain exactly one allowed adoption status.');
  }
  const completionDecision = releaseRecord.match(/^- Main-agent completion decision:\s*(.+)$/m)?.[1]?.trim();
  if (contract?.status === 'available' && (!completionDecision || !/\bavailable\b/i.test(completionDecision))) {
    note('RELEASE_STATUS', 'Release record completion decision must affirm the available contract status.');
  }
  for (const group of requiredEvidenceGroups) {
    if (!group.names.some((evidence) => releaseRecord.includes(evidence))) {
      note('EVIDENCE_LINKAGE', `Release record does not reference any available ${group.label} evidence.`);
    }
  }
}

if (issues.length) {
  console.error('RELEASE FAIL');
  for (const item of issues) console.error(`- ${item.code}: ${item.message}`);
  process.exit(1);
}

console.log('RELEASE PASS');
console.log(`- ${componentName} folder, contract, export, registry, route, live docs, tests, evidence, and release record are present.`);
console.log(`- Public props agree across ${componentName}.md and the routed docs table.`);
console.log('- Available-state acceptance items are resolved and the independent release verdict is recorded.');
