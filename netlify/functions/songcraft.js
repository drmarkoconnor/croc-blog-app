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

		const isJson =
			(event.headers?.['content-type'] || '').includes('application/json') ||
			(event.headers?.['Content-Type'] || '').includes('application/json')
		const body = isJson && event.body ? JSON.parse(event.body) : {}
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

		// Upload recorded audio blob to Supabase Storage
		if (method === 'POST' && action === 'uploadAudio') {
			const songId = event.queryStringParameters?.songId || body.song_id
			if (!songId) return { statusCode: 400, body: 'Missing songId' }
			// Verify ownership of song
			const g = await sb(
				`/rest/v1/songs?id=eq.${encodeURIComponent(
					songId
				)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`
			)
			const rows = await g.json()
			if (!rows?.length) return { statusCode: 403, body: 'Not allowed' }

			const contentType =
				event.headers?.['content-type'] || event.headers?.['Content-Type'] ||
				'application/octet-stream'
			const buf = event.body
				? event.isBase64Encoded
					? Buffer.from(event.body, 'base64')
					: Buffer.from(event.body)
				: Buffer.from('')

			const bucket = process.env.SONGCRAFT_AUDIO_BUCKET || 'songcraft-audio'
			// Try to create bucket (ignore if exists)
			try {
				await fetch(SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/bucket', {
					method: 'POST',
					headers: {
						apikey: SERVICE_KEY,
						Authorization: `Bearer ${SERVICE_KEY}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ name: bucket, public: true }),
				})
			} catch (e) {}

			const fileName = `${Date.now()}.webm`
			const objectPath = `song/${ownerId}/${songId}/${fileName}`
			const up = await fetch(
				SUPABASE_URL.replace(/\/$/, '') +
					`/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(
						objectPath
					)}`,
				{
					method: 'POST',
					headers: {
						apikey: SERVICE_KEY,
						Authorization: `Bearer ${SERVICE_KEY}`,
						'Content-Type': contentType,
						'x-upsert': 'true',
					},
					body: buf,
				}
			)
			if (!up.ok) {
				const t = await up.text().catch(() => '')
				return { statusCode: 500, body: `Upload failed: ${up.status} ${t}` }
			}

			const publicUrl =
				SUPABASE_URL.replace(/\/$/, '') +
				`/storage/v1/object/public/${encodeURIComponent(
					bucket
				)}/${objectPath}`
			return json({ ok: true, url: publicUrl, path: objectPath })
		}

		// List uploaded audio takes for a song from Supabase Storage
		if (method === 'GET' && action === 'listAudio') {
			const songId = event.queryStringParameters?.songId
			if (!songId) return { statusCode: 400, body: 'Missing songId' }
			// Verify ownership
			const g = await sb(
				`/rest/v1/songs?id=eq.${encodeURIComponent(
					songId
				)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`
			)
			const rows = await g.json()
			if (!rows?.length) return { statusCode: 403, body: 'Not allowed' }
			const bucket = process.env.SONGCRAFT_AUDIO_BUCKET || 'songcraft-audio'
			const prefix = `song/${ownerId}/${songId}/`
			const listRes = await fetch(
				SUPABASE_URL.replace(/\/$/, '') +
					`/storage/v1/object/list/${encodeURIComponent(bucket)}`,
				{
					method: 'POST',
					headers: {
						apikey: SERVICE_KEY,
						Authorization: `Bearer ${SERVICE_KEY}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ prefix, limit: 100, search: '' }),
				}
			)
			if (!listRes.ok) {
				const t = await listRes.text().catch(() => '')
				return { statusCode: 500, body: `List failed: ${listRes.status} ${t}` }
			}
			const items = (await listRes.json()) || []
			const out = items
				.filter((it) => it && it.name && !it.name.endsWith('/'))
				.map((it) => {
					const path = prefix + it.name
					const url =
						SUPABASE_URL.replace(/\/$/, '') +
						`/storage/v1/object/public/${encodeURIComponent(bucket)}/${path}`
					return {
						path,
						url,
						name: it.name,
						size: it.metadata?.size ?? it.size ?? null,
						created_at: it.created_at || null,
					}
				})
			return json({ items: out })
		}

		// Delete a specific uploaded audio take
		if (method === 'POST' && action === 'deleteAudio') {
			const { song_id: songId, path } = body
			if (!songId || !path) return { statusCode: 400, body: 'Missing songId or path' }
			// Verify ownership and path scope
			const prefix = `song/${ownerId}/${songId}/`
			if (!path.startsWith(prefix)) return { statusCode: 403, body: 'Not allowed' }
			const g = await sb(
				`/rest/v1/songs?id=eq.${encodeURIComponent(
					songId
				)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`
			)
			const rows = await g.json()
			if (!rows?.length) return { statusCode: 403, body: 'Not allowed' }
			const bucket = process.env.SONGCRAFT_AUDIO_BUCKET || 'songcraft-audio'
			const del = await fetch(
				SUPABASE_URL.replace(/\/$/, '') +
					`/storage/v1/object/${encodeURIComponent(bucket)}/${path}`,
				{
					method: 'DELETE',
					headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
				}
			)
			if (!del.ok) {
				const t = await del.text().catch(() => '')
				return { statusCode: 500, body: `Delete failed: ${del.status} ${t}` }
			}
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

