/**
 * Codex usage provider.
 *
 * Uses the official `codex app-server` JSON-RPC surface instead of reading a
 * third-party account cache or calling the undocumented ChatGPT usage route
 * directly. The app-server owns the user's existing Codex login and returns
 * rate-limit windows with their duration and reset timestamp.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REQUEST_TIMEOUT_MS = 12_000;
const WINDOW_TOLERANCE_MINUTES = 60;
const TARGET_WINDOWS = Object.freeze({
  hourly: 300,
  weekly: 10_080,
});

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function globalCodexJsCandidates() {
  const candidates = [];
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const npmPrefix = process.env.npm_config_prefix;

  if (appData) {
    candidates.push(path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  }
  if (localAppData) {
    candidates.push(path.join(localAppData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  }
  if (npmPrefix) {
    candidates.push(path.join(npmPrefix, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  }

  candidates.push(
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    path.join('/usr', 'local', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  );

  return candidates;
}

function resolveInvocation() {
  const configured = process.env.CODEX_APP_SERVER_JS?.trim();
  const jsFile = configured || globalCodexJsCandidates().find(isFile);
  if (jsFile && isFile(jsFile)) {
    return { kind: 'node', file: process.execPath, args: [jsFile] };
  }

  // Native Codex installations can expose an executable directly. Do not
  // invoke a user-controlled command string through a shell in this path.
  const executable = process.env.CODEX_BIN?.trim();
  if (executable && isFile(executable)) {
    return { kind: 'executable', file: executable, args: [] };
  }

  if (process.platform !== 'win32') {
    return { kind: 'path', file: 'codex', args: [] };
  }

  // npm's Windows shim is the final fallback. Its arguments are fixed below;
  // no token or account value is ever interpolated into the command line.
  const shim = path.join(process.env.APPDATA || '', 'npm', 'codex.cmd');
  if (isFile(shim)) {
    return { kind: 'windows-shim', file: shim, args: [] };
  }

  return null;
}

function spawnAppServer(invocation) {
  if (!invocation) throw new Error('Codex CLI not found; install Codex and run codex login');

  const appServerArgs = ['app-server', '--stdio'];
  if (invocation.kind === 'windows-shim') {
    const command = `"${invocation.file.replace(/"/g, '""')}" app-server --stdio`;
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  return spawn(invocation.file, [...invocation.args, ...appServerArgs], {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function writeMessage(child, message) {
  try {
    if (!child.stdin?.writable) return false;
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  } catch {
    return false;
  }
}

function parseJsonLines(child, onMessage) {
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        // The app-server protocol is JSONL. Ignore non-protocol noise so a
        // warning from the CLI cannot make the quota poller crash.
      }
    }
  });

  // Always consume stderr. It may contain CLI diagnostics, but it must never
  // be copied to the Ulanzi log because it could contain provider details.
  child.stderr.resume();
}

async function requestRateLimits() {
  const child = spawnAppServer(resolveInvocation());

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error('Codex app-server rate-limit request timed out'));
    }, REQUEST_TIMEOUT_MS);

    child.on('error', (error) => finish(new Error(`Codex app-server unavailable: ${error.message}`)));
    child.on('close', (code) => {
      if (!settled) finish(new Error(`Codex app-server exited before returning rate limits (code ${code ?? 'unknown'})`));
    });
    child.stdin.on('error', (error) => finish(new Error(`Codex app-server input failed: ${error.message}`)));

    parseJsonLines(child, (message) => {
      if (message?.id === 1) {
        if (!writeMessage(child, { method: 'initialized', params: {} })
          || !writeMessage(child, { method: 'account/rateLimits/read', id: 2 })) {
          finish(new Error('Codex app-server input closed during initialization'));
        }
      } else if (message?.id === 2) {
        if (message.error) {
          finish(new Error(message.error.message || 'Codex app-server returned an error'));
        } else {
          finish(null, message.result?.rateLimits || null);
        }
      }
    });

    if (!writeMessage(child, {
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'ulanzi_agent_usage',
          title: 'Ulanzi Agent Usage',
          version: '1.0.0',
        },
      },
    })) {
      finish(new Error('Codex app-server input is not writable'));
    }
  });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWindow(window) {
  return window === 'weekly' ? 'weekly' : 'hourly';
}

/**
 * Convert the official rate-limit response into the plugin's common usage
 * shape. Exported separately so fixtures can test window selection without
 * starting Codex or touching local credentials.
 */
export function parseCodexRateLimits(rateLimits, window = 'hourly', now = Date.now()) {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  const target = TARGET_WINDOWS[normalizeWindow(window)];
  const candidates = [rateLimits.primary, rateLimits.secondary].filter(Boolean);
  const selected = candidates.find((entry) => {
    const minutes = finiteNumber(entry.windowDurationMins);
    return minutes !== null && Math.abs(minutes - target) <= WINDOW_TOLERANCE_MINUTES;
  });
  if (!selected) return null;

  const usedPercent = finiteNumber(selected.usedPercent);
  if (usedPercent === null) return null;

  const resetAt = finiteNumber(selected.resetsAt);
  return {
    util: Math.max(0, Math.min(1, usedPercent / 100)),
    reset: resetAt === null ? null : new Date(resetAt * 1000).toISOString(),
    updatedAt: Math.floor(now / 1000),
    staleSec: 0,
    source: 'codex-app-server',
    windowMinutes: finiteNumber(selected.windowDurationMins),
  };
}

export async function readCodexUsage(window = 'hourly') {
  const rateLimits = await requestRateLimits();
  return parseCodexRateLimits(rateLimits, window);
}
