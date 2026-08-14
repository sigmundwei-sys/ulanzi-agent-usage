import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 8_000;

export function requestJson(url, {
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      finish({ status: 0, body: null, headers: {}, error: 'invalid URL' });
      return;
    }

    const payload = body == null ? null : JSON.stringify(body);
    const requestHeaders = {
      Accept: 'application/json',
      'User-Agent': 'ulanzi-agent-usage',
      ...headers,
    };
    if (payload !== null) {
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: requestHeaders,
      timeout: timeoutMs,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let value = null;
        try { value = JSON.parse(text); } catch {}
        finish({ status: res.statusCode || 0, body: value, headers: res.headers });
      });
    });
    req.on('error', (error) => finish({ status: 0, body: null, headers: {}, error: error.message }));
    req.on('timeout', () => {
      req.destroy();
      finish({ status: 0, body: null, headers: {}, error: 'request timed out' });
    });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

