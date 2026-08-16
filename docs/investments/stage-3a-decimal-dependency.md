# Stage 3A Decimal Dependency Decision

## Decision

Use `big.js` version `7.0.1` as a direct server dependency, locked by `server/package-lock.json`.

## Why this library

- Stage 3A needs exact decimal parsing, comparison, addition, subtraction, multiplication, and canonical string output—not non-decimal bases or advanced mathematics.
- `big.js` is the smallest and simplest library in the maintainer's decimal-library family for that requirement.
- It rejects `NaN` and `Infinity`, which supports the snapshot rule that missing/invalid financial values remain unknown instead of silently becoming numeric data.
- The current package is MIT licensed and actively distributed with broad ecosystem use.

## Import boundary

Only `server/src/services/investments/money.js` may import `big.js`. Normalizers, snapshot services, routes, models, client code, QBO code, and shared realtime code use the reviewed money helper or already-normalized decimal strings.

## Out of scope

The dependency does not authorize client-side money arithmetic, currency conversion, valuation, margin/risk calculations, trading, or AI use.
