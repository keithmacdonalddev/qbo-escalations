/**
 * Shared MongoDB test helper for --test-isolation=none compatibility.
 *
 * With --test-isolation=none, all test files share the same Node.js process
 * and the same mongoose singleton. Each file cannot create its own
 * MongoMemoryServer + mongoose.connect() — the second file's connect() would
 * clash with the first file's active connection.
 *
 * This module manages a single MongoMemoryServer instance that is lazily
 * created on first use and shared by every test file.  Call `connect()` in
 * your test.before() and `disconnect()` in your test.after().  Only the last
 * disconnect (when the ref-count reaches zero) actually tears down the server.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;
let refCount = 0;
let connectPromise = null;

/**
 * Ensure mongoose is connected to an in-memory MongoDB.
 * Safe to call from multiple test files — only the first call creates the
 * server; subsequent calls just increment the ref-count.
 */
async function connect() {
  refCount++;
  if (connectPromise) {
    await connectPromise;
    return;
  }
  connectPromise = (async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  })();
  await connectPromise;
}

/**
 * Decrement the ref-count and, when it reaches zero, disconnect mongoose
 * and stop the MongoMemoryServer.
 */
async function disconnect() {
  refCount--;
  if (refCount > 0) return;

  // Last consumer — tear everything down.
  connectPromise = null;
  try {
    await mongoose.disconnect();
  } catch { /* ignore */ }
  if (mongod) {
    try {
      await mongod.stop();
    } catch { /* ignore */ }
    mongod = null;
  }
}

module.exports = { connect, disconnect };
