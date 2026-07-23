#!/usr/bin/env node
'use strict';

const { hashPassword } = require('../src/services/app-auth');

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command in an interactive terminal so the password is not echoed.');
  }
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const finish = (error) => {
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      input.removeListener('data', onData);
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (character) => {
      if (character === '\u0003') return finish(new Error('Cancelled.'));
      if (character === '\r' || character === '\n') return finish();
      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
        return undefined;
      }
      value += character;
      return undefined;
    };
    input.on('data', onData);
  });
}

async function main() {
  const password = await readHidden('New QBO sign-in password (12+ characters): ');
  const confirmation = await readHidden('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const encoded = await hashPassword(password);
  process.stdout.write(`QBO_AUTH_PASSWORD_HASH=${encoded}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
