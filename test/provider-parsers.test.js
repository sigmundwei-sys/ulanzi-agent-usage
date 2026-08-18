import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCodexRateLimits } from '../plugin/codex-fetcher.js';
import { parseCopilotEntitlement } from '../plugin/copilot-fetcher.js';
import { parseCursorUsage } from '../plugin/cursor-provider.js';
import { parseKiroUsage } from '../plugin/kiro-provider.js';
import {
  parseAntigravityQuotaSummary,
  parseAntigravityUsage,
  readAntigravityUsage,
} from '../plugin/antigravity-provider.js';

const NOW = Date.parse('2026-08-13T00:00:00Z');

test('Codex selects the requested official rate-limit window', () => {
  const value = parseCodexRateLimits({
    primary: {
      usedPercent: 12.5,
      windowDurationMins: 300,
      resetsAt: Math.floor((NOW + 60 * 60 * 1000) / 1000),
    },
    secondary: {
      usedPercent: 77,
      windowDurationMins: 10080,
      resetsAt: Math.floor((NOW + 3 * 86400 * 1000) / 1000),
    },
  }, 'weekly', NOW);

  assert.equal(value.util, 0.77);
  assert.equal(value.windowMinutes, 10080);
  assert.equal(value.source, 'codex-app-server');
});

test('Codex returns null when the requested window is absent', () => {
  const value = parseCodexRateLimits({
    primary: { usedPercent: 12, windowDurationMins: 300 },
  }, 'weekly', NOW);
  assert.equal(value, null);
});

test('Copilot parses remaining percentage snapshots', () => {
  const value = parseCopilotEntitlement({
    copilot_quota_snapshots: { chat: { percent_remaining: 64 } },
    copilot_quota_reset_date: 1_800_000_000,
  }, 'chat');

  assert.equal(value.util, 0.36);
  assert.equal(value.reset, '2027-01-15T08:00:00.000Z');
});

test('Cursor parses dashboard plan usage', () => {
  const value = parseCursorUsage({
    billingCycleEnd: '2026-09-01T00:00:00.000Z',
    individualUsage: { plan: { totalPercentUsed: 42 } },
  }, NOW);

  assert.equal(value.util, 0.42);
  assert.equal(value.reset, '2026-09-01T00:00:00.000Z');
  assert.equal(value.source, 'cursor-dashboard');
});

test('Kiro parses the AWS usage breakdown', () => {
  const value = parseKiroUsage({
    usageBreakdownList: [{
      currentUsageWithPrecision: 125,
      usageLimitWithPrecision: 500,
      nextDateReset: Math.floor((NOW + 2 * 86400 * 1000) / 1000),
    }],
  }, NOW);

  assert.equal(value.util, 0.25);
  assert.equal(value.reset, '2026-08-15T00:00:00.000Z');
  assert.equal(value.source, 'kiro-usage-api');
});

test('Antigravity selects the configured model family', () => {
  const value = parseAntigravityUsage({
    config: { modelMap: { ag_gem_5h: 'gemini-3-flash' } },
    models: [
      {
        modelId: 'gemini-3-flash',
        remainingPercentage: 81,
        resetTime: '2026-08-13T04:00:00.000Z',
      },
    ],
  }, 'ag_gem_5h', NOW);

  assert.equal(value.util, 0.19);
  assert.equal(value.model, 'gemini-3-flash');
  assert.equal(value.source, 'antigravity-usage-cli');
});

test('Antigravity accepts fractional remaining values from the helper', () => {
  const value = parseAntigravityUsage({
    models: [
      {
        modelId: 'gemini-3-flash',
        remainingPercentage: 0.91,
        resetTime: '2026-08-13T04:00:00.000Z',
      },
    ],
  }, 'ag_gem_5h', NOW);

  assert.equal(value.util, 0.09);
});

test('Antigravity accepts fractional used values from the helper', () => {
  const value = parseAntigravityUsage({
    models: [
      {
        modelId: 'claude-sonnet',
        usedPercentage: 0.26,
        resetTime: '2026-08-13T04:00:00.000Z',
      },
    ],
  }, 'ag_3p_5h', NOW);

  assert.equal(value.util, 0.26);
});

test('Antigravity classifies local placeholder models by their labels', () => {
  const body = {
    models: [
      {
        modelId: 'MODEL_PLACEHOLDER_GEM_SHORT',
        label: 'Gemini 3 Flash',
        remainingPercentage: 0.91,
        resetTime: '2099-01-01T01:00:00.000Z',
      },
      {
        modelId: 'MODEL_PLACEHOLDER_GEM_WEEKLY',
        label: 'Gemini 3 Pro (High)',
        remainingPercentage: 0.74,
        resetTime: '2099-01-04T01:00:00.000Z',
      },
      {
        modelId: 'MODEL_PLACEHOLDER_CLAUDE',
        label: 'Claude Sonnet 4.6 (Thinking)',
        remainingPercentage: 1,
        resetTime: '2099-01-01T02:00:00.000Z',
      },
    ],
  };

  const geminiWeekly = parseAntigravityUsage(body, 'ag_gem_7d', NOW);
  const claudeFiveHour = parseAntigravityUsage(body, 'ag_3p_5h', NOW);

  assert.equal(geminiWeekly.util, 0.26);
  assert.equal(geminiWeekly.model, 'MODEL_PLACEHOLDER_GEM_WEEKLY');
  assert.equal(claudeFiveHour.util, 0);
  assert.equal(claudeFiveHour.model, 'MODEL_PLACEHOLDER_CLAUDE');
});

test('Antigravity parses the official agy weekly and five-hour summary', () => {
  const body = {
    response: {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            { bucketId: 'gemini-weekly', remaining: { remainingFraction: 0.74 }, resetTime: '2099-01-04T01:00:00.000Z' },
            { bucketId: 'gemini-5h', remaining: { remainingFraction: 0.91 }, resetTime: '2099-01-01T01:00:00.000Z' },
          ],
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            { bucketId: '3p-weekly', remaining: { remainingFraction: 1 }, resetTime: '2099-01-04T02:00:00.000Z' },
            { bucketId: '3p-5h', remaining: { remainingFraction: 1 }, resetTime: '2099-01-01T02:00:00.000Z' },
          ],
        },
      ],
    },
  };

  assert.equal(parseAntigravityQuotaSummary(body, 'ag_gem_5h', NOW).util, 0.09);
  assert.equal(parseAntigravityQuotaSummary(body, 'ag_gem_7d', NOW).util, 0.26);
  assert.equal(parseAntigravityQuotaSummary(body, 'ag_3p_5h', NOW).util, 0);
  assert.equal(parseAntigravityQuotaSummary(body, 'ag_3p_7d', NOW).util, 0);
});

test('Antigravity falls back to the configured helper for weekly usage', async () => {
  const body = {
    models: [{
      modelId: 'MODEL_PLACEHOLDER_GEM_WEEKLY',
      label: 'Gemini weekly',
      remainingPercentage: 74,
      resetTime: '2099-01-04T01:00:00.000Z',
    }],
  };
  const helperScript = `process.stdout.write(${JSON.stringify(JSON.stringify(body))})`;
  const value = await readAntigravityUsage('ag_gem_7d', {
    providerConfig: {
      agyBin: process.execPath,
      bin: process.execPath,
      args: ['-e', helperScript, '--'],
    },
  });

  assert.equal(value.util, 0.26);
  assert.equal(value.source, 'antigravity-usage-cli');
  assert.equal(value.model, 'MODEL_PLACEHOLDER_GEM_WEEKLY');
});
