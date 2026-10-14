/**
 * app.js  — Ulanzi Agent Usage Plugin (Windows + macOS)
 *
 * 包含兩類 action：
 *   1. Claude Code 直接 API（fivehour / weekly）
 *   2. 各 provider 的獨立 adapter（Codex / Cursor / Copilot / Kiro / Antigravity）
 *   3. OpenCode Go server-side 配額快取（5h / 7d / 本月）
 */

import UlanziApi from './plugin-common-node/index.js';
import { fetchUsage, formatReset, readStaleCache, ErrorKind } from './usage-fetcher.js';
import { PROVIDER_ACTION_MAP, PROVIDER_DEFS, readProviderUsage, readInitialProviderState } from './provider-fetcher.js';
import { readOpenCodeUsage } from './opencode-quota-bridge.js';
import {
  renderUsage,
  renderStopped,
  renderNoToken,
  renderReauth,
  renderLoading,
  renderError,
} from './renderer.js';

const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.agentusage';
const ACTION_5H   = 'com.ulanzi.ulanzistudio.agentusage.claude_5h';
const ACTION_7D   = 'com.ulanzi.ulanzistudio.agentusage.claude_7d';
const POLL_INTERVAL_MS = 5 * 60 * 1000;   // 5 分鐘 polling

const $UD = new UlanziApi();
const INSTANCES = new Map();

function log(...args) {
  console.log('[ulanzi-agent-usage]', ...args);
}

function actionFromContext(context) {
  return ($UD.decodeContext(context) || {}).uuid || '';
}

// ── Claude action helpers ──────────────────────────────────────────────────

function metricFromContext(context, settings) {
  if (settings?.metric === '5h' || settings?.metric === '7d') return settings.metric;
  return actionFromContext(context) === ACTION_7D ? '7d' : '5h';
}

function labelFor(metric) {
  return metric === '7d' ? 'Weekly' : '5h';
}

function pushIcon(context, dataUrl) {
  $UD.setBaseDataIcon(context, dataUrl);
}

function applyResult(inst, result) {
  inst.lastResult = result;
  renderForInstance(inst);
}

// ── Claude 渲染 ────────────────────────────────────────────────────────────

/**
 * 顯示 lastGood（官方 API 與 cockpit 都失敗時）。若該視窗的 reset 時間已過，
 * 舊用量已不屬於目前視窗 → 以 0% 呈現並保留 stale 標記，避免出現
 * 「20% / Reset in now」這種過期數值。
 */
function renderStaleClaude(context, label, metric, data) {
  let util  = metric === '7d' ? data.util7d  : data.util5h;
  let reset = metric === '7d' ? data.reset7d : data.reset5h;
  const resetMs = reset ? new Date(reset).getTime() : NaN;
  if (Number.isFinite(resetMs) && resetMs <= Date.now()) {
    util = 0;
    reset = null;
  }
  const stale = data.fetchedAt ? Math.floor(Date.now() / 1000) - data.fetchedAt : null;
  pushIcon(context, renderUsage({ label, util, reset: formatReset(reset), stale }));
}

function renderForInstance(inst) {
  if (inst.provider) {
    renderForProvider(inst);
    return;
  }

  const { context, metric, lastResult } = inst;
  const label = labelFor(metric);

  if (!lastResult) {
    pushIcon(context, renderLoading({ label }));
    return;
  }

  if (lastResult.ok) {
    const data  = lastResult.data;
    const util  = metric === '7d' ? data.util7d  : data.util5h;
    const reset = metric === '7d' ? data.reset7d : data.reset5h;
    const nowSec = Math.floor(Date.now() / 1000);
    const stale = data.fetchedAt ? nowSec - data.fetchedAt : null;

    if (util === null || util === undefined) {
      pushIcon(context, renderStopped({ label, reset: formatReset(reset) }));
      return;
    }
    pushIcon(context, renderUsage({ label, util, reset: formatReset(reset), stale }));
    return;
  }

  if (lastResult.kind === ErrorKind.NO_TOKEN) {
    pushIcon(context, renderNoToken({ label }));
    return;
  }

  if (lastResult.kind === ErrorKind.AUTH) {
    pushIcon(context, renderReauth({ label }));
    return;
  }

  if (lastResult.kind === ErrorKind.RATE_LIMITED) {
    const lastGood = inst.lastGood;
    if (lastGood) {
      renderStaleClaude(context, label, metric, lastGood.data);
    } else {
      pushIcon(context, renderLoading({ label }));
    }
    return;
  }

  const lastGood = inst.lastGood;
  if (lastGood) {
    renderStaleClaude(context, label, metric, lastGood.data);
    return;
  }

  pushIcon(context, renderError({ label, msg: lastResult.message || 'error' }));
}

// ── Provider 渲染 ───────────────────────────────────────────────────────────

function renderForProvider(inst) {
  const { context, providerLabel, lastResult } = inst;
  const providerDef = PROVIDER_DEFS[inst.provider];

  if (providerDef?.serverUsage) {
    if (!lastResult) {
      pushIcon(context, renderLoading({ label: providerLabel }));
      return;
    }
    if (lastResult.ok) {
      const data = lastResult.data;
      pushIcon(context, renderUsage({
        label: providerLabel,
        util: data.util,
        reset: formatReset(data.reset),
        stale: data.staleSec,
        showIcon: false,
      }));
      return;
    }

    // Direct server refresh can fail when the Console cookie is rejected or
    // the dashboard is temporarily unreachable. Keep the last good number and
    // let renderer.renderUsage show its stale marker instead of a false zero.
    if (inst.lastGood?.ok && inst.lastGood.data) {
      const data = inst.lastGood.data;
      const stale = data.fetchedAt
        ? Math.max(0, Math.floor(Date.now() / 1000) - data.fetchedAt)
        : data.staleSec;
      pushIcon(context, renderUsage({
        label: providerLabel,
        util: data.util,
        reset: formatReset(data.reset),
        stale,
        showIcon: false,
      }));
      return;
    }

    pushIcon(context, renderError({ label: providerLabel, msg: lastResult.message || 'no data' }));
    return;
  }

  const label = providerLabel;

  if (!lastResult) {
    pushIcon(context, renderLoading({ label }));
    return;
  }

  if (lastResult.ok) {
    const { util, reset, staleSec } = lastResult.data;
    if (util === null || util === undefined) {
      pushIcon(context, renderStopped({ label, reset: formatReset(reset), showIcon: false }));
      return;
    }
    pushIcon(context, renderUsage({ label, util, reset: formatReset(reset), stale: staleSec, showIcon: false }));
    return;
  }

  if (inst.lastGood?.ok && inst.lastGood.data) {
    const data = inst.lastGood.data;
    const stale = data.updatedAt
      ? Math.max(0, Math.floor(Date.now() / 1000) - data.updatedAt)
      : data.staleSec;
    pushIcon(context, renderUsage({
      label,
      util: data.util,
      reset: formatReset(data.reset),
      stale,
      showIcon: false,
    }));
    return;
  }

  pushIcon(context, renderError({ label, msg: lastResult.message || 'no data' }));
}

// ── Polling ────────────────────────────────────────────────────────────────

async function refresh(inst) {
  if (inst.inflight) return;
  inst.inflight = true;
  try {
    // Claude 直接使用 Claude Code OAuth usage API，不依賴第三方帳號快取。
    const result = await fetchUsage();
    if (result.ok) inst.lastGood = result;
    applyResult(inst, result);
  } catch (e) {
    log('refresh threw', e?.message);
    applyResult(inst, { ok: false, kind: ErrorKind.UNKNOWN, message: e?.message || 'unknown' });
  } finally {
    inst.inflight = false;
  }
}

async function refreshProvider(inst) {
  if (inst.inflight) return;
  inst.inflight = true;
  try {
    const providerDef = PROVIDER_DEFS[inst.provider];
    const data = providerDef?.serverUsage
      ? await readOpenCodeUsage(inst.provider)
      : await readProviderUsage(inst.provider, inst.settings);
    if (data) {
      const result = { ok: true, data };
      inst.lastGood = result;
      applyResult(inst, result);
    } else {
      applyResult(inst, { ok: false, message: 'No provider data' });
      // If we don't have good data yet (e.g. during system boot), retry sooner (15s)
      if (!inst.lastGood && inst.active && !inst.retryTimer) {
        inst.retryTimer = setTimeout(() => {
          inst.retryTimer = null;
          refreshProvider(inst);
        }, 15_000);
      }
    }
  } catch (e) {
    log('provider refresh threw', e?.message);
    applyResult(inst, { ok: false, message: e?.message || 'unknown' });
    if (!inst.lastGood && inst.active && !inst.retryTimer) {
      inst.retryTimer = setTimeout(() => {
        inst.retryTimer = null;
        refreshProvider(inst);
      }, 15_000);
    }
  } finally {
    inst.inflight = false;
  }
}

function startPolling(inst) {
  stopPolling(inst);
  const jitter = Math.floor(Math.random() * 10_000);
  const doRefresh = inst.provider ? () => refreshProvider(inst) : () => refresh(inst);
  inst.startTimer = setTimeout(() => {
    doRefresh();
    inst.timer = setInterval(doRefresh, POLL_INTERVAL_MS);
  }, jitter);
}

function stopPolling(inst) {
  if (inst.startTimer) { clearTimeout(inst.startTimer);  inst.startTimer = null; }
  if (inst.timer)      { clearInterval(inst.timer);      inst.timer = null;      }
  if (inst.retryTimer) { clearTimeout(inst.retryTimer);  inst.retryTimer = null; }
}

// ── Instance 管理 ──────────────────────────────────────────────────────────

function ensureInstance(context, settings) {
  let inst = INSTANCES.get(context);
  const action = actionFromContext(context);
  const provider = PROVIDER_ACTION_MAP[action] || null;

  if (!inst) {
    if (provider) {
      const def = PROVIDER_DEFS[provider];
      inst = {
        context,
        provider,
        providerLabel: def?.label || provider,
        metric: null,
        settings: settings || {},
        lastResult: null,
        lastGood: null,
        inflight: false,
        timer: null,
        startTimer: null,
        retryTimer: null,
        active: true,
      };
      const initial = readInitialProviderState(provider);
      if (initial) inst.lastGood = { ok: true, data: initial };
    } else {
      const metric = metricFromContext(context, settings);
      inst = {
        context,
        provider: null,
        providerLabel: null,
        metric,
        settings: settings || {},
        lastResult: null,
        lastGood: null,
        inflight: false,
        timer: null,
        startTimer: null,
        retryTimer: null,
        active: true,
      };
      const stale = readStaleCache();
      if (stale) inst.lastGood = { ok: true, data: stale };
    }
    INSTANCES.set(context, inst);
    renderForInstance(inst);
    startPolling(inst);
  } else {
    if (!provider) {
      const prevMetric = inst.metric;
      inst.metric   = metricFromContext(context, settings);
      inst.settings = settings || inst.settings;
      if (prevMetric !== inst.metric) renderForInstance(inst);
    } else {
      // Provider 帳號 / 設定切換 → 清除舊資料並立即重拉
      const prevProfile = inst.settings?.profileId || inst.settings?.accountLogin;
      inst.settings = settings || inst.settings;
      const nextProfile = inst.settings?.profileId || inst.settings?.accountLogin;
      if (prevProfile !== nextProfile) {
        inst.lastResult = null;
        inst.lastGood   = null;
        renderForInstance(inst);  // 顯示 loading
        refreshProvider(inst);
      }
    }
  }
  return inst;
}

// ── Ulanzi API 事件 ────────────────────────────────────────────────────────

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => log('connected'));

$UD.onAdd((msg) => {
  log('add', msg.context, msg.param);
  ensureInstance(msg.context, msg.param || {});
});

$UD.onParamFromApp((msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  renderForInstance(inst);
});

$UD.onParamFromPlugin((msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  renderForInstance(inst);
});

$UD.onRun((msg) => {
  const inst = INSTANCES.get(msg.context);
  if (!inst) {
    ensureInstance(msg.context, msg.param || {});
    return;
  }
  log('click → force refresh', msg.context);
  const label = inst.providerLabel || labelFor(inst.metric);
  pushIcon(msg.context, renderLoading({ label }));
  if (inst.provider) {
    refreshProvider(inst);
  } else {
    refresh(inst);
  }
});

$UD.onSetActive((msg) => {
  const inst = INSTANCES.get(msg.context);
  if (!inst) return;
  inst.active = !!msg.active;
  if (inst.active) {
    renderForInstance(inst);
    if (!inst.timer && !inst.startTimer) startPolling(inst);
  } else {
    stopPolling(inst);
  }
});

$UD.onClear((msg) => {
  if (!msg.param) return;
  for (const item of msg.param) {
    const ctx  = item.context;
    const inst = INSTANCES.get(ctx);
    if (inst) {
      stopPolling(inst);
      INSTANCES.delete(ctx);
      log('clear', ctx);
    }
  }
});

$UD.onError((err) => log('socket error', err));
$UD.onClose(() => log('socket closed'));
