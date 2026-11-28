// Minimal JSON-over-HTTP helper built on Node built-ins only.
// The Mini App runtime must not depend on a third-party HTTP client.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * @param {string} url
 * @param {{ method?: string, body?: unknown, headers?: Record<string,string>, timeoutMs?: number, signal?: AbortSignal }} options
 */
export function requestJson(url, options = {}) {
  const { method = 'GET', body, headers = {}, timeoutMs = 120000, signal } = options;
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(new Error(`invalid_url:${url}`));
      return;
    }
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const payload =
      body === undefined
        ? undefined
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');

    const request = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          accept: 'application/json',
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': String(payload.length) }
            : {}),
          ...headers,
        },
        signal,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('response_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const contentType = String(response.headers['content-type'] || '');
          let parsed = null;
          if (contentType.includes('application/json')) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
          }
          if ((response.statusCode || 500) >= 400) {
            const error = new Error(`http_status_${response.statusCode}`);
            error.statusCode = response.statusCode;
            error.body = raw.slice(0, 2000);
            reject(error);
            return;
          }
          resolve({ statusCode: response.statusCode || 200, body: parsed, raw, headers: response.headers });
        });
      },
    );

    request.setTimeout(timeoutMs, () => request.destroy(new Error('request_timeout')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}
