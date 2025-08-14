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

async function signStorageUrl(storage_path, expiresIn = 3600) {
	// POST /storage/v1/object/sign/{bucket}/{path} { expiresIn }
	const endpoint = `/storage/v1/object/sign/snippets/${encodeURI(storage_path)}`
	const res = await sb(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ expiresIn }),
	})
	const data = await res.json()
	const signed = data?.signedURL || data?.signedUrl || data?.url
	if (!signed) throw new Error('Failed to sign URL')
	const base = SUPABASE_URL.replace(/\/$/, '') + '/storage/v1'
	return base + signed
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
			if (action === 'sign') {
				// Fetch snippet to get storage_path, then sign
				const r = await sb(
					`/rest/v1/song_snippets?id=eq.${encodeURIComponent(
						id
					)}&select=storage_path&limit=1`
				)
				const rows = await r.json()
				const storage_path = rows?.[0]?.storage_path
				if (!storage_path) return json(404, { error: 'Not found' })
				const url = await signStorageUrl(storage_path, 3600)
				return json(200, { url })
			}
			if (action === 'discard') {
				// attempt to delete storage object first (best-effort), then delete row (cascade removes transcript & analysis)
				try {
					const r = await sb(
						`/rest/v1/song_snippets?id=eq.${encodeURIComponent(
							id
						)}&select=storage_path&limit=1`
					)
					const rows = await r.json()
					const storage_path = rows?.[0]?.storage_path
					if (storage_path) {
						await sb(`/storage/v1/object/snippets/${encodeURI(storage_path)}`, {
							method: 'DELETE',
						})
					}
				} catch (_) {}
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

