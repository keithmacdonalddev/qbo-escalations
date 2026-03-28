import { useMemo, useRef } from 'react';

/**
 * Format a token count into a human-readable abbreviated string.
 * Shared between the monitor bar and mini widget.
 *
 * @param {number} n - Token count
 * @returns {string}
 */
export function formatTokenCount(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/**
 * Format a dollar cost to a sensible precision.
 * Shows 4 decimal places for costs < $1, 2 for >= $1.
 *
 * @param {number} cost - Cost in dollars
 * @returns {string}
 */
export function formatCost(cost) {
  if (!cost || cost <= 0) return '$0';
  if (cost >= 1) return '$' + cost.toFixed(2);
  return '$' + cost.toFixed(4);
}

/**
 * Computes running token usage stats from conversation messages and
 * cumulative background channel results.
 *
 * Background usage is tracked cumulatively via a ref because
 * bgLastResults only stores the LAST result per channel (not a
 * running total). Each time a new background result appears for
 * a channel, its usage is added to the accumulator.
 *
 * @param {object} options
 * @param {Array} options.messages - Conversation messages array
 * @param {object} options.bgLastResults - { channel: { usage, ... } }
 * @returns {{ foreground, background, combined }}
 */
export function useTokenMonitor({ messages, bgLastResults, sessionBudget }) {
  // --- Cumulative background usage tracking ---
  // bgLastResults overwrites per channel on each response, so we
  // detect changes by comparing object identity of each channel's result.
  const bgSeenRef = useRef(new Map()); // channel -> last result object reference
  const bgAccRef = useRef({ input: 0, output: 0, total: 0, costMicros: 0, count: 0 });

  // Accumulate new background results synchronously during render
  // so the useMemo below always sees the latest totals.
  if (bgLastResults) {
    const seen = bgSeenRef.current;
    const acc = bgAccRef.current;
    for (const [channel, result] of Object.entries(bgLastResults)) {
      if (!result || result === seen.get(channel)) continue;
      seen.set(channel, result);
      if (result.usage) {
        acc.input += result.usage.inputTokens || 0;
        acc.output += result.usage.outputTokens || 0;
        acc.total += result.usage.totalTokens || 0;
        acc.costMicros += result.usage.totalCostMicros || 0;
        acc.count++;
      }
    }
  }

  return useMemo(() => {
    // --- Foreground usage from conversation messages ---
    let fgInput = 0;
    let fgOutput = 0;
    let fgTotal = 0;
    let fgCostMicros = 0;
    let fgCount = 0;

    for (const msg of messages || []) {
      if (msg.role !== 'assistant' || !msg.usage || msg.usage.usageAvailable === false) continue;
      fgInput += msg.usage.inputTokens || 0;
      fgOutput += msg.usage.outputTokens || 0;
      fgTotal += msg.usage.totalTokens || 0;
      fgCostMicros += msg.usage.totalCostMicros || 0;
      fgCount++;
    }

    // --- Background usage (read from cumulative ref) ---
    const bg = bgAccRef.current;

    const combinedTotal = fgTotal + bg.total;
    const combinedCostMicros = fgCostMicros + bg.costMicros;
    const combinedCost = combinedCostMicros / 1_000_000;

    // --- Budget tracking ---
    const tokenLimit = sessionBudget?.tokenLimit || 0;
    const costLimitUsd = sessionBudget?.costLimitUsd || 0;
    const tokenPercent = tokenLimit > 0 ? (combinedTotal / tokenLimit) * 100 : 0;
    const costPercent = costLimitUsd > 0 ? (combinedCost / costLimitUsd) * 100 : 0;
    const maxPercent = Math.max(tokenPercent, costPercent);

    let budgetState = 'normal';
    if (maxPercent >= 95) budgetState = 'danger';
    else if (maxPercent >= 80) budgetState = 'amber';

    const shouldPauseBg = maxPercent >= 95;

    return {
      foreground: {
        input: fgInput,
        output: fgOutput,
        total: fgTotal,
        cost: fgCostMicros / 1_000_000,
        messages: fgCount,
      },
      background: {
        input: bg.input,
        output: bg.output,
        total: bg.total,
        cost: bg.costMicros / 1_000_000,
        messages: bg.count,
      },
      combined: {
        input: fgInput + bg.input,
        output: fgOutput + bg.output,
        total: combinedTotal,
        cost: combinedCost,
        messages: fgCount + bg.count,
      },
      budget: {
        tokenLimit,
        costLimitUsd,
        tokenPercent,
        costPercent,
        maxPercent,
        state: budgetState,
        shouldPauseBg,
      },
    };
  }, [messages, bgLastResults, sessionBudget]);
}
