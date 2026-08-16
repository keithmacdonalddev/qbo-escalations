#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const validator = path.join(scriptDirectory, 'validate-component-release.mjs');
const repositoryRoot = fs.realpathSync(path.resolve(scriptDirectory, '..', '..', '..', '..'));
const temporaryParent = fs.realpathSync(os.tmpdir());

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(path.join(repositoryRoot, source), destination, { recursive: true });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(temporaryParent, 'component-release-validator-'));
  assert.ok(root.startsWith(temporaryParent), 'Fixture must remain inside the operating-system temp directory.');
  copy('client/src/components/design-system/Button', path.join(root, 'client/src/components/design-system/Button'));
  copy('client/src/components/design-system/index.js', path.join(root, 'client/src/components/design-system/index.js'));
  for (const file of ['DocsPages.jsx', 'DocsApp.test.jsx', 'docsNavigation.js', 'button-docs.css']) {
    copy(`client/src/docs/${file}`, path.join(root, `client/src/docs/${file}`));
  }
  copy('docs/design-system/COMPONENT_LIBRARY.md', path.join(root, 'docs/design-system/COMPONENT_LIBRARY.md'));
  for (const file of ['Button-prototype-v2.png', 'Button-docs-v5-cover-desktop-1534.png', 'Button-docs-v5-cover-390.png', 'release-record.md']) {
    copy(`docs/design-system/assets/button/${file}`, path.join(root, `docs/design-system/assets/button/${file}`));
  }
  return root;
}

function replaceInFile(file, replacements) {
  let content = fs.readFileSync(file, 'utf8');
  for (const [from, to] of replacements) content = content.replaceAll(from, to);
  fs.writeFileSync(file, content);
}

function nonButtonFixture() {
  const root = fixture();
  const oldComponentDirectory = path.join(root, 'client/src/components/design-system/Button');
  const componentDirectory = path.join(root, 'client/src/components/design-system/ProgressIndicator');
  fs.renameSync(oldComponentDirectory, componentDirectory);
  for (const extension of ['jsx', 'css', 'test.jsx', 'md', 'contract.json']) {
    fs.renameSync(
      path.join(componentDirectory, `Button.${extension}`),
      path.join(componentDirectory, `ProgressIndicator.${extension}`),
    );
  }

  const oldAssets = path.join(root, 'docs/design-system/assets/button');
  const assets = path.join(root, 'docs/design-system/assets/progress-indicator');
  fs.renameSync(oldAssets, assets);
  for (const name of fs.readdirSync(assets)) {
    if (name.includes('Button')) fs.renameSync(path.join(assets, name), path.join(assets, name.replaceAll('Button', 'ProgressIndicator')));
  }

  const oldDocsCss = path.join(root, 'client/src/docs/button-docs.css');
  const docsCss = path.join(root, 'client/src/docs/progress-indicator-docs.css');
  fs.renameSync(oldDocsCss, docsCss);

  const replacements = [
    ['BUTTON_CONTRACT', 'PROGRESS_INDICATOR_CONTRACT'],
    ['buttonContract', 'progressIndicatorContract'],
    ['.qds-button', '.qds-progress-indicator'],
    ['button-docs', 'progress-indicator-docs'],
    ['/docs/components/button', '/docs/components/progress-indicator'],
    ['assets/button', 'assets/progress-indicator'],
    ['"slug": "button"', '"slug": "progress-indicator"'],
    ['Button', 'ProgressIndicator'],
  ];
  const files = [
    ...fs.readdirSync(componentDirectory).map((name) => path.join(componentDirectory, name)),
    path.join(root, 'client/src/components/design-system/index.js'),
    path.join(root, 'client/src/docs/DocsPages.jsx'),
    path.join(root, 'client/src/docs/DocsApp.test.jsx'),
    path.join(root, 'client/src/docs/docsNavigation.js'),
    docsCss,
    path.join(root, 'docs/design-system/COMPONENT_LIBRARY.md'),
    path.join(assets, 'release-record.md'),
  ];
  for (const file of files) replaceInFile(file, replacements);
  return root;
}

function run(root, componentName = 'Button', slug = 'button') {
  return spawnSync(process.execPath, [validator, componentName, slug], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, COMPONENT_RELEASE_REPO_ROOT: root },
  });
}

function withFixture(name, mutate, expectedCode, create = fixture, target = ['Button', 'button']) {
  const root = create();
  try {
    mutate?.(root);
    const result = run(root, ...target);
    const output = `${result.stdout}\n${result.stderr}`;
    if (expectedCode === 'PASS') {
      assert.equal(result.status, 0, `${name} should pass:\n${output}`);
      assert.match(output, /RELEASE PASS/);
    } else {
      assert.notEqual(result.status, 0, `${name} should fail.`);
      assert.match(output, new RegExp(expectedCode), `${name} should report ${expectedCode}:\n${output}`);
    }
  } finally {
    assert.ok(root.startsWith(temporaryParent), 'Refusing to clean a non-temp fixture.');
    fs.rmSync(root, { recursive: true, force: true });
  }
}

withFixture('complete release graph', null, 'PASS');
withFixture('non-Button complete release graph', null, 'PASS', nonButtonFixture, ['ProgressIndicator', 'progress-indicator']);

withFixture('single-argument named component source', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.jsx');
  const source = fs.readFileSync(file, 'utf8')
    .replace('const Button = forwardRef(function Button(', 'function Button(')
    .replace('  },\n  ref,\n) {', '  },\n) {')
    .replace('      ref={ref}\n', '')
    .replace('\n});\n\nexport default Button;', '\n}\n\nexport default Button;');
  fs.writeFileSync(file, source);
}, 'PASS');

withFixture('inline arrow-function component source', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.jsx');
  const source = fs.readFileSync(file, 'utf8')
    .replace('const Button = forwardRef(function Button(', 'const Button = (')
    .replace('  },\n  ref,\n) {', '  },\n) => {')
    .replace("    priority = defaultValue('priority'),\n    tone = defaultValue('tone'),", "    priority = defaultValue('priority'), tone = defaultValue('tone'),")
    .replace('      ref={ref}\n', '')
    .replace('\n});\n\nexport default Button;', '\n};\n\nexport default Button;');
  fs.writeFileSync(file, source);
}, 'PASS');

withFixture('separate docs module without component CSS', (root) => {
  const pagesFile = path.join(root, 'client/src/docs/DocsPages.jsx');
  const pages = fs.readFileSync(pagesFile, 'utf8');
  const start = pages.indexOf('function ButtonPage(');
  const end = pages.indexOf('\nfunction ReleaseChecklistPage(', start);
  const withoutPage = pages.slice(0, start) + pages.slice(end);
  fs.writeFileSync(
    pagesFile,
    `import { ButtonPage } from './ButtonDocsPage.jsx';\n${withoutPage.replace("import './button-docs.css';\n", '')}`,
  );
  fs.writeFileSync(
    path.join(root, 'client/src/docs/ButtonDocsPage.jsx'),
    `import { Button } from '../components/design-system/index.js';
import BUTTON_CONTRACT from '../components/design-system/Button/Button.contract.json';

export function ButtonPage() {
  return <>
    <section id="overview"><h2>Canonical default</h2><Button>Review details</Button><CodeBlock /></section>
    <section id="anatomy">Anatomy</section>
    <section id="visual-system">Visual system</section>
    <section id="states">States</section>
    <section id="usage">Usage</section>
    <section id="api">{BUTTON_CONTRACT.props.map((prop) => <span key={prop.name}>{prop.name}</span>)}</section>
    <section id="accessibility">Enter and Space activate exactly once. Native type defaults to button; submit and reset remain explicit caller choices.</section>
    <section id="quality">An empty visible label renders no control and warns in development. Loading plus disabled warns; loading takes precedence. The icon slot accepts only one passive inline SVG tree. <code>onClick</code> is the sole action handler. Resting and loading content share one grid cell.</section>
  </>;
}
`,
  );
  fs.rmSync(path.join(root, 'client/src/docs/button-docs.css'));
}, 'PASS');

withFixture('target-page specimen isolation', (root) => {
  const file = path.join(root, 'client/src/docs/DocsPages.jsx');
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('function ButtonPage(');
  const end = source.indexOf('\nfunction ReleaseChecklistPage(', start);
  const page = source.slice(start, end).replaceAll('<Button', '<div');
  fs.writeFileSync(file, source.slice(0, start) + page + source.slice(end));
}, 'LIVE_SPECIMEN');

withFixture('actual route-map binding', (root) => {
  const file = path.join(root, 'client/src/docs/DocsPages.jsx');
  const source = fs.readFileSync(file, 'utf8').replace("  '/docs/components/button': ButtonPage,\n", '');
  fs.writeFileSync(file, source);
}, 'DOCS_PAGE_MAP');

withFixture('exact 390 evidence', (root) => {
  const directory = path.join(root, 'docs/design-system/assets/button');
  fs.renameSync(path.join(directory, 'Button-docs-v5-cover-390.png'), path.join(directory, 'Button-docs-v5-cover-mobile.png'));
}, 'MOBILE_EVIDENCE');

withFixture('alternate unchecked checklist syntax', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.md');
  fs.appendFileSync(file, '\n  * [ ] Unresolved fixture assertion\n');
}, 'UNCHECKED_ACCEPTANCE');

withFixture('semantic default disagreement', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.contract.json');
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  contract.props.find((prop) => prop.name === 'priority').default = 'tertiary';
  fs.writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
}, 'MARKDOWN_API');

withFixture('missing behavior assertions', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.contract.json');
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  contract.assertions = [];
  fs.writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
}, 'CONTRACT_ASSERTIONS');

withFixture('stale Markdown prop', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.md');
  const source = fs.readFileSync(file, 'utf8').replace(
    '\n## Invalid combinations and safeguards',
    '\n| `staleProp` | string | none | Stale fixture | Must fail |\n\n## Invalid combinations and safeguards',
  );
  fs.writeFileSync(file, source);
}, 'MARKDOWN_API_SET');

withFixture('contract status disagreement', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.contract.json');
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  contract.status = 'proposed';
  fs.writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
}, 'CONTRACT_STATUS');

withFixture('broad documented native attributes', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.md');
  const source = fs.readFileSync(file, 'utf8').replace(
    'type ButtonProps = {',
    'type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, \'children\'> & {',
  );
  fs.writeFileSync(file, source);
}, 'BROAD_API_TYPE');

for (const [name, inheritedType] of [
  ['ComponentPropsWithoutRef', "React.ComponentPropsWithoutRef<'button'>"],
  ['ComponentPropsWithRef', "React.ComponentPropsWithRef<'button'>"],
  ['ComponentProps', "React.ComponentProps<'button'>"],
  ['JSX IntrinsicElements', "JSX.IntrinsicElements['button']"],
]) {
  withFixture(`broad documented ${name} attributes`, (root) => {
    const file = path.join(root, 'client/src/components/design-system/Button/Button.md');
    const source = fs.readFileSync(file, 'utf8').replace(
      'type ButtonProps = {',
      `type ButtonProps = Omit<${inheritedType}, 'children'> & {`,
    );
    fs.writeFileSync(file, source);
  }, 'BROAD_API_TYPE');
}

withFixture('uncontracted source prop', (root) => {
  const file = path.join(root, 'client/src/components/design-system/Button/Button.jsx');
  const source = fs.readFileSync(file, 'utf8').replace(
    "    priority = defaultValue('priority'),",
    "    uncontractedVariant,\n    priority = defaultValue('priority'),",
  );
  fs.writeFileSync(file, source);
}, 'SOURCE_API_SET');

withFixture('documentation appearance duplication', (root) => {
  const file = path.join(root, 'client/src/docs/button-docs.css');
  fs.appendFileSync(file, '\n.docs-fake .qds-button { background: pink; }\n');
}, 'DOCS_STYLE_DUPLICATION');

withFixture('negated release verdict', (root) => {
  const file = path.join(root, 'docs/design-system/assets/button/release-record.md');
  const record = fs.readFileSync(file, 'utf8').replace(
    '- Exact reviewer first line: `YES — RELEASE QUALITY`',
    '- Exact reviewer first line: `NO — REJECTED`; a later note mentions YES — RELEASE QUALITY',
  );
  fs.writeFileSync(file, record);
}, 'RELEASE_VERDICT');

withFixture('reviewer independence', (root) => {
  const file = path.join(root, 'docs/design-system/assets/button/release-record.md');
  const record = fs.readFileSync(file, 'utf8').replace(
    '| Design/Experience Reviewer | `design_experience_reviewer` | yes |',
    '| Design/Experience Reviewer | `design_experience_reviewer` | no |',
  );
  fs.writeFileSync(file, record);
}, 'REVIEWER_INDEPENDENCE');

console.log('RELEASE VALIDATOR SELF-TEST PASS');
console.log('- 21 executed cases: Button/non-Button, named/single-argument/arrow source, and monolithic/separate-page positive graphs plus exact route binding, route isolation, exact-390 evidence, checklist syntax, semantic defaults, contract schema/assertions/status, symmetric prop sets, source boundaries, all broad React API aliases, docs CSS, verdict, and reviewer-independence regressions passed.');
