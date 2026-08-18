/**
 * Antigravity usage provider.
 *
 * Antigravity does not expose a stable public personal quota endpoint. The
 * supported integration point here is the optional `antigravity-usage` CLI,
 * which can read the local IDE connection or its own local Google account
 * cache. The plugin never installs or downloads that helper automatically.
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { expandPath, providerConfig } from './local-config.js';

const execFile = promisify(execFileCallback);
const CLI_TIMEOUT_MS = 15_000;
const AGY_TIMEOUT_MS = 20_000;
const AGY_CACHE_MS = 4 * 60 * 1000;
const SUMMARY_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';

let agySummaryCache = { key: null, value: null, expiresAt: 0, promise: null };

function parseJsonOutput(stdout) {
  const text = String(stdout || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function numberAt(object, keys) {
  for (const key of keys) {
    const value = Number(object?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

// antigravity-usage has returned both percentage values (91) and fractional
// values (0.91) across its local and Google quota adapters. Normalize both
// representations before calculating used utilization.
function fractionFromPercentLike(value) {
  if (value === null || value < 0) return null;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return null;
}

function normalizeFraction(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 1_000_000) / 1_000_000;
}

function summaryMetricSpec(metric) {
  const isGemini = metric.startsWith('ag_gem_');
  return {
    group: isGemini ? 'gemini' : 'third-party',
    window: metric.endsWith('7d') ? 'weekly' : '5h',
  };
}

function summaryPayload(body) {
  return body?.response || body?.quotaSummary || body?.data?.response || body?.data?.quotaSummary || body;
}

function summaryGroups(body) {
  const payload = summaryPayload(body);
  return Array.isArray(payload?.groups) ? payload.groups : [];
}

function summaryBucketRemaining(bucket) {
  return numberAt(bucket?.remaining, [
    'remainingFraction',
    'remaining_fraction',
    'remainingPercentage',
    'remaining_percentage',
  ]) ?? numberAt(bucket, [
    'remainingFraction',
    'remaining_fraction',
    'remainingPercentage',
    'remaining_percentage',
  ]);
}

function summaryGroupMatches(group, kind) {
  const text = [group?.displayName, group?.groupName, group?.groupId, group?.name]
    .filter(Boolean).join(' ').toLowerCase();
  if (kind === 'gemini') return text.includes('gemini');
  return /claude|gpt|third|3p|openai/.test(text);
}

function summaryBucketMatches(bucket, window) {
  const text = [bucket?.bucketId, bucket?.displayName, bucket?.window, bucket?.name]
    .filter(Boolean).join(' ').toLowerCase();
  return window === 'weekly'
    ? /weekly|week|7d/.test(text)
    : /5h|five.?hour|five hour|session/.test(text);
}

export function parseAntigravityQuotaSummary(body, metric, now = Date.now()) {
  const spec = summaryMetricSpec(metric);
  const group = summaryGroups(body).find((item) => summaryGroupMatches(item, spec.group));
  if (!group || !Array.isArray(group.buckets)) return null;
  const bucket = group.buckets.find((item) => summaryBucketMatches(item, spec.window));
  if (!bucket) return null;
  const remaining = fractionFromPercentLike(summaryBucketRemaining(bucket));
  if (remaining === null) return null;
  return {
    util: normalizeFraction(1 - remaining),
    reset: bucket.resetTime || bucket.reset_time || bucket.remaining?.resetTime || null,
    updatedAt: Math.floor(now / 1000),
    staleSec: 0,
    source: 'antigravity-agy-summary',
    model: String(bucket.bucketId || bucket.displayName || group.displayName || ''),
  };
}

function modelList(body) {
  if (Array.isArray(body)) return body;
  return body?.models || body?.data?.models || body?.quota?.models || [];
}

function modelId(model) {
  return String(model?.modelId || model?.model_id || model?.id || model?.name || model?.label || '');
}

function modelSearchText(model) {
  return [
    model?.modelId,
    model?.model_id,
    model?.id,
    model?.name,
    model?.label,
    model?.displayName,
  ].filter(Boolean).join(' ').toLowerCase();
}

function matchesRule(model, rule) {
  const id = modelSearchText(model);
  const rules = Array.isArray(rule) ? rule : [rule];
  return rules.some((item) => {
    if (!item) return false;
    const value = String(item).toLowerCase();
    return id === value || id.includes(value);
  });
}

function resetMs(model) {
  const explicit = numberAt(model, ['timeUntilResetMs', 'time_until_reset_ms']);
  if (explicit !== null) return explicit;
  const value = model?.resetTime || model?.reset_time;
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, time - Date.now()) : null;
}

function selectModel(body, metric, config) {
  const models = modelList(body).filter((item) => item && typeof item === 'object');
  const configuredRule = config?.modelMap?.[metric] || config?.models?.[metric];
  const candidates = configuredRule ? models.filter((item) => matchesRule(item, configuredRule)) : models;
  const category = metric.includes('gem') ? 'gemini' : 'claude';
  const categoryCandidates = candidates.filter((item) => {
    if (configuredRule) return true;
    const id = modelSearchText(item);
    return category === 'gemini' ? id.includes('gemini') : /claude|sonnet|opus|haiku|gpt|openai/.test(id);
  });
  const usable = categoryCandidates.length ? categoryCandidates : candidates;
  if (!usable.length) return null;

  const wantsWeekly = metric.endsWith('7d');
  const sorted = [...usable].sort((a, b) => (resetMs(a) ?? Number.MAX_SAFE_INTEGER) - (resetMs(b) ?? Number.MAX_SAFE_INTEGER));
  return wantsWeekly ? sorted[sorted.length - 1] : sorted[0];
}

export function parseAntigravityUsage(body, metric, now = Date.now()) {
  const model = selectModel(body, metric, body?.config || {});
  if (!model) return null;
  const remaining = numberAt(model, [
    'remainingPercentage',
    'remaining_percentage',
    'remainingPercent',
    'remaining_percent',
  ]);
  const used = numberAt(model, ['usedPercentage', 'used_percentage', 'percentUsed', 'percentageUsed']);
  const remainingFraction = fractionFromPercentLike(remaining);
  const usedFraction = fractionFromPercentLike(used);
  let util;
  if (remainingFraction !== null) util = 1 - remainingFraction;
  else if (usedFraction !== null) util = usedFraction;
  else return null;

  return {
    util: normalizeFraction(util),
    reset: model.resetTime || model.reset_time || null,
    updatedAt: Math.floor(now / 1000),
    staleSec: 0,
    source: 'antigravity-usage-cli',
    model: modelId(model),
  };
}

function resolveAgyBinary(config) {
  const configured = expandPath(config.agyBin || process.env.ANTIGRAVITY_AGY_BIN);
  if (configured && configured !== 'agy') return configured;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const wellKnown = path.join(localAppData, 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(wellKnown)) return wellKnown;
  }
  return configured || 'agy';
}

function parseWindowsListeningPorts(stdout, pid) {
  const ports = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    const parts = line.trim().split(/\s+/);
    if (Number(parts.at(-1)) !== pid) continue;
    const match = String(parts[1] || '').match(/:(\d+)$/);
    if (match) ports.push(Number(match[1]));
  }
  return [...new Set(ports)];
}

async function listeningPorts(pid) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFile('netstat.exe', ['-ano'], {
        windowsHide: true,
        timeout: 3_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return parseWindowsListeningPorts(stdout, pid);
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)], {
        timeout: 3_000,
        maxBuffer: 512 * 1024,
      });
      return [...new Set([...String(stdout).matchAll(/:(\d+)\s+\(LISTEN\)/g)].map((match) => Number(match[1])))];
    }
    const { stdout } = await execFile('ss', ['-ltnp'], {
      timeout: 3_000,
      maxBuffer: 512 * 1024,
    });
    const ports = [];
    for (const line of String(stdout || '').split(/\r?\n/)) {
      if (!line.includes(`pid=${pid},`) && !line.includes(`pid=${pid})`)) continue;
      const match = line.match(/:(\d+)\s/);
      if (match) ports.push(Number(match[1]));
    }
    return [...new Set(ports)];
  } catch {
    return [];
  }
}

function requestQuotaSummary(port, secure) {
  const transport = secure ? https : http;
  const body = JSON.stringify({
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      locale: 'en',
      ideVersion: 'unknown',
    },
  });
  return new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: '127.0.0.1',
      port,
      path: SUMMARY_PATH,
      method: 'POST',
      rejectUnauthorized: false,
      timeout: 1_500,
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Antigravity quota summary HTTP ${response.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(text)); } catch { reject(new Error('Antigravity quota summary returned invalid JSON')); }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Antigravity quota summary timed out')));
    request.write(body);
    request.end();
  });
}

async function fetchAgyQuotaSummary(config) {
  const binary = resolveAgyBinary(config);
  let child;
  try {
    // execFile avoids the Windows console flash that can still occur with
    // spawn() for console executables, even when windowsHide is enabled.
    child = execFileCallback(binary, ['models'], {
      windowsHide: true,
      stdio: 'ignore',
    }, () => {});
  } catch {
    return null;
  }
  let exited = false;
  child.once('exit', () => { exited = true; });
  child.once('error', () => { exited = true; });
  const deadline = Date.now() + AGY_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const ports = await listeningPorts(child.pid);
      for (const port of ports) {
        for (const secure of [true, false]) {
          try {
            const body = await requestQuotaSummary(port, secure);
            if (summaryGroups(body).length) return body;
          } catch { /* Try the next loopback port/protocol. */ }
        }
      }
      if (exited && !ports.length) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  } catch {
    return null;
  } finally {
    if (!child.killed && !exited) child.kill();
  }
}

async function readAgyQuotaSummary(config) {
  const key = resolveAgyBinary(config);
  const now = Date.now();
  if (agySummaryCache.key === key && agySummaryCache.value && agySummaryCache.expiresAt > now) {
    return agySummaryCache.value;
  }
  if (agySummaryCache.key === key && agySummaryCache.promise) return agySummaryCache.promise;

  const promise = fetchAgyQuotaSummary(config).catch(() => null);
  agySummaryCache = { key, value: null, expiresAt: 0, promise };
  const value = await promise;
  agySummaryCache = {
    key,
    value,
    expiresAt: value ? Date.now() + AGY_CACHE_MS : 0,
    promise: null,
  };
  return value;
}

async function runCli(config) {
  const file = config.bin || process.env.ANTIGRAVITY_USAGE_BIN || 'antigravity-usage';
  const args = Array.isArray(config.args) ? [...config.args] : ['--json'];
  if (!args.includes('--json')) args.push('--json');
  const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  const invocation = isWindowsScript
    ? {
        file: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', `"${file.replace(/"/g, '""')}" ${args.join(' ')}`],
      }
    : { file, args };
  try {
    const result = await execFile(invocation.file, invocation.args, {
      shell: false,
      windowsHide: true,
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      cwd: config.cwd ? path.resolve(config.cwd) : undefined,
    });
    const body = parseJsonOutput(result.stdout);
    if (!body) throw new Error('antigravity-usage returned no JSON');
    return body;
  } catch (error) {
    const body = parseJsonOutput(error?.stdout);
    if (body) return body;
    throw new Error('Antigravity usage helper unavailable; install antigravity-usage or configure providers.antigravity.bin');
  }
}

export async function readAntigravityUsage(metric, settings = {}) {
  const config = providerConfig('antigravity', settings);
  const summary = await readAgyQuotaSummary(config);
  if (summary) {
    const parsedSummary = parseAntigravityQuotaSummary(summary, metric);
    if (parsedSummary) return parsedSummary;
  }
  const body = await runCli(config);
  const parsed = parseAntigravityUsage({ ...body, config }, metric);
  if (!parsed) throw new Error(`Antigravity helper returned no ${metric} quota`);
  return parsed;
}
