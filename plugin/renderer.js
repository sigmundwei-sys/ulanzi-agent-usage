const SIZE = 200;
const BG = '#1f1f23';
const TRACK = '#2c2c33';
const TEXT = '#ffffff';
const SHADOW = 'rgba(0,0,0,0.85)';
const MIN_BAR_RATIO = 0.04;

const COLORS = {
  ok:    { fill: '#3ecf6b' },
  warn:  { fill: '#e3b341' },
  high:  { fill: '#e8893c' },
  crit:  { fill: '#e3434c' },
  muted: { fill: '#4a4a52' },
};

function thresholdColor(util) {
  if (util >= 0.95) return COLORS.crit;
  if (util >= 0.85) return COLORS.high;
  if (util >= 0.60) return COLORS.warn;
  return COLORS.ok;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function svgDoc(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${body}</svg>`;
}

function toDataUrl(svg) {
  const b64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

function textWithShadow(text, x, y, fontSize, weight = '700', anchor = 'middle') {
  const t = escapeXml(text);
  return (
    `<text x="${x + 1}" y="${y + 1}" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" text-anchor="${anchor}" fill="${SHADOW}">${t}</text>` +
    `<text x="${x}" y="${y}" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" text-anchor="${anchor}" fill="${TEXT}">${t}</text>`
  );
}

function staleDot(staleSec) {
  if (!staleSec || staleSec < 90) return '';
  return `<circle cx="${SIZE - 16}" cy="16" r="6" fill="#e3b341" stroke="#1f1f23" stroke-width="2"/>`;
}

const CLAUDE_ORANGE = '#d77757';

const CLAUDE_PIXEL_GRID = [
  '..XXXXXXXX..',
  '..XXXXXXXX..',
  '..X.XXXX.X..',
  '..X.XXXX.X..',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  '.X..X..X..X.',
  '.X..X..X..X.',
];

function claudeIcon(centerX, centerY, width) {
  const cols = CLAUDE_PIXEL_GRID[0].length;
  const rows = CLAUDE_PIXEL_GRID.length;
  const cell = width / cols;
  const height = rows * cell;
  const x0 = centerX - width / 2;
  const y0 = centerY - height / 2;
  let rects = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (CLAUDE_PIXEL_GRID[r][c] === 'X') {
        const x = (x0 + c * cell).toFixed(2);
        const y = (y0 + r * cell).toFixed(2);
        const s = (cell + 0.5).toFixed(2);
        rects += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${CLAUDE_ORANGE}"/>`;
      }
    }
  }
  return rects;
}

function topLabelWithIcon(label, y, fontSize) {
  const iconHeight = Math.round(fontSize * 0.75);
  const iconWidth = iconHeight * 1.5;
  const gap = 10;
  const textW = label.length * fontSize * 0.58;
  const groupW = iconWidth + gap + textW;
  const startX = (SIZE - groupW) / 2;
  const iconCx = startX + iconWidth / 2;
  const iconCy = y - fontSize * 0.35;
  const textX = startX + iconWidth + gap;
  return claudeIcon(iconCx, iconCy, iconWidth) + textWithShadow(label, textX, y, fontSize, '700', 'start');
}

export function renderUsage({ label, util, reset, stale, showIcon = true }) {
  const color = thresholdColor(util);
  const fillRatio = Math.max(util, MIN_BAR_RATIO);
  const barW = Math.round(SIZE * fillRatio);
  const pctText = `${Math.round(util * 100)}%`;
  const resetText = reset || '';

  const body = [
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`,
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${TRACK}"/>`,
    `<rect x="0" y="0" width="${barW}" height="${SIZE}" fill="${color.fill}"/>`,
    showIcon ? topLabelWithIcon(label, 50, 38) : textWithShadow(label, SIZE / 2, 50, 38),
    textWithShadow(pctText, SIZE / 2, 122, 52),
    resetText ? textWithShadow(`Reset in ${resetText}`, SIZE / 2, 178, 28, '600') : '',
    staleDot(stale),
  ].join('');

  return toDataUrl(svgDoc(body));
}

function formatCost(cost) {
  const n = Number(cost);
  if (!Number.isFinite(n)) return '$0.00';
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}

function formatTokens(tokens) {
  const n = Math.max(0, Number(tokens) || 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function renderLocalUsage({ label, cost, tokens, windowLabel }) {
  const body = [
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`,
    `<rect x="0" y="0" width="${SIZE}" height="8" fill="${COLORS.ok.fill}"/>`,
    textWithShadow(label, SIZE / 2, 45, 32),
    textWithShadow(formatCost(cost), SIZE / 2, 112, 48),
    textWithShadow(`${formatTokens(tokens)} tok`, SIZE / 2, 151, 26, '600'),
    textWithShadow(windowLabel || 'local usage', SIZE / 2, 184, 22, '600'),
  ].join('');
  return toDataUrl(svgDoc(body));
}

export function renderStopped({ label, reset, showIcon = true }) {
  const body = [
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${COLORS.crit.fill}"/>`,
    showIcon ? topLabelWithIcon(label, 50, 38) : textWithShadow(label, SIZE / 2, 50, 38),
    textWithShadow('100%', SIZE / 2, 118, 52),
    textWithShadow('stopped', SIZE / 2, 152, 22, '600'),
    reset ? textWithShadow(`Reset in ${reset}`, SIZE / 2, 184, 26, '600') : '',
  ].join('');
  return toDataUrl(svgDoc(body));
}

function renderNeutral({ icon, line1, line2, accent }) {
  const accentColor = accent || COLORS.muted.fill;
  const body = [
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`,
    icon ? `<text x="${SIZE / 2}" y="92" font-size="68" text-anchor="middle" fill="${accentColor}">${escapeXml(icon)}</text>` : '',
    line1 ? textWithShadow(line1, SIZE / 2, 140, 28, '700') : '',
    line2 ? textWithShadow(line2, SIZE / 2, 174, 22, '600') : '',
  ].join('');
  return toDataUrl(svgDoc(body));
}

export function renderNoToken({ label }) {
  return renderNeutral({ icon: '\u{1F512}', line1: label, line2: 'Login Claude' });
}

export function renderReauth({ label }) {
  return renderNeutral({ icon: '↻', line1: label, line2: 'Reauth', accent: '#e3b341' });
}

export function renderKeychainBlocked({ label }) {
  return renderNeutral({ icon: '\u{1F511}', line1: label, line2: 'Allow keychain' });
}

export function renderLoading({ label }) {
  return renderNeutral({ icon: '…', line1: label, line2: '' });
}

export function renderError({ label, msg }) {
  return renderNeutral({ icon: '⚠', line1: label, line2: msg || 'error', accent: '#e3b341' });
}
