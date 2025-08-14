// Netlify Function: /api/ideas
// GET: list recent snippets with transcript and analysis
// POST { id, action: 'save' | 'discard' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function json(statusCode, body) {
	return {
		statusCode,
		body: JSON.stringify(body),
		headers: { 'Content-Type': 'application/json' },
	}
}

async function sb(path, opts = {}) {
	if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing Supabase env')
	const res = await fetch(SUPABASE_URL.replace(/\/$/, '') + path, {
		...opts,
		headers: {
			apikey: SERVICE_KEY,
			Authorization: `Bearer ${SERVICE_KEY}`,
			...(opts.headers || {}),
		},
	})
	if (!res.ok) throw new Error(`Supabase ${res.status} ${await res.text()}`)
	return res
}

exports.handler = async (event) => {
	try {
		if (event.httpMethod === 'GET') {
			const r = await sb(
				`/rest/v1/song_snippets?select=id,title,storage_path,created_at,is_saved,transcripts(id,text,created_at,transcript_analyses(id,summary,todos,rhymes,genres,chord_progressions,inspirations))&order=created_at.desc&limit=100`
			)
			const data = await r.json()
			return json(200, data)
		}
		if (event.httpMethod === 'POST') {
			const body = JSON.parse(event.body || '{}')
			const id = body.id
			const action = body.action
			if (!id || !action) return json(400, { error: 'Missing id or action' })
			if (action === 'save') {
				await sb(`/rest/v1/song_snippets?id=eq.${encodeURIComponent(id)}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ is_saved: true }),
				})
				return json(200, { ok: true })
			}
			if (action === 'discard') {
				// delete cascade will remove transcript & analysis
				await sb(`/rest/v1/song_snippets?id=eq.${encodeURIComponent(id)}`, {
					method: 'DELETE',
				})
				return json(200, { ok: true })
			}
			return json(400, { error: 'Invalid action' })
		}
		return { statusCode: 405, body: 'Method Not Allowed' }
	} catch (e) {
		return json(500, { error: String(e.message || e) })
	}
}

