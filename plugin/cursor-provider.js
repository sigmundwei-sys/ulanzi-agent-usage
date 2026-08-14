/**
 * Cursor usage provider.
 *
 * Cursor does not currently publish an individual-plan usage API. This
 * adapter uses the same read-only dashboard endpoint used by the web UI and
 * requires the user to provide the httpOnly WorkosCursorSessionToken locally.
 * It is intentionally isolated and marked experimental in the README because
 * the endpoint is undocumented and may change.
 */

import { execFileSync } from 'node:child_process';

import { providerConfig } from './local-config.js';
import { requestJson } from './provider-http.js';

const DEFAULT_URL = 'https://cursor.com/api/usage-summary';

function numberAt(object, keys) {
  for (const key of keys) {
    const value = Number(object?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function selectedProfile(config, settings) {
  const profiles = Array.isArray(config?.profiles) ? config.profiles : [];
  if (!profiles.length) return config;
  const selected = settings.profileId || settings.accountLogin || config.defaultProfile;
  return selected
    ? profiles.find((item) => [item.id, item.label, item.email].includes(selected)) || null
    : profiles[0];
}

function readWindowsUserEnvironmentVariable(name) {
  if (process.platform !== 'win32' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return null;
  }

  try {
    const value = execFileSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Environment]::GetEnvironmentVariable('${name}', 'User')`,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 1500,
        windowsHide: true,
      },
    ).trim();
    return value || null;
  } catch {
    return null;
  }
}

function getSessionToken(config, settings) {
  const profile = selectedProfile(config, settings);
  if (!profile) return null;
  const envName = profile.sessionTokenEnv || config.sessionTokenEnv || 'CURSOR_SESSION_TOKEN';
  return profile.sessionToken
    || process.env[envName]?.trim()
    || readWindowsUserEnvironmentVariable(envName);
}

function resetIso(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const number = Number(value);
    const date = new Date(number > 1e12 ? number : number * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return String(value);
}

export function parseCursorUsage(body, now = Date.now()) {
  const plan = body?.individualUsage?.plan || body?.plan || body?.usage?.plan;
  if (!plan) return null;

  const totalPercent = numberAt(plan, ['totalPercentUsed', 'total_percent_used']);
  const used = numberAt(plan, ['used', 'consumed']);
  const limit = numberAt(plan, ['limit', 'entitlement', 'quota']);
  let util;
  if (totalPercent !== null) util = totalPercent / 100;
  else if (used !== null && limit !== null && limit > 0) util = used / limit;
  else if (body?.isUnlimited) util = 0;
  else return null;

  return {
    util: Math.max(0, Math.min(1, util)),
    reset: resetIso(body.billingCycleEnd || body.billing_cycle_end),
    updatedAt: Math.floor(now / 1000),
    staleSec: 0,
    source: 'cursor-dashboard',
  };
}

export async function readCursorUsage(settings = {}) {
  const config = providerConfig('cursor', settings);
  const token = getSessionToken(config, settings);
  if (!token) {
    throw new Error('Cursor session token not configured; see the local setup guide');
  }

  const response = await requestJson(config.usageUrl || DEFAULT_URL, {
    headers: { Cookie: `WorkosCursorSessionToken=${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Cursor session token was rejected; copy a fresh dashboard cookie');
  }
  if (response.status !== 200 || !response.body) {
    throw new Error(`Cursor usage request failed (HTTP ${response.status || 0})`);
  }
  const parsed = parseCursorUsage(response.body);
  if (!parsed) throw new Error('Cursor returned no plan usage');
  return parsed;
}
