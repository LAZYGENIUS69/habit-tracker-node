/**
 * HTTP test helper for Habit Tracker integration tests.
 * Resolves base URL from environment (APP_URL or APP_HOST + PORT)
 * and uses Node 20's built-in fetch.
 */

const BASE_URL = process.env.APP_URL || (
  'http://' + (process.env.APP_HOST || '127.0.0.1') + ':' + (process.env.PORT || '8080')
);

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json()
    : await res.text();
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    data,
  };
}

function get(path) {
  return request(path, { method: 'GET' });
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path) {
  return request(path, { method: 'DELETE' });
}

module.exports = {
  BASE_URL,
  request,
  get,
  post,
  del,
};
