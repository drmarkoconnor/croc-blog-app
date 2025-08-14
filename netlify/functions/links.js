// Netlify Function: /api/links  GET (list), POST (add), DELETE (delete?id=)
// Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

function normalizeUrl(u) {
  try {
    const url = new URL(u)
    return url.toString()
  } catch (_) {
    return u
  }
}

function guessFavicon(u) {
  try {
    const url = new URL(u)
    return `${url.origin}/favicon.ico`
  } catch (_) {
    return null
  }
}

async function sb(path, opts = {}) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(base.replace(/\/$/, '') + path, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}`)
  return res
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const r = await sb('/rest/v1/links?select=*&order=created_at.desc')
      const data = await r.json()
      return { statusCode: 200, body: JSON.stringify(data) }
    }
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}')
      const url = normalizeUrl(body.url || '')
      if (!url) return { statusCode: 400, body: 'Missing url' }
      const title = body.title || null
      const favicon_url = body.favicon_url || guessFavicon(url)
      const user_id = body.user_id || null // optional until auth is wired
      const payload = [{ url, title, favicon_url, user_id }]
      const r = await sb('/rest/v1/links', { method: 'POST', body: JSON.stringify(payload) })
      const data = await r.json()
      return { statusCode: 200, body: JSON.stringify(data[0] || {}) }
    }
    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id
      if (!id) return { statusCode: 400, body: 'Missing id' }
      await sb(`/rest/v1/links?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
      return { statusCode: 204, body: '' }
    }
    return { statusCode: 405, body: 'Method Not Allowed' }
  } catch (e) {
    return { statusCode: 500, body: `links error: ${e.message}` }
  }
}
