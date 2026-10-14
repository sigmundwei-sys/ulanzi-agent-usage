/**
 * Antigravity usage provider.
 *
 * Multi-tier Antigravity quota retrieval:
 *   1. Live Antigravity Language Server / agy daemon RPC (RetrieveUserQuotaSummary)
 *      with local loopback port detection and X-Codeium-Csrf-Token authentication.
 *   2. Local statusline cache fallback (~/.gemini/tmp/real_quota_cache.json).
 *   3. Cockpit-tools encrypted account fallback (~/.antigravity_cockpit/accounts/*.json).
 *   4. antigravity-usage CLI fallback.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { expandPath, providerConfig } from './local-config.js';

const execFile = promisify(execFileCallback);
const CLI_TIMEOUT_MS = 15_000;
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
  if (wantsWeekly) {
    const weeklyModel = usable.find((item) => /weekly|7d|week/.test(modelSearchText(item)));
    if (weeklyModel) return weeklyModel;
    const sorted = [...usable].sort((a, b) => (resetMs(a) ?? Number.MAX_SAFE_INTEGER) - (resetMs(b) ?? Number.MAX_SAFE_INTEGER));
    const longest = sorted[sorted.length - 1];
    const longestMs = resetMs(longest);
    if (longestMs !== null && longestMs > 24 * 60 * 60 * 1000) {
      return longest;
    }
    return null;
  }

  const sorted = [...usable].sort((a, b) => (resetMs(a) ?? Number.MAX_SAFE_INTEGER) - (resetMs(b) ?? Number.MAX_SAFE_INTEGER));
  return sorted[0];
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

function findRunningCandidatesWindows() {
  try {
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'agy|language_server|antigravity' } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`;
    const stdout = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4_000,
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
    if (!stdout) return [];
    const parsed = JSON.parse(stdout);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((item) => {
      const cmd = String(item.CommandLine || '');
      const match = cmd.match(/--csrf_token(?:=|\s+)([^\s"']+)/);
      return {
        pid: item.ProcessId,
        csrfToken: match ? match[1] : '',
      };
    }).filter((item) => item.pid);
  } catch {
    return [];
  }
}

function findRunningCandidatesUnix() {
  try {
    const stdout = execFileSync('ps', ['auxww'], {
      encoding: 'utf8',
      timeout: 4_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const candidates = [];
    for (const line of stdout.split('\n')) {
      const lower = line.toLowerCase();
      if (!/agy|language_server|antigravity/.test(lower)) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;
      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;
      const match = line.match(/--csrf_token(?:=|\s+)([^\s"']+)/);
      candidates.push({
        pid,
        csrfToken: match ? match[1] : '',
      });
    }
    return candidates;
  } catch {
    return [];
  }
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

function requestQuotaSummary(port, secure, csrfToken = '') {
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
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        ...(csrfToken ? { 'X-Codeium-Csrf-Token': csrfToken } : {}),
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
  const isCustomAgy = Boolean(config.agyBin && config.agyBin !== 'agy' && !binary.endsWith('agy.exe'));

  if (!isCustomAgy) {
    let candidates = process.platform === 'win32'
      ? findRunningCandidatesWindows()
      : findRunningCandidatesUnix();

    for (const candidate of candidates) {
      const ports = await listeningPorts(candidate.pid);
      for (const port of ports) {
        for (const secure of [true, false]) {
          try {
            const body = await requestQuotaSummary(port, secure, candidate.csrfToken);
            if (summaryGroups(body).length) return body;
          } catch { /* Try next port/protocol. */ }
        }
      }
    }

    // Do not auto-start agy here. The CLI can open a visible console window;
    // quota fallbacks below remain available when no daemon is already running.
    // Wait and re-scan only for daemons that were already started externally.
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      candidates = process.platform === 'win32'
        ? findRunningCandidatesWindows()
        : findRunningCandidatesUnix();

      for (const candidate of candidates) {
        const ports = await listeningPorts(candidate.pid);
        for (const port of ports) {
          for (const secure of [true, false]) {
            try {
              const body = await requestQuotaSummary(port, secure, candidate.csrfToken);
              if (summaryGroups(body).length) return body;
            } catch { /* Try next port/protocol. */ }
          }
        }
      }
    }
  }

  return null;
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

export function readStatuslineCache(metric, now = Date.now()) {
  try {
    const cachePath = path.join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
    if (!fs.existsSync(cachePath)) return null;
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const isGemini = metric.startsWith('ag_gem_');
    const isWeekly = metric.endsWith('7d');
    const group = isGemini ? data?.quotaSummary?.gemini : data?.quotaSummary?.claude;
    const limit = isWeekly ? group?.limit7d : group?.limit5h;
    if (!limit || limit.remaining_percentage === undefined) return null;
    const remaining = fractionFromPercentLike(limit.remaining_percentage);
    if (remaining === null) return null;
    return {
      util: normalizeFraction(1 - remaining),
      reset: limit.reset_time || null,
      updatedAt: data.updatedAt ? Math.floor(data.updatedAt / 1000) : Math.floor(now / 1000),
      staleSec: data.updatedAt ? Math.max(0, Math.floor((now - data.updatedAt) / 1000)) : 0,
      source: 'antigravity-statusline-cache',
      model: `${isGemini ? 'Gemini' : '3P'} ${isWeekly ? 'Weekly' : '5-Hour'}`,
    };
  } catch {
    return null;
  }
}

export function readCockpitAntigravityAccount(metric, now = Date.now()) {
  try {
    const keyPath = path.join(os.homedir(), '.antigravity_cockpit', 'secure-account-storage.key');
    const accountsDir = path.join(os.homedir(), '.antigravity_cockpit', 'accounts');
    if (!fs.existsSync(accountsDir)) return null;
    const files = fs.readdirSync(accountsDir).filter((f) => f.endsWith('.json') || f.endsWith('.json.bak'));
    if (!files.length) return null;

    let key = null;
    if (fs.existsSync(keyPath)) {
      key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
    }

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(accountsDir, file), 'utf8');
        let parsed = null;
        if (raw.includes('"algorithm"') && raw.includes('"AES-256-GCM"') && key) {
          const envelope = JSON.parse(raw);
          const nonce = Buffer.from(envelope.nonce, 'base64');
          const ciphertextWithTag = Buffer.from(envelope.ciphertext, 'base64');
          const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
          const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
          decipher.setAuthTag(tag);
          const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
          parsed = JSON.parse(decrypted.toString('utf8'));
        } else {
          parsed = JSON.parse(raw);
        }

        const targetName = metric === 'ag_gem_5h' ? 'gemini-5h'
          : metric === 'ag_gem_7d' ? 'gemini-weekly'
          : metric === 'ag_3p_5h' ? '3p-5h'
          : '3p-weekly';

        const models = parsed?.quota?.models || [];
        const match = models.find((m) => m.name === targetName);
        if (match && match.percentage !== undefined) {
          const remaining = fractionFromPercentLike(match.percentage);
          if (remaining !== null) {
            return {
              util: normalizeFraction(1 - remaining),
              reset: match.reset_time || null,
              updatedAt: parsed?.quota?.last_updated || Math.floor(now / 1000),
              staleSec: parsed?.quota?.last_updated ? Math.max(0, Math.floor(now / 1000) - parsed.quota.last_updated) : 0,
              source: 'cockpit-account',
              model: match.display_name || match.name,
            };
          }
        }
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

function lastGoodCacheFile() {
  return path.join(os.homedir(), '.gemini', 'tmp', 'antigravity_last_good.json');
}

export function saveLastGoodAntigravity(metric, data) {
  try {
    const file = lastGoodCacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let all = {};
    if (fs.existsSync(file)) {
      try { all = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
    }
    all[metric] = { ...data, savedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(all, null, 2), { encoding: 'utf8' });
  } catch {}
}

export function readLastGoodAntigravity(metric, now = Date.now()) {
  try {
    const file = lastGoodCacheFile();
    if (!fs.existsSync(file)) return null;
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = all?.[metric];
    if (!entry || entry.util === undefined) return null;
    const savedAt = entry.savedAt || (entry.updatedAt ? entry.updatedAt * 1000 : now);
    return {
      util: entry.util,
      reset: entry.reset || null,
      updatedAt: Math.floor(savedAt / 1000),
      staleSec: Math.max(0, Math.floor((now - savedAt) / 1000)),
      source: 'antigravity-persisted-cache',
      model: entry.model || metric,
    };
  } catch {
    return null;
  }
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
  const binStr = String(config.bin || '');
  const argsStr = Array.isArray(config.args) ? config.args.join(' ') : String(config.args || '');
  const isAntigravityUsageHelper = binStr.includes('antigravity-usage') || argsStr.includes('antigravity-usage') || config.bin === 'antigravity-usage';
  const isCustomBin = Boolean(config.bin && !isAntigravityUsageHelper);
  const isCustomAgy = Boolean(config.agyBin && config.agyBin !== 'agy' && !config.agyBin.endsWith('agy.exe'));

  const summary = await readAgyQuotaSummary(config);
  if (summary) {
    const parsedSummary = parseAntigravityQuotaSummary(summary, metric);
    if (parsedSummary) {
      saveLastGoodAntigravity(metric, parsedSummary);
      return parsedSummary;
    }
  }

  if (!isCustomBin && !isCustomAgy) {
    const statuslineCache = readStatuslineCache(metric);
    if (statuslineCache && statuslineCache.staleSec < 15 * 60) {
      saveLastGoodAntigravity(metric, statuslineCache);
      return statuslineCache;
    }

    const cockpitData = readCockpitAntigravityAccount(metric);
    if (cockpitData && cockpitData.staleSec < 15 * 60) {
      saveLastGoodAntigravity(metric, cockpitData);
      return cockpitData;
    }
  }

  try {
    const body = await runCli(config);
    const parsed = parseAntigravityUsage({ ...body, config }, metric);
    if (parsed) {
      saveLastGoodAntigravity(metric, parsed);
      return parsed;
    }
  } catch {}

  if (!isCustomBin && !isCustomAgy) {
    const statuslineCache = readStatuslineCache(metric);
    if (statuslineCache) {
      saveLastGoodAntigravity(metric, statuslineCache);
      return statuslineCache;
    }
    const cockpitData = readCockpitAntigravityAccount(metric);
    if (cockpitData) {
      saveLastGoodAntigravity(metric, cockpitData);
      return cockpitData;
    }
    const persisted = readLastGoodAntigravity(metric);
    if (persisted) return persisted;
  }

  throw new Error(`Antigravity helper returned no ${metric} quota`);
}
