const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}

function validIsoDate(value) {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, { allow: 'GET' });
  }

  if (!env.GAS_API_URL) {
    return json({ ok: false, error: 'api_not_configured' }, 503);
  }

  const incoming = new URL(request.url);
  const from = incoming.searchParams.get('from') || '';
  const to = incoming.searchParams.get('to') || '';
  const offsetRaw = incoming.searchParams.get('offset') || '0';
  const limitRaw = incoming.searchParams.get('limit') || '50';
  const offset = Number(offsetRaw);
  const limit = Number(limitRaw);

  if (Boolean(from) !== Boolean(to) || (from && (!validIsoDate(from) || !validIsoDate(to) || from > to))) {
    return json({ ok: false, error: 'invalid_date_range' }, 400);
  }
  if (!/^\d+$/.test(offsetRaw) || !Number.isSafeInteger(offset) || offset > 1000000) {
    return json({ ok: false, error: 'invalid_offset' }, 400);
  }
  if (!/^\d+$/.test(limitRaw) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return json({ ok: false, error: 'invalid_limit' }, 400);
  }

  let upstream;
  try {
    upstream = new URL(env.GAS_API_URL);
    if (upstream.protocol !== 'https:') throw new Error('https_required');
  } catch {
    return json({ ok: false, error: 'api_not_configured' }, 503);
  }

  if (from) {
    upstream.searchParams.set('from', from);
    upstream.searchParams.set('to', to);
  }
  upstream.searchParams.set('offset', String(offset));
  upstream.searchParams.set('limit', String(limit));

  try {
    const response = await fetch(upstream, { headers: { accept: 'application/json' }, redirect: 'follow' });
    if (!response.ok) return json({ ok: false, error: 'upstream_unavailable' }, 502);
    const payload = await response.json();
    if (payload?.ok !== true || !Array.isArray(payload.transactions)) {
      return json({ ok: false, error: 'upstream_invalid_response' }, 502);
    }
    return json(payload, 200, { 'cache-control': 'public, max-age=30, s-maxage=60' });
  } catch {
    return json({ ok: false, error: 'upstream_unavailable' }, 502);
  }
}
