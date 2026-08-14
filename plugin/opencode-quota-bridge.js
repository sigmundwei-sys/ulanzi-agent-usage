/**
 * OpenCode Go bridge.
 *
 * Reads OpenCode Go quota directly from the Console using the same tested
 * scraper shipped by @slkiser/opencode-quota. The CLI cache remains a fallback
 * for transient failures or when the direct scraper is unavailable.
 *
 * Required setup outside this plugin:
 *   1. Install @slkiser/opencode-quota.
 *   2. Enable its OpenCode and TUI plugins.
 *   3. Configure OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE, or
 *      opencode-quota's own opencode-go.json.
 *
 * No auth cookie is logged, persisted, or placed in an icon.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCallback);
const CLI_TIMEOUT_MS = 15_000;
const EXPORT_CACHE_TTL_MS = 30_000;
const LIVE_CACHE_TTL_MS = 30_000;
const LIVE_QUERY_TIMEOUT_MS = 12_000;
const MAX_CACHE_AGE_SEC = 15 * 60;

export const OPEN_CODE_USAGE_PROVIDERS = {
  opencode_go_5h: { label: 'OCG 5H', windowLabel: 'Server 5H', window: 'rolling' },
  opencode_go_7d: { label: 'OCG 7D', windowLabel: 'Server 7D', window: 'weekly' },
  opencode_go_month: { label: 'OCG MON', windowLabel: 'Server MON', window: 'monthly' },
};

let cachedExport = null;
let cachedExportAt = 0;
let exportInFlight = null;
let liveQuota = null;
let liveQuotaAt = 0;
let liveInFlight = null;
let liveRuntimeInFlight = null;

function resolveCli() {
  const override = process.env.OPENCODE_QUOTA_BIN?.trim();
  if (override) {
    const windowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(override);
    return {
      file: override,
      argsPrefix: [],
      windowsScript,
    };
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const scriptPath = path.join(
      appData,
      'npm',
      'node_modules',
      '@slkiser',
      'opencode-quota',
      'dist',
      'bin',
      'opencode-quota.js',
    );
    if (fs.existsSync(scriptPath)) {
      return { file: process.execPath, argsPrefix: [scriptPath], windowsScript: false };
    }
    const cmdPath = path.join(appData, 'npm', 'opencode-quota.cmd');
    if (fs.existsSync(cmdPath)) return { file: cmdPath, argsPrefix: [], windowsScript: true };
  }

  return { file: 'opencode-quota', argsPrefix: [], windowsScript: false };
}

function resolveScraperRoot() {
  const override = process.env.OPENCODE_QUOTA_ROOT?.trim();
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    override,
    path.join(appData, 'npm', 'node_modules', '@slkiser', 'opencode-quota'),
    path.join(localAppData, 'npm', 'node_modules', '@slkiser', 'opencode-quota'),
    path.join('/usr', 'local', 'lib', 'node_modules', '@slkiser', 'opencode-quota'),
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@slkiser', 'opencode-quota'),
  ].filter(Boolean);

  return candidates.find((root) => fs.existsSync(path.join(root, 'dist', 'lib', 'opencode-go.js'))) || null;
}

async function loadLiveRuntime() {
  if (liveRuntimeInFlight) return liveRuntimeInFlight;

  liveRuntimeInFlight = (async () => {
    const root = resolveScraperRoot();
    if (!root) {
      throw new Error('OpenCode Go direct scraper unavailable; install @slkiser/opencode-quota');
    }

    const scraperPath = path.join(root, 'dist', 'lib', 'opencode-go.js');
    const configPath = path.join(root, 'dist', 'lib', 'opencode-go-config.js');
    const [scraper, config] = await Promise.all([
      import(pathToFileURL(scraperPath).href),
      import(pathToFileURL(configPath).href),
    ]);

    if (typeof scraper.queryOpenCodeGoQuota !== 'function'
      || typeof config.resolveOpenCodeGoConfigCached !== 'function') {
      throw new Error('OpenCode Go direct scraper is incompatible');
    }
    return {
      queryOpenCodeGoQuota: scraper.queryOpenCodeGoQuota,
      resolveOpenCodeGoConfigCached: config.resolveOpenCodeGoConfigCached,
    };
  })().catch((error) => {
    liveRuntimeInFlight = null;
    throw error;
  });

  return liveRuntimeInFlight;
}

function classifyLiveFailure(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (/401|403|unauthorized|forbidden/.test(message)) {
    return 'OpenCode Go auth cookie rejected; run opencode-go-setup again';
  }
  if (/parse any known|dashboard format|parse/.test(message)) {
    return 'OpenCode Go returned no quota data; cookie may be expired, run opencode-go-setup again';
  }
  if (/timeout|timed out|network|fetch|connect|enotfound|econn/.test(message)) {
    return 'OpenCode Go dashboard request failed';
  }
  if (/credentials|configured|incomplete|config/.test(message)) {
    return 'OpenCode Go setup is incomplete; run opencode-go-setup again';
  }
  if (/scraper|install|incompatible/.test(message)) {
    return 'OpenCode Go direct scraper unavailable';
  }
  return 'OpenCode Go live refresh failed';
}

async function readLiveQuota() {
  const nowMs = Date.now();
  if (liveQuota && nowMs - liveQuotaAt < LIVE_CACHE_TTL_MS) return liveQuota;
  if (liveInFlight) return liveInFlight;

  liveInFlight = (async () => {
    const runtime = await loadLiveRuntime();
    const resolved = await runtime.resolveOpenCodeGoConfigCached({ maxAgeMs: 0 });
    if (resolved?.state !== 'configured') {
      throw new Error('OpenCode Go credentials are not configured');
    }

    const result = await runtime.queryOpenCodeGoQuota(
      resolved.config.workspaceId,
      resolved.config.authCookie,
      { requestTimeoutMs: LIVE_QUERY_TIMEOUT_MS },
    );
    if (!result?.success) throw new Error(String(result?.error || 'dashboard request failed'));

    const windows = {};
    for (const window of ['rolling', 'weekly', 'monthly']) {
      const entry = result[window];
      if (entry && Number.isFinite(Number(entry.usagePercent))) {
        windows[window] = {
          usagePercent: Number(entry.usagePercent),
          resetInSec: Number.isFinite(Number(entry.resetInSec))
            ? Math.max(0, Number(entry.resetInSec))
            : null,
          resetTimeIso: typeof entry.resetTimeIso === 'string' ? entry.resetTimeIso : null,
        };
      }
    }
    if (Object.keys(windows).length === 0) {
      throw new Error('dashboard response contained no usage windows');
    }

    return {
      windows,
      fetchedAt: Math.floor(Date.now() / 1000),
    };
  })()
    .then((value) => {
      liveQuota = value;
      liveQuotaAt = Date.now();
      return value;
    })
    .finally(() => {
      liveInFlight = null;
    });

  return liveInFlight;
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function runQuotaCli() {
  const cli = resolveCli();
  const cliArgs = ['show', '--provider', 'opencode-go', '--json'];
  const invocation = cli.windowsScript
    ? {
        file: process.env.ComSpec || 'cmd.exe',
        // Keep shell parsing explicit and limited to this fixed command. The
        // child process itself is still launched with shell:false.
        args: [
          '/d',
          '/s',
          '/c',
          `"${cli.file.replace(/"/g, '""')}" ${cliArgs.join(' ')}`,
        ],
      }
    : { file: cli.file, args: [...cli.argsPrefix, ...cliArgs] };
  let result;
  try {
    result = await execFile(
      invocation.file,
      invocation.args,
      {
        shell: false,
        windowsHide: true,
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  } catch (error) {
    // `show --json` can return a useful unavailable/error export with a
    // non-zero exit code when no provider cache exists yet.
    const parsed = parseJsonOutput(error?.stdout);
    if (parsed) return parsed;
    const message = String(error?.message || '').split(/\r?\n/, 1)[0].slice(0, 180);
    throw new Error('opencode-quota CLI unavailable: ' + (message || 'command failed'));
  }

  const parsed = parseJsonOutput(result.stdout);
  if (!parsed) throw new Error('opencode-quota returned no valid JSON');
  return parsed;
}

async function readQuotaExport() {
  const nowMs = Date.now();
  if (cachedExport && nowMs - cachedExportAt < EXPORT_CACHE_TTL_MS) {
    return cachedExport;
  }
  if (exportInFlight) return exportInFlight;

  exportInFlight = runQuotaCli()
    .then((value) => {
      cachedExport = value;
      cachedExportAt = Date.now();
      return value;
    })
    .finally(() => {
      exportInFlight = null;
    });
  return exportInFlight;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inferWindow(entry) {
  const value = String(entry?.window || entry?.label || entry?.name || '').toLowerCase();
  if (value.includes('rolling') || value.includes('5h') || value.includes('5 hour')) {
    return 'rolling';
  }
  if (value.includes('weekly') || value.includes('week')) return 'weekly';
  if (value.includes('monthly') || value.includes('month')) return 'monthly';
  return null;
}

function findWindowEntry(provider, window) {
  const entries = Array.isArray(provider?.entries) ? provider.entries : [];
  return entries.find((entry) => inferWindow(entry) === window) || null;
}

function safeProviderError(provider) {
  const message = String(provider?.error || provider?.errors?.[0]?.message || '').trim();
  return message.replace(/\s+/g, ' ').slice(0, 180);
}

function usageFromLive(def, live) {
  const entry = live?.windows?.[def.window];
  if (!entry) throw new Error('OpenCode Go live data missing ' + def.windowLabel);

  const usedPercent = Math.max(0, Math.min(100, Number(entry.usagePercent)));
  if (!Number.isFinite(usedPercent)) {
    throw new Error('OpenCode Go live data has no percentage for ' + def.windowLabel);
  }
  return {
    util: usedPercent / 100,
    usagePercent: usedPercent,
    reset: entry.resetTimeIso,
    resetInSec: entry.resetInSec,
    windowLabel: def.windowLabel,
    source: 'server-live',
    fetchedAt: live.fetchedAt,
    staleSec: 0,
  };
}

function usageFromExport(def, exported) {
  const provider = exported?.providers?.['opencode-go'];
  if (!provider || (provider.status !== 'ok' && provider.status !== 'partial')) {
    throw new Error(
      'OpenCode Go quota cache unavailable'
      + (safeProviderError(provider) ? ': ' + safeProviderError(provider) : ''),
    );
  }

  const entry = findWindowEntry(provider, def.window);
  if (!entry) throw new Error('OpenCode Go quota cache missing ' + def.windowLabel);

  const percentRemaining = finiteNumber(entry.percentRemaining);
  if (percentRemaining === null) {
    throw new Error('OpenCode Go quota cache has no percentage for ' + def.windowLabel);
  }

  const fetchedAt = finiteNumber(provider.fetchedAt) || 0;
  const staleSec = fetchedAt ? Math.max(0, Math.floor(Date.now() / 1000) - fetchedAt) : null;
  if (staleSec !== null && staleSec > MAX_CACHE_AGE_SEC) {
    throw new Error('OpenCode Go quota cache is stale');
  }

  const usedPercent = Math.max(0, Math.min(100, 100 - percentRemaining));
  const resetAt = finiteNumber(entry.resetAt);
  return {
    util: usedPercent / 100,
    usagePercent: usedPercent,
    reset: resetAt ? new Date(resetAt * 1000).toISOString() : null,
    resetInSec: resetAt ? Math.max(0, resetAt - Math.floor(Date.now() / 1000)) : null,
    windowLabel: def.windowLabel,
    source: 'server-cache',
    fetchedAt: fetchedAt || null,
    staleSec,
  };
}

/**
 * Return server-reported usage in the shape consumed by renderer.renderUsage.
 * opencode-quota exports percentRemaining, while the Console screenshot shows
 * percent used, so the bridge deliberately inverts the exported value.
 */
export async function readOpenCodeUsage(providerKey) {
  const def = OPEN_CODE_USAGE_PROVIDERS[providerKey];
  if (!def) return null;

  let liveError = null;
  try {
    const live = await readLiveQuota();
    return usageFromLive(def, live);
  } catch (error) {
    liveError = classifyLiveFailure(error);
  }

  // Keep the upstream CLI cache as a bounded fallback. The caller also keeps
  // its last successful value, so a temporary 401/network failure never turns
  // an already-rendered percentage into a false zero.
  try {
    const exported = await readQuotaExport();
    return usageFromExport(def, exported);
  } catch {
    throw new Error(liveError || 'OpenCode Go quota unavailable');
  }
}
