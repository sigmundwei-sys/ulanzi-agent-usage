import os from 'node:os';
import path from 'node:path';
import { providerConfig, pathFromConfig, readJsonFile } from './local-config.js';

const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30_000;

let billingCache = null;
let billingPromise = null;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function percentToUtil(value) {
  const percent = finiteNumber(value);
  return percent == null ? null : clamp(percent / 100);
}

function toIsoDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getAuthFile(settings = {}) {
  const config = providerConfig('grok', settings);
  const configuredAuthFile = config.authFile || process.env.GROK_AUTH_JSON;
  if (configuredAuthFile) return pathFromConfig(configuredAuthFile, configuredAuthFile);

  const grokHome = pathFromConfig(
    config.grokHome || process.env.GROK_HOME,
    path.join(os.homedir(), '.grok'),
  );
  return path.join(grokHome, 'auth.json');
}

function readGrokCredential(settings = {}) {
  const auth = readJsonFile(getAuthFile(settings));
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return null;

  const entries = Object.entries(auth)
    .filter(([, value]) => value && typeof value === 'object' && typeof value.key === 'string')
    .filter(([, value]) => value.key.trim().length > 0)
    .sort(([left], [right]) => {
      const leftIsXai = left.includes('auth.x.ai') ? 0 : 1;
      const rightIsXai = right.includes('auth.x.ai') ? 0 : 1;
      return leftIsXai - rightIsXai;
    });

  if (entries.length === 0) return null;
  const [, account] = entries[0];
  return {
    token: account.key.trim(),
    userId: typeof account.user_id === 'string' ? account.user_id : null,
  };
}

async function fetchBilling(settings = {}) {
  const credential = readGrokCredential(settings);
  if (!credential || typeof fetch !== 'function') return null;

  const config = providerConfig('grok', settings);
  const headers = {
    Accept: 'application/json',
    Authorization: 'Bearer ' + credential.token,
    'X-XAI-Token-Auth': 'xai-grok-cli',
  };
  if (credential.userId) headers['x-userid'] = credential.userId;
  if (config.clientVersion || process.env.GROK_CLIENT_VERSION) {
    headers['x-grok-client-version'] = config.clientVersion || process.env.GROK_CLIENT_VERSION;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(GROK_BILLING_URL, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBilling(settings = {}) {
  const now = Date.now();
  if (billingCache && now - billingCache.fetchedAt < CACHE_TTL_MS) return billingCache.body;
  if (billingPromise) return billingPromise;

  billingPromise = fetchBilling(settings)
    .then((body) => {
      if (body) billingCache = { body, fetchedAt: Date.now() };
      return body;
    })
    .finally(() => {
      billingPromise = null;
    });
  return billingPromise;
}

function getConfig(body) {
  return body?.config || body?.billing?.config || body?.data?.config || null;
}

function getPeriod(config) {
  return config?.currentPeriod || config?.current_period || config?.period || null;
}

function isWeeklyPeriod(period) {
  const type = String(period?.type || period?.periodType || period?.period_type || '').toUpperCase();
  return !type || type.includes('WEEK');
}

function getProductUsage(config) {
  const productUsage = config?.productUsage || config?.product_usage || config?.details?.product_usage;
  return Array.isArray(productUsage) ? productUsage : [];
}

function getProductPercent(row) {
  return row?.usagePercent ?? row?.usage_percent ?? row?.percentUsed ?? row?.percent_used;
}

export function parseGrokBilling(body, metric = 'weekly', now = Date.now()) {
  const config = getConfig(body);
  if (!config) return null;

  const period = getPeriod(config);
  if (!isWeeklyPeriod(period)) return null;

  let usedPercent = null;
  if (metric === 'build') {
    const product = getProductUsage(config).find((row) => {
      const name = String(row?.product || row?.name || '').toUpperCase();
      return name === 'PRODUCT_GROK_BUILD' || name === 'GROKBUILD' || name.includes('GROK_BUILD');
    });
    usedPercent = getProductPercent(product);
  } else {
    usedPercent = config.creditUsagePercent ?? config.credit_usage_percent;
  }

  const util = percentToUtil(usedPercent);
  if (util == null) return null;

  const reset = toIsoDate(
    period?.end || period?.endTime || period?.end_time || config.periodEnd || config.period_end,
  );
  return {
    util,
    reset,
    updatedAt: Math.floor(now / 1000),
    staleSec: 0,
    source: 'grok-cli-billing',
    windowMinutes: 10080,
  };
}

export async function readGrokUsage(metric = 'weekly', settings = {}) {
  const body = await readBilling(settings);
  return parseGrokBilling(body, metric);
}
