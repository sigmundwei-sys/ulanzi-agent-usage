/**
 * GitHub Copilot usage provider.
 *
 * The Copilot extension exposes its entitlement route through GitHub's public
 * API host. We use the user's local Copilot OAuth token (or an explicitly
 * supplied environment variable) and never persist or log that token.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestJson } from './provider-http.js';
import { expandPath, providerConfig } from './local-config.js';

const ENTITLEMENT_URL = 'https://api.github.com/copilot_internal/user';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function selectedProfile(config, settings) {
  const profiles = Array.isArray(config?.profiles) ? config.profiles : [];
  if (!profiles.length) return config;
  const selected = settings.profileId || settings.accountLogin || config.defaultProfile;
  return selected
    ? profiles.find((item) => [item.id, item.label, item.login, item.email].includes(selected)) || null
    : profiles[0];
}

function authFileCandidates(config) {
  const configured = expandPath(config?.hostsFile || config?.authFile);
  const home = os.homedir();
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  return [
    configured,
    process.env.GITHUB_COPILOT_HOSTS_FILE,
    path.join(home, '.config', 'github-copilot', 'hosts.json'),
    path.join(home, '.config', 'github-copilot', 'apps.json'),
    path.join(home, '.copilot', 'hosts.json'),
    appData && path.join(appData, 'GitHub Copilot', 'hosts.json'),
    localAppData && path.join(localAppData, 'GitHub Copilot', 'hosts.json'),
    appData && path.join(appData, 'github-copilot', 'hosts.json'),
    localAppData && path.join(localAppData, 'github-copilot', 'hosts.json'),
  ].filter(Boolean);
}

function findToken(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.oauth_token === 'string' && value.oauth_token) return value.oauth_token;
  if (typeof value.oauthToken === 'string' && value.oauthToken) return value.oauthToken;
  if (typeof value.access_token === 'string' && value.access_token) return value.access_token;
  for (const child of Object.values(value)) {
    const token = findToken(child);
    if (token) return token;
  }
  return null;
}

function getToken(config, settings) {
  const profile = selectedProfile(config, settings);
  if (!profile) return null;
  const envName = profile.tokenEnv || config?.tokenEnv || 'GITHUB_COPILOT_TOKEN';
  const envToken = process.env[envName]?.trim();
  if (envToken) return envToken;
  if (profile.token) return profile.token;
  for (const file of authFileCandidates(profile)) {
    const token = findToken(readJson(file));
    if (token) return token;
  }
  return null;
}

function numberAt(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseSnapshot(snapshot, reset) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const remaining = numberAt(snapshot, ['percent_remaining', 'percentRemaining', 'remaining_percent', 'remainingPercent']);
  const used = numberAt(snapshot, ['percent_used', 'percentUsed', 'used_percent', 'usedPercent']);
  const entitlement = numberAt(snapshot, ['entitlement', 'limit', 'quota', 'total']);
  const consumed = numberAt(snapshot, ['used', 'consumed']);

  let util;
  if (used !== null) util = used / 100;
  else if (remaining !== null) util = (100 - remaining) / 100;
  else if (entitlement !== null && entitlement > 0 && consumed !== null) util = consumed / entitlement;
  else return null;

  return {
    util: Math.max(0, Math.min(1, util)),
    reset: reset || snapshot.reset_at || snapshot.resetAt || null,
    updatedAt: Math.floor(Date.now() / 1000),
    staleSec: 0,
    source: 'github-copilot-entitlement',
  };
}

function resetValue(body) {
  const value = body?.copilot_limited_user_reset_date
    ?? body?.copilot_quota_reset_date
    ?? body?.limited_user_reset_date
    ?? body?.quota_reset_date
    ?? body?.reset_at
    ?? body?.resetAt
    ?? null;
  if (value == null) return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const number = Number(value);
    return new Date(number > 1e12 ? number : number * 1000).toISOString();
  }
  return String(value);
}

export function parseCopilotEntitlement(body, metric = 'chat') {
  const snapshots = body?.copilot_quota_snapshots
    || body?.quota_snapshots
    || body?.quotaSnapshots
    || body?.quotas
    || {};
  const snapshot = snapshots[metric]
    || snapshots[metric === 'chat' ? 'premium_interactions' : 'completions'];
  return parseSnapshot(snapshot, resetValue(body));
}

export async function readCopilotUsage(metric = 'chat', settings = {}) {
  const config = providerConfig('copilot', settings);
  const token = getToken(config, settings);
  if (!token) throw new Error('GitHub Copilot token not found; sign in to Copilot or set GITHUB_COPILOT_TOKEN');

  const response = await requestJson(config.entitlementUrl || ENTITLEMENT_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('GitHub Copilot credentials were rejected');
  }
  if (response.status !== 200 || !response.body) {
    throw new Error(`GitHub Copilot entitlement request failed (HTTP ${response.status || 0})`);
  }
  const data = parseCopilotEntitlement(response.body, metric);
  if (!data) throw new Error(`GitHub Copilot returned no ${metric} quota`);
  return data;
}
