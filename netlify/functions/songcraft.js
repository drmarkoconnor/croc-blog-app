const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY)
	throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

async function sb(path, opts = {}) {
	const res = await fetch(SUPABASE_URL.replace(/\/$/, '') + path, {
		...opts,
		headers: {
			apikey: SERVICE_KEY,
			Authorization: `Bearer ${SERVICE_KEY}`,
			'Content-Type': 'application/json',
			...(opts.headers || {}),
		},
	})
	if (!res.ok) {
		let detail = ''
		try {
			detail = await res.text()
		} catch {}
		throw new Error(`Supabase ${res.status} ${detail}`)
	}
	return res
}

function uuidV5FromString(
	name,
	namespace = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'
) {
	// RFC 4122 v5-like UUID from string using SHA-1
	const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
	const hash = crypto.createHash('sha1')
	hash.update(ns)
	hash.update(name)
	const bytes = hash.digest().slice(0, 16)
	bytes[6] = (bytes[6] & 0x0f) | 0x50 // set version 5
	bytes[8] = (bytes[8] & 0x3f) | 0x80 // set variant RFC4122
	const hex = bytes.toString('hex')
	return [
		hex.substring(0, 8),
		hex.substring(8, 12),
		hex.substring(12, 16),
		hex.substring(16, 20),
		hex.substring(20),
	].join('-')
}

exports.handler = async (event) => {
	try {
		// Single-user mode: stable owner id
		const ownerId =
			process.env.SONGCRAFT_OWNER_ID ||
			uuidV5FromString(
				process.env.URL || process.env.DEPLOY_URL || 'single-user'
			)

		const method = event.httpMethod
		if (method === 'OPTIONS') {
			return { statusCode: 200, headers: cors(), body: '' }
		}

		const body = event.body ? JSON.parse(event.body) : {}
		const action =
			body.action || event.queryStringParameters?.action || 'upsert'

		if (method === 'POST' && action === 'upsert') {
			const { id, title, key, bpm, body_chordpro } = body
			if (id) {
				const r = await sb(
					`/rest/v1/songs?id=eq.${encodeURIComponent(
						id
					)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
					{
						method: 'PATCH',
						headers: { Prefer: 'return=representation' },
						body: JSON.stringify({
							title,
							key,
							bpm,
							body_chordpro,
							owner_id: ownerId,
							updated_at: new Date().toISOString(),
						}),
					}
				)
				const rows = await r.json()
				return json({ id: rows?.[0]?.id || id })
			} else {
				const r = await sb('/rest/v1/songs', {
					method: 'POST',
					headers: { Prefer: 'return=representation' },
					body: JSON.stringify([
						{ title, key, bpm, body_chordpro, owner_id: ownerId },
					]),
				})
				const row = (await r.json())?.[0]
				return json({ id: row.id })
			}
		}

		if (method === 'POST' && action === 'saveVersion') {
			const { song_id, label, body_chordpro } = body
			if (!song_id) return { statusCode: 400, body: 'Missing song_id' }
			// Guard ownership
			const g = await sb(
				`/rest/v1/songs?id=eq.${encodeURIComponent(
					song_id
				)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`
			)
			const rows = await g.json()
			if (!rows?.length) return { statusCode: 403, body: 'Not allowed' }
			await sb('/rest/v1/song_versions', {
				method: 'POST',
				headers: { Prefer: 'return=minimal' },
				body: JSON.stringify([{ song_id, label, body_chordpro }]),
			})
			return json({ ok: true })
		}

		if (method === 'GET' && action === 'list') {
			const q = new URL(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/songs')
			q.searchParams.set('select', 'id,title,key,bpm,updated_at')
			q.searchParams.set('owner_id', `eq.${ownerId}`)
			q.searchParams.set('order', 'updated_at.desc')
			const r = await fetch(q, {
				headers: {
					apikey: SERVICE_KEY,
					Authorization: `Bearer ${SERVICE_KEY}`,
				},
			})
			if (!r.ok) throw new Error(`Supabase ${r.status}`)
			const data = await r.json()
			return json({ songs: data })
		}

		if (method === 'GET' && action === 'get') {
			const id = event.queryStringParameters?.id
			if (!id) return { statusCode: 400, body: 'Missing id' }
			const q = new URL(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/songs')
			q.searchParams.set('select', 'id,title,key,bpm,body_chordpro,updated_at')
			q.searchParams.set('owner_id', `eq.${ownerId}`)
			q.searchParams.set('id', `eq.${id}`)
			q.searchParams.set('limit', '1')
			const r = await fetch(q, {
				headers: {
					apikey: SERVICE_KEY,
					Authorization: `Bearer ${SERVICE_KEY}`,
				},
			})
			if (!r.ok) throw new Error(`Supabase ${r.status}`)
			const rows = await r.json()
			return json({ song: rows?.[0] })
		}

		if (method === 'POST' && action === 'delete') {
			const { id } = body
			if (!id) return { statusCode: 400, body: 'Missing id' }
			await sb(
				`/rest/v1/songs?id=eq.${encodeURIComponent(
					id
				)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
				{ method: 'DELETE' }
			)
			return json({ ok: true })
		}

		return { statusCode: 400, body: 'Bad request' }
	} catch (e) {
		console.error('songcraft error', e)
		return { statusCode: 500, body: 'Server error' }
	}
}

function cors() {
	return {
		'access-control-allow-origin': '*',
		'access-control-allow-headers': 'Content-Type, x-visitor-id',
		'access-control-allow-methods': 'GET,POST,OPTIONS',
	}
}
function json(obj) {
	return {
		statusCode: 200,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(obj),
	}
}

