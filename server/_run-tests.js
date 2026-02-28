const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.stderr.write('Starting test runner...\n');

const testDir = path.join(__dirname, 'test');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js')).sort();

process.stderr.write('Found ' + files.length + ' test files\n');

let grandPass = 0, grandFail = 0, grandTotal = 0;
const failedFiles = [];
const failureDetails = [];

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const fp = path.join(testDir, file);
  process.stderr.write('Running [' + (i+1) + '/' + files.length + ']: ' + file + '...\n');
  let buf, exitOk = true, stderr = '';
  try {
    buf = execFileSync('node', [fp], { timeout: 60000, maxBuffer: 10*1024*1024 });
  } catch (e) {
    buf = e.stdout || Buffer.alloc(0);
    stderr = (e.stderr || '').toString();
    exitOk = false;
  }
  const text = buf.toString('latin1');
  const testsM = text.match(/tests (\d+)/);
  const passM = text.match(/pass (\d+)/);
  const failM = text.match(/fail (\d+)/);
  const t = testsM ? parseInt(testsM[1]) : 0;
  const p = passM ? parseInt(passM[1]) : 0;
  const f = failM ? parseInt(failM[1]) : 0;
  grandPass += p;
  grandFail += f;
  grandTotal += t;
  const failed = f > 0 || (t === 0 && !exitOk);
  const icon = failed ? 'FAIL' : 'PASS';
  process.stdout.write(icon + '  ' + file + '  (tests: ' + t + ', pass: ' + p + ', fail: ' + f + ')\n');
  if (failed) {
    failedFiles.push(file);
    if (stderr) {
      failureDetails.push({ file, stderr: stderr.substring(0, 1500) });
    }
  }
}

process.stdout.write('\n========================================\n');
process.stdout.write('TOTAL: ' + grandTotal + ' tests | ' + grandPass + ' passed | ' + grandFail + ' failed\n');
process.stdout.write('========================================\n');
if (failedFiles.length) {
  process.stdout.write('\nFailed test files:\n');
  failedFiles.forEach(f => process.stdout.write('  - ' + f + '\n'));
  if (failureDetails.length) {
    process.stdout.write('\nFailure details:\n');
    failureDetails.forEach(d => {
      process.stdout.write('\n--- ' + d.file + ' ---\n');
      process.stdout.write(d.stderr + '\n');
    });
  }
}
process.exit(grandFail > 0 ? 1 : 0);
