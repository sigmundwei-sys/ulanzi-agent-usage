#!/usr/bin/env node

/**
 * Local-only account import wizard.
 *
 * The browser UI is served from loopback and receives only masked account
 * metadata. Credentials are read and written inside this Node process; raw
 * tokens are never returned through HTTP, printed, or stored in config.json.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  defaultCursorStateDbPath,
  defaultConfigPath,
  discoverCursorLocalAccounts,
  discoverKiroProfileCandidates,
  expandPath,
  mergeKiroConfig,
  readConfig,
  setWindowsUserEnvironmentVariable,
  writeConfigAtomically,
} from './setup.mjs';

const CURSOR_ENV = 'CURSOR_SESSION_TOKEN';
const MAX_BODY_BYTES = 32 * 1024;
const WIZARD_TIMEOUT_MS = 15 * 60 * 1000;

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(html),
  });
  response.end(html);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request-too-large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function safeConfigRead(file) {
  try {
    return readConfig(file);
  } catch {
    return {};
  }
}

function cursorView(discovery) {
  const account = discovery.accounts[0];
  if (!account) {
    const message = discovery.source === 'cursor-state-reader-unavailable'
      ? '找不到可用的 SQLite 讀取器；請安裝 Node.js 22+、sqlite3 或 Python。'
      : discovery.source === 'cursor-state-not-found'
        ? '找不到 Cursor 本機登入資料。請先在 Cursor 登入。'
        : 'Cursor 本機資料庫中沒有可匯入的登入帳號。';
    return { status: 'unavailable', message, source: discovery.source, reader: discovery.reader };
  }
  return {
    status: 'ready',
    id: account.id,
    email: account.maskedEmail,
    source: 'Cursor 本機 state.vscdb',
    reader: discovery.reader,
  };
}

function kiroView(discovery) {
  const authReady = discovery.auth.present && discovery.auth.hasAccessToken;
  const candidates = discovery.candidates.map((candidate) => ({
    id: candidate.id,
    region: candidate.region || '未辨識區域',
    email: candidate.maskedEmail,
    source: candidate.source === 'kiro-local-profile' ? 'Kiro 本機 profile.json' : candidate.source === 'existing-config' ? '目前 Agent Usage 設定' : '保留的舊本機備份',
    matchedAuth: candidate.matchedAuth,
  }));
  let status = candidates.length && authReady ? 'ready' : 'unavailable';
  let message = '';
  if (!authReady) message = '找不到 Kiro/AWS SSO access token，請先在 Kiro 登入。';
  else if (!candidates.length) message = '找不到 Kiro profile ARN；請先在 Kiro 完成登入。';
  return { status, message, authReady, candidates };
}

async function scan({ configFile, backupRoot, cursorStateDb }) {
  const config = safeConfigRead(configFile);
  const cursor = await discoverCursorLocalAccounts({ stateDb: cursorStateDb });
  const kiro = discoverKiroProfileCandidates(config, { backupRoot });
  return {
    cursor: cursorView(cursor),
    kiro: kiroView(kiro),
  };
}

async function importAccount({ provider, id, configFile, backupRoot, cursorStateDb, dryRun }) {
  const config = safeConfigRead(configFile);
  if (provider === 'cursor') {
    const discovery = await discoverCursorLocalAccounts({ stateDb: cursorStateDb });
    const account = discovery.accounts.find((item) => item.id === id);
    if (!account) return { status: 'error', message: '找不到這個 Cursor 本機帳號，請重新掃描。' };
    if (!dryRun) setWindowsUserEnvironmentVariable(CURSOR_ENV, account.sessionToken);
    return {
      status: dryRun ? 'would-import' : 'imported',
      message: dryRun ? '模擬完成：未寫入任何本機設定。' : 'Cursor 帳號已匯入；請重新啟動 Ulanzi Studio。',
    };
  }

  if (provider === 'kiro') {
    const discovery = discoverKiroProfileCandidates(config, { backupRoot });
    const candidate = discovery.candidates.find((item) => item.id === id);
    if (!candidate) return { status: 'error', message: '找不到這個 Kiro profile，請重新掃描。' };
    if (!discovery.auth.present || !discovery.auth.hasAccessToken) {
      return { status: 'error', message: '找不到 Kiro/AWS SSO access token，請先在 Kiro 登入。' };
    }
    const next = mergeKiroConfig(config, [candidate.profileArn]);
    const backup = writeConfigAtomically(configFile, next, dryRun);
    return {
      status: dryRun ? 'would-import' : 'imported',
      message: dryRun ? '模擬完成：未寫入任何本機設定。' : 'Kiro 帳號已匯入；請重新啟動 Ulanzi Studio。',
      backupCreated: Boolean(backup),
    };
  }

  return { status: 'error', message: '不支援的 provider。' };
}

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? ['explorer.exe', [url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // The URL is still printed for manual opening.
  }
}

export async function startWizard({
  configFile = defaultConfigPath(),
  backupRoot,
  cursorStateDb = defaultCursorStateDbPath(),
  dryRun = false,
  openBrowser: shouldOpenBrowser = true,
} = {}) {
  const htmlFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wizard.html');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const state = {
    configFile: expandPath(configFile),
    backupRoot,
    cursorStateDb: expandPath(cursorStateDb),
    dryRun,
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        sendHtml(response, html);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        sendJson(response, 200, { mode: dryRun ? 'dry-run' : 'live', ...(await scan(state)) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/import') {
        const body = JSON.parse(await readBody(request));
        const result = await importAccount({ ...state, provider: body.provider, id: body.id });
        sendJson(response, result.status === 'error' ? 400 : 200, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/close') {
        sendJson(response, 200, { status: 'closed' });
        setTimeout(() => server.close(), 20);
        return;
      }
      sendJson(response, 404, { status: 'error', message: 'Not found' });
    } catch (error) {
      const message = error?.message === 'request-too-large'
        ? '請求內容過大。'
        : '本機匯入失敗，請重新掃描或查看終端機錯誤。';
      sendJson(response, 500, { status: 'error', message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  console.log(`Account import wizard: ${url}`);
  console.log('Only loopback is used. Close the browser page when the import is complete.');
  if (shouldOpenBrowser) openBrowser(url);

  const timeout = setTimeout(() => server.close(), WIZARD_TIMEOUT_MS);
  timeout.unref();
  await new Promise((resolve) => server.once('close', resolve));
}

const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisFile = path.resolve(fileURLToPath(import.meta.url));
if (entryFile === thisFile) {
  const args = new Set(process.argv.slice(2));
  const configIndex = process.argv.indexOf('--config');
  const backupIndex = process.argv.indexOf('--backup-root');
  const stateDbIndex = process.argv.indexOf('--cursor-state-db');
  startWizard({
    configFile: configIndex >= 0 ? process.argv[configIndex + 1] : undefined,
    backupRoot: backupIndex >= 0 ? process.argv[backupIndex + 1] : undefined,
    cursorStateDb: stateDbIndex >= 0 ? process.argv[stateDbIndex + 1] : undefined,
    dryRun: args.has('--dry-run'),
    openBrowser: !args.has('--no-open'),
  }).catch((error) => {
    console.error(`Wizard failed: ${error.message}`);
    process.exitCode = 1;
  });
}
