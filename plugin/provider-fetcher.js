/**
 * Provider dispatch layer.
 *
 * The Ulanzi event loop should know about provider names, not about where a
 * provider happens to keep credentials. Each adapter returns the common
 * shape consumed by renderer.js: { util, reset, updatedAt, staleSec }.
 */

import { readCodexSparkUsage, readCodexUsage } from './codex-fetcher.js';
import { readGrokUsage } from './grok-fetcher.js';
import { readCursorUsage } from './cursor-provider.js';
import { readCopilotUsage } from './copilot-fetcher.js';
import { fetchKiroLive } from './kiro-provider.js';
import { readAntigravityUsage, readLastGoodAntigravity } from './antigravity-provider.js';

export const PROVIDER_ACTION_MAP = Object.freeze({
  'com.ulanzi.ulanzistudio.agentusage.codex_5h': 'codex',
  'com.ulanzi.ulanzistudio.agentusage.codex_7d': 'codex_7d',
  'com.ulanzi.ulanzistudio.agentusage.codex_spark_5h': 'codex_spark_5h',
  'com.ulanzi.ulanzistudio.agentusage.codex_spark_7d': 'codex_spark_7d',
  'com.ulanzi.ulanzistudio.agentusage.cursor': 'cursor',
  'com.ulanzi.ulanzistudio.agentusage.copilot_chat': 'copilot_chat',
  'com.ulanzi.ulanzistudio.agentusage.copilot_comp': 'copilot_comp',
  'com.ulanzi.ulanzistudio.agentusage.kiro': 'kiro',
  'com.ulanzi.ulanzistudio.agentusage.grok_7d': 'grok_7d',
  'com.ulanzi.ulanzistudio.agentusage.grok_build': 'grok_build',
  'com.ulanzi.ulanzistudio.agentusage.antigravity_gemini_5h': 'ag_gem_5h',
  'com.ulanzi.ulanzistudio.agentusage.antigravity_gemini_7d': 'ag_gem_7d',
  'com.ulanzi.ulanzistudio.agentusage.antigravity_3p_5h': 'ag_3p_5h',
  'com.ulanzi.ulanzistudio.agentusage.antigravity_3p_7d': 'ag_3p_7d',
  'com.ulanzi.ulanzistudio.agentusage.opencode_go_5h': 'opencode_go_5h',
  'com.ulanzi.ulanzistudio.agentusage.opencode_go_7d': 'opencode_go_7d',
  'com.ulanzi.ulanzistudio.agentusage.opencode_go_month': 'opencode_go_month',
});

export const PROVIDER_DEFS = Object.freeze({
  codex:        { label: 'CDX 5H', adapter: 'codex', window: 'hourly' },
  codex_7d:     { label: 'CDX 7D', adapter: 'codex', window: 'weekly' },
  codex_spark_5h: { label: 'SPARK 5H', adapter: 'codex_spark', window: 'hourly' },
  codex_spark_7d: { label: 'SPARK 7D', adapter: 'codex_spark', window: 'weekly' },
  cursor:       { label: 'Cursor', adapter: 'cursor' },
  copilot_chat: { label: 'Cpl Crd', adapter: 'copilot', metric: 'chat' },
  copilot_comp: { label: 'Cpl Inl', adapter: 'copilot', metric: 'completions' },
  kiro:         { label: 'Kiro', adapter: 'kiro' },
  grok_7d:       { label: 'GROK 7D', adapter: 'grok', metric: 'weekly' },
  grok_build:    { label: 'GROKBUILD', adapter: 'grok', metric: 'build' },
  ag_gem_5h:    { label: 'AGY G 5H', adapter: 'antigravity', metric: 'ag_gem_5h' },
  ag_gem_7d:    { label: 'AGY G 7D', adapter: 'antigravity', metric: 'ag_gem_7d' },
  ag_3p_5h:     { label: 'AGY C 5H', adapter: 'antigravity', metric: 'ag_3p_5h' },
  ag_3p_7d:     { label: 'AGY C 7D', adapter: 'antigravity', metric: 'ag_3p_7d' },
  opencode_go_5h:    { serverUsage: true, label: 'OCG 5H' },
  opencode_go_7d:    { serverUsage: true, label: 'OCG 7D' },
  opencode_go_month: { serverUsage: true, label: 'OCG MON' },
});

export function readInitialProviderState(provider) {
  const def = PROVIDER_DEFS[provider];
  if (!def) return null;
  if (def.adapter === 'antigravity') {
    return readLastGoodAntigravity(def.metric);
  }
  return null;
}

export async function readProviderUsage(provider, settings = {}) {
  const def = PROVIDER_DEFS[provider];
  if (!def) return null;
  switch (def.adapter) {
    case 'codex':
      return readCodexUsage(def.window);
    case 'codex_spark':
      return readCodexSparkUsage(def.window);
    case 'cursor':
      return readCursorUsage(settings);
    case 'copilot':
      return readCopilotUsage(def.metric, settings);
    case 'kiro':
      return fetchKiroLive(settings);
    case 'grok':
      return readGrokUsage(def.metric, settings);
    case 'antigravity':
      return readAntigravityUsage(def.metric, settings);
    default:
      return null;
  }
}

