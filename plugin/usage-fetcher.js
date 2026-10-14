/**
 * usage-fetcher.js
 *
 * 跨平台（macOS + Windows）credential 讀取與 usage API 查詢。
 *
 * 資料來源：
 *   macOS → macOS Keychain ('Claude Code-credentials')
 *         → ~/.claude/.credentials.json（fallback）
 *   Windows → %USERPROFILE%\.claude\.credentials.json
 *
 * API 端點：GET https://api.anthropic.com/api/oauth/usage
 *
 * 快取：每次成功結果寫入 <claudeConfigDir>/ulanzi-usage-cache.json，
 * 有效期 180 秒，避免 Ulanzi 頻繁 polling 打 API。
 */

import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';

// ─── 常數 ───────────────────────────────────────────────────────────────────

const MACOS_KEYCHAIN_SERVICE = 'Claude Code-credentials';
const USAGE_API_HOST = 'api.anthropic.com';
const USAGE_API_PATH = '/api/oauth/usage';
const USAGE_API_TIMEOUT_MS = 8000;
const CACHE_MAX_AGE_SEC = 180;  // 3 分鐘快取
const LOCK_MAX_AGE_SEC  = 30;   // 30 秒防重送

export const ErrorKind = Object.freeze({
  NO_TOKEN:     'NO_TOKEN',
  AUTH:         'AUTH',
  NETWORK:      'NETWORK',
  RATE_LIMITED: 'RATE_LIMITED',
  PARSE:        'PARSE',
  UNKNOWN:      'UNKNOWN',
});

// ─── Claude config 路徑 ──────────────────────────────────────────────────────

function getClaudeConfigDir() {
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir) {
    const resolved = path.resolve(envDir);
    if (fs.existsSync(resolved)) return resolved;
  }
  return path.join(os.homedir(), '.claude');
}

function getCredentialsFilePath() {
  return path.join(getClaudeConfigDir(), '.credentials.json');
}

function getCacheFilePath() {
  return path.join(getClaudeConfigDir(), 'ulanzi-usage-cache.json');
}

function getLockFilePath() {
  return path.join(getClaudeConfigDir(), 'ulanzi-usage-cache.lock');
}

// ─── Token 讀取 ──────────────────────────────────────────────────────────────

function parseAccessToken(rawJson) {
  try {
    const j = JSON.parse(rawJson.trim());
    const t = j?.claudeAiOauth?.accessToken;
    return (typeof t === 'string' && t.length > 0) ? t : null;
  } catch {
    return null;
  }
}

/** macOS Keychain 讀取（spawn 方式，不阻塞 event loop） */
function readTokenFromMacKeychain(service) {
  return new Promise((resolve) => {
    const p = spawn('security', ['find-generic-password', '-s', service, '-w'], {
      windowsHide: true,
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => resolve(code === 0 ? parseAccessToken(out) : null));
    p.on('error', () => resolve(null));
  });
}

/** .credentials.json 檔案讀取（macOS fallback + Windows 主路徑） */
function readTokenFromCredentialsFile() {
  try {
    const raw = fs.readFileSync(getCredentialsFilePath(), 'utf8');
    return parseAccessToken(raw);
  } catch {
    return null;
  }
}

/** 取得 access token，跨平台 */
async function getToken() {
  if (process.platform === 'darwin') {
    // macOS: 先試 Keychain，失敗再讀檔案
    const keychainToken = await readTokenFromMacKeychain(MACOS_KEYCHAIN_SERVICE);
    if (keychainToken) return keychainToken;
  }
  // Windows / Linux / macOS fallback: 直接讀 .credentials.json
  return readTokenFromCredentialsFile();
}

// ─── macOS token refresh（CLI 觸發）──────────────────────────────────────────
// 只在 macOS 有 Keychain 時才有意義；Windows 不需要（token 直接存於檔案）。

const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
let _lastRefreshAttempt = 0;

function attemptCliRefresh() {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  const now = Date.now();
  if (now - _lastRefreshAttempt < REFRESH_COOLDOWN_MS) return Promise.resolve(false);
  _lastRefreshAttempt = now;
  return new Promise((resolve) => {
    const candidates = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', 'claude'];
    const p = spawn(candidates[0], ['-p', 'hi', '--max-budget-usd', '0.01'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 20_000,
    });
    p.on('close', () => resolve(true));
    p.on('error', () => resolve(false));
  });
}

// ─── 快取 ────────────────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = fs.readFileSync(getCacheFilePath(), 'utf8');
    const data = JSON.parse(raw);
    const age = Math.floor(Date.now() / 1000) - (data._cachedAt || 0);
    if (age < CACHE_MAX_AGE_SEC) return data;
  } catch {}
  return null;
}

/** 讀取過期 cache（不管有多舊），用於重開機後的 lastGood 初始化 */
export function readStaleCache() {
  try {
    const raw = fs.readFileSync(getCacheFilePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data.util5h !== undefined || data.util7d !== undefined) return data;
  } catch {}
  return null;
}

function writeCache(data) {
  try {
    const toWrite = { ...data, _cachedAt: Math.floor(Date.now() / 1000) };
    fs.writeFileSync(getCacheFilePath(), JSON.stringify(toWrite));
  } catch {}
}

function readLock() {
  try {
    const raw = fs.readFileSync(getLockFilePath(), 'utf8');
    const lock = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (lock.blockedUntil && lock.blockedUntil > now) return lock;
  } catch {}
  return null;
}

function writeLock(extraSec, error = 'timeout') {
  try {
    const blockedUntil = Math.floor(Date.now() / 1000) + extraSec;
    fs.writeFileSync(getLockFilePath(), JSON.stringify({ blockedUntil, error }));
  } catch {}
}

function clearLock() {
  try { fs.unlinkSync(getLockFilePath()); } catch {}
}

// ─── Anthropic usage API 呼叫 ─────────────────────────────────────────────────

function callUsageApi(token) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    const proxyUrl = process.env.HTTPS_PROXY?.trim() || null;
    const reqOptions = {
      hostname: USAGE_API_HOST,
      path: USAGE_API_PATH,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1.5',
      },
      timeout: USAGE_API_TIMEOUT_MS,
    };

    const startRequest = (agent) => {
      if (agent) reqOptions.agent = agent;
      const req = https.request(reqOptions, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          finish({ status: res.statusCode, body, headers: res.headers });
        });
      });
      req.on('error', () => finish({ status: 0, body: '', headers: {} }));
      req.on('timeout', () => { req.destroy(); finish({ status: 0, body: '', headers: {} }); });
      req.end();
    };

    if (proxyUrl) {
      try {
        import('https-proxy-agent').then(({ HttpsProxyAgent }) => {
          startRequest(new HttpsProxyAgent(proxyUrl));
        }).catch(() => startRequest(null));
      } catch {
        startRequest(null);
      }
    } else {
      startRequest(null);
    }
  });
}

function parseUsageApiBody(body) {
  try {
    const j = JSON.parse(body);
    const getBucket = (key) => {
      const b = j[key];
      if (b === null) return { utilization: 0, resets_at: null };
      if (!b) return null;
      return {
        utilization: typeof b.utilization === 'number' ? b.utilization / 100 : null,
        resets_at: b.resets_at || null,
      };
    };
    const fiveHour = getBucket('five_hour');
    const sevenDay = getBucket('seven_day');
    if (!fiveHour && !sevenDay) return null;
    return {
      util5h:  fiveHour?.utilization ?? null,
      reset5h: fiveHour?.resets_at   ?? null,
      util7d:  sevenDay?.utilization ?? null,
      reset7d: sevenDay?.resets_at   ?? null,
    };
  } catch {
    return null;
  }
}

// ─── cockpit-tools fallback ─────────────────────────────────────────────────
// Anthropic 的 /api/oauth/usage 經常回 429（retry-after 可達 1 小時）。
// cockpit-tools 會自行刷新 ~/.antigravity_cockpit/claude_accounts/*.json，
// 官方 API 失敗時改讀該快取，避免 Ulanzi 停留在舊視窗的數值。

const COCKPIT_MAX_AGE_SEC = 30 * 60;

function decryptCockpitFile(raw, key) {
  const parsed = JSON.parse(raw);
  if (parsed?.algorithm !== 'AES-256-GCM' || !parsed.ciphertext) return parsed;
  if (!key) return null;
  const ct = Buffer.from(parsed.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.nonce, 'base64'));
  decipher.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]).toString('utf8'));
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  return String(value);
}

export function readCockpitClaudeUsage(now = Date.now()) {
  try {
    const root = path.join(os.homedir(), '.antigravity_cockpit');
    const dir = path.join(root, 'claude_accounts');
    if (!fs.existsSync(dir)) return null;
    const keyPath = path.join(root, 'secure-account-storage.key');
    const key = fs.existsSync(keyPath)
      ? Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64')
      : null;

    let best = null;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;  // 不讀 .bak
      try {
        const account = decryptCockpitFile(fs.readFileSync(path.join(dir, file), 'utf8'), key);
        const quota = account?.quota;
        const updatedMs = Number(account?.usage_updated_at) || 0;
        if (!quota || !updatedMs) continue;
        const raw = quota.raw_data?.organizationUsage || quota.raw_data || {};
        const util5h = typeof quota.five_hour_percentage === 'number' ? quota.five_hour_percentage / 100 : null;
        const util7d = typeof quota.seven_day_percentage === 'number' ? quota.seven_day_percentage / 100 : null;
        if (util5h === null && util7d === null) continue;
        const candidate = {
          util5h,
          reset5h: raw.five_hour?.resets_at || toIso(quota.five_hour_reset_time),
          util7d,
          reset7d: raw.seven_day?.resets_at || toIso(quota.seven_day_reset_time),
          fetchedAt: Math.floor(updatedMs / 1000),
          source: 'cockpit-claude',
        };
        if (!best || candidate.fetchedAt > best.fetchedAt) best = candidate;
      } catch { /* 單一帳號檔損壞不影響其他檔 */ }
    }
    if (!best) return null;
    if (Math.floor(now / 1000) - best.fetchedAt > COCKPIT_MAX_AGE_SEC) return null;
    return best;
  } catch {
    return null;
  }
}

function withCockpitFallback(failure) {
  const cockpit = readCockpitClaudeUsage();
  return cockpit ? { ok: true, data: cockpit } : failure;
}

// ─── 主要 export ─────────────────────────────────────────────────────────────

/**
 * fetchUsage() 回傳：
 *   { ok: true,  data: { util5h, reset5h, util7d, reset7d, fetchedAt } }
 *   { ok: false, kind: ErrorKind.*, message: string }
 *
 * util5h / util7d：0.0 ~ 1.0 的小數（百分比）
 * reset5h / reset7d：ISO 8601 字串，如 "2026-06-14T10:00:00Z"
 */
export async function fetchUsage({ _retried } = {}) {
  // 1. 快取命中
  const cached = readCache();
  if (cached) {
    return { ok: true, data: cached };
  }

  // 2. Lock 防重送（429 後官方 API 會鎖最長約 1 小時，期間改讀 cockpit-tools）
  const lock = readLock();
  if (lock) {
    return withCockpitFallback({ ok: false, kind: ErrorKind.RATE_LIMITED, message: `locked until ${lock.blockedUntil}` });
  }

  // 3. 取得 token
  const token = await getToken();
  if (!token) {
    return { ok: false, kind: ErrorKind.NO_TOKEN, message: 'No Claude Code credentials found' };
  }

  writeLock(LOCK_MAX_AGE_SEC, 'inflight');

  let resp;
  try {
    resp = await callUsageApi(token);
  } catch (e) {
    clearLock();
    return withCockpitFallback({ ok: false, kind: ErrorKind.NETWORK, message: e?.message || 'fetch failed' });
  }

  if (resp.status === 401 || resp.status === 403) {
    clearLock();
    if (!_retried) {
      const refreshed = await attemptCliRefresh();
      if (refreshed) return fetchUsage({ _retried: true });
    }
    return { ok: false, kind: ErrorKind.AUTH, message: `HTTP ${resp.status}` };
  }

  if (resp.status === 429) {
    const retryAfter = parseInt(resp.headers['retry-after'] || '300', 10);
    writeLock(retryAfter || 300, 'rate-limited');
    return withCockpitFallback({ ok: false, kind: ErrorKind.RATE_LIMITED, message: 'HTTP 429' });
  }

  if (resp.status !== 200) {
    clearLock();
    return withCockpitFallback({ ok: false, kind: ErrorKind.UNKNOWN, message: `HTTP ${resp.status}` });
  }

  const data = parseUsageApiBody(resp.body);
  if (!data || (data.util5h === null && data.util7d === null)) {
    clearLock();
    return withCockpitFallback({ ok: false, kind: ErrorKind.PARSE, message: 'usage headers missing' });
  }

  const result = { ...data, fetchedAt: Math.floor(Date.now() / 1000) };
  writeCache(result);
  clearLock();
  return { ok: true, data: result };
}

/**
 * formatReset(isoString) → 人類可讀的剩餘時間字串
 * 輸入：ISO 8601 字串（如 "2026-06-14T10:00:00Z"）或 unix epoch 數字
 * 輸出："47m" / "3h" / "2d" / "" / "now"
 */
export function formatReset(resetValue) {
  if (!resetValue) return '';
  let diffSec;
  if (typeof resetValue === 'number') {
    diffSec = resetValue - Math.floor(Date.now() / 1000);
  } else if (typeof resetValue === 'string') {
    diffSec = Math.floor((new Date(resetValue).getTime() - Date.now()) / 1000);
  } else {
    return '';
  }
  if (diffSec <= 0) return 'now';
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(diffSec / 3600);
  if (h < 48) return `${h}h`;
  return `${Math.round(diffSec / 86400)}d`;
}

// ErrorKind 相容性：讓 app.js 的 status / util 判斷不需要改
export const ErrorKindCompat = ErrorKind;
