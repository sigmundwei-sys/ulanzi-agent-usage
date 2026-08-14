/**
 * Kiro / Amazon Q Developer usage provider.
 *
 * This adapter talks to the AWS usage endpoint directly. It deliberately
 * knows nothing about any third-party account manager. The user supplies the
 * static Kiro profile ARN in the local Agent Usage config file and the
 * adapter reuses the Kiro/AWS SSO cache for the short-lived access token.
 *
 * Provider config example:
 * {
 *   "providers": {
 *     "kiro": {
 *       "profiles": [
 *         {
 *           "id": "work",
 *           "label": "Work",
 *           "profileArn": "arn:aws:codewhisperer:us-east-1:...",
 *           "authFile": "%USERPROFILE%/.aws/sso/cache/kiro-auth-token.json",
 *           "clientRegistrationFile": "%USERPROFILE%/.aws/sso/cache/<clientIdHash>.json"
 *         }
 *       ]
 *     }
 *   }
 * }
 *
 * Tokens remain in the user's AWS SSO cache. They are never written to the
 * plugin checkout, logs, or Ulanzi settings.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { providerConfig, pathFromConfig } from './local-config.js';
import { requestJson } from './provider-http.js';

const DEFAULT_AUTH_FILE = path.join(
  os.homedir(),
  '.aws',
  'sso',
  'cache',
  'kiro-auth-token.json',
);
const REQUEST_TIMEOUT_MS = 8_000;
const KIRO_APP_PROCESS_NAME = 'Kiro.exe';
const REFRESH_COOLDOWN_MS = 4 * 60 * 1000;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomically(file, value) {
  const temp = `${file}.ulanzi-tmp-${process.pid}`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2));
    fs.renameSync(temp, file);
  } catch {
    try { fs.unlinkSync(temp); } catch {}
  }
}

function isProcessRunning(imageName) {
  if (process.platform !== 'win32') return false;
  try {
    const output = execSync(
      `tasklist /FI "IMAGENAME eq ${imageName}" /NH`,
      { encoding: 'utf8', windowsHide: true },
    );
    return output.toLowerCase().includes(imageName.toLowerCase());
  } catch {
    return false;
  }
}

function parseArnRegion(arn) {
  const parts = String(arn).split(':');
  return parts[3]?.trim() || 'us-east-1';
}

function runtimeEndpoint(region) {
  const normalized = String(region || 'us-east-1').toLowerCase();
  if (normalized.startsWith('us-gov-')) return `https://q-fips.${normalized}.amazonaws.com`;
  return `https://q.${normalized}.amazonaws.com`;
}

function normaliseProfileList(config) {
  if (Array.isArray(config?.profiles)) return config.profiles.filter(Boolean);
  if (typeof config?.profileArn === 'string' && config.profileArn.trim()) {
    return [{
      id: 'default',
      label: 'Default',
      profileArn: config.profileArn,
      region: config.region,
      authFile: config.authFile,
      clientRegistrationFile: config.clientRegistrationFile,
    }];
  }
  const envArn = process.env.KIRO_PROFILE_ARN?.trim();
  return envArn ? [{ id: 'default', label: 'Default', profileArn: envArn }] : [];
}

function resolveProfile(settings = {}) {
  const config = providerConfig('kiro', settings);
  const profiles = normaliseProfileList(config);
  const selectedId = settings.profileId || settings.accountLogin || config.defaultProfile;
  const profile = selectedId
    ? profiles.find((item) => [item.id, item.label, item.email, item.login].includes(selectedId))
    : profiles[0];
  if (!profile || typeof profile.profileArn !== 'string' || !profile.profileArn.startsWith('arn:')) {
    throw new Error('Kiro profile ARN is not configured; edit the local Agent Usage config');
  }

  const authFile = pathFromConfig(
    profile.authFile || config.authFile || process.env.KIRO_AUTH_FILE,
    DEFAULT_AUTH_FILE,
  );
  const auth = readJson(authFile);
  if (!auth?.accessToken) {
    throw new Error(`Kiro access token not found in ${authFile}`);
  }

  const registrationFile = pathFromConfig(
    profile.clientRegistrationFile
      || config.clientRegistrationFile
      || process.env.KIRO_CLIENT_REGISTRATION_FILE,
    auth.clientIdHash
      ? path.join(path.dirname(authFile), `${auth.clientIdHash}.json`)
      : '',
  );

  return {
    config,
    profile,
    authFile,
    auth,
    registrationFile,
    region: profile.region || config.region || parseArnRegion(profile.profileArn),
  };
}

function refreshLockFile(authFile) {
  const id = crypto.createHash('sha256').update(authFile).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `ulanzi-agent-usage-kiro-refresh-${id}.lock`);
}

function refreshOnCooldown(authFile) {
  try {
    const stamp = Number(fs.readFileSync(refreshLockFile(authFile), 'utf8'));
    return Number.isFinite(stamp) && Date.now() - stamp < REFRESH_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markRefreshAttempt(authFile) {
  try { fs.writeFileSync(refreshLockFile(authFile), String(Date.now())); } catch {}
}

function buildUsageUrl(endpoint, profileArn) {
  const query = new URLSearchParams({
    origin: 'AI_EDITOR',
    profileArn,
    resourceType: 'AGENTIC_REQUEST',
    isEmailRequired: 'true',
  });
  return `${endpoint}/getUsageLimits?${query}`;
}

function epochToIso(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const milliseconds = number > 1e12 ? number : number * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseKiroUsage(body, now = Date.now()) {
  const breakdown = Array.isArray(body?.usageBreakdownList)
    ? body.usageBreakdownList[0]
    : null;
  if (!breakdown) return null;
  const used = Number(breakdown.currentUsageWithPrecision ?? breakdown.currentUsage);
  const limit = Number(breakdown.usageLimitWithPrecision ?? breakdown.usageLimit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;

  return {
    util: Math.max(0, Math.min(1, used / limit)),
    reset: epochToIso(breakdown.nextDateReset ?? body.nextDateReset),
    updatedAt: Math.floor(now / 1000),
    staleSec: 0,
    source: 'kiro-usage-api',
  };
}

async function readUsage(profile, accessToken) {
  return requestJson(buildUsageUrl(runtimeEndpoint(profile.region), profile.profile.profileArn), {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

async function refreshAccessToken(profile) {
  if (refreshOnCooldown(profile.authFile)) return null;
  const refreshToken = profile.auth?.refreshToken || profile.auth?.refresh_token;
  const registration = readJson(profile.registrationFile);
  if (!profile.auth?.region || !refreshToken || !registration?.clientId || !registration?.clientSecret) {
    return null;
  }

  markRefreshAttempt(profile.authFile);
  const response = await requestJson(`https://oidc.${profile.auth.region}.amazonaws.com/token`, {
    method: 'POST',
    body: {
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      grantType: 'refresh_token',
      refreshToken,
    },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (response.status !== 200 || !response.body) return null;

  const accessToken = response.body.accessToken || response.body.access_token;
  if (!accessToken) return null;
  const next = { ...profile.auth, accessToken };
  const nextRefresh = response.body.refreshToken || response.body.refresh_token;
  if (nextRefresh) next.refreshToken = nextRefresh;
  const expiresIn = Number(response.body.expiresIn ?? response.body.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    next.expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  writeJsonAtomically(profile.authFile, next);
  return accessToken;
}

async function retryAfterKiroRefresh(profile, initialResponse) {
  let response = initialResponse;
  if (response.status !== 401 && response.status !== 403) return response;

  if (isProcessRunning(KIRO_APP_PROCESS_NAME)) {
    for (const delay of [8_000, 15_000, 20_000]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const fresh = readJson(profile.authFile);
      if (fresh?.accessToken) response = await readUsage(profile, fresh.accessToken);
      if (response.status === 200) return response;
    }
  }

  const token = await refreshAccessToken({ ...profile, auth: readJson(profile.authFile) || profile.auth });
  if (!token) return response;
  for (const delay of [10_000, 20_000]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await readUsage(profile, token);
    if (response.status === 200) return response;
  }
  return response;
}

/** Fetch the selected Kiro profile directly from AWS. */
export async function fetchKiroLive(settings = {}) {
  const profile = resolveProfile(settings);
  let response = await readUsage(profile, profile.auth.accessToken);
  response = await retryAfterKiroRefresh(profile, response);
  if (response.status !== 200 || !response.body) {
    throw new Error(`Kiro usage request failed (HTTP ${response.status || 0})`);
  }
  const parsed = parseKiroUsage(response.body);
  if (!parsed) throw new Error('Kiro returned no usage breakdown');
  return parsed;
}

