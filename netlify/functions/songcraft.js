const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

function getClient() {
	const url = process.env.SUPABASE_URL
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY
	if (!url || !key) throw new Error('Missing Supabase env')
	return createClient(url, key)
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
		const sb = getClient()
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
				const { data, error } = await sb
					.from('songs')
					.update({
						title,
						key,
						bpm,
						body_chordpro,
						owner_id: ownerId,
						updated_at: new Date().toISOString(),
					})
					.eq('id', id)
					.eq('owner_id', ownerId)
					.select('id')
					.single()
				if (error) throw error
				return json({ id: data.id })
			} else {
				const { data, error } = await sb
					.from('songs')
					.insert({ title, key, bpm, body_chordpro, owner_id: ownerId })
					.select('id')
					.single()
				if (error) throw error
				return json({ id: data.id })
			}
		}

		if (method === 'POST' && action === 'saveVersion') {
			const { song_id, label, body_chordpro } = body
			if (!song_id) return { statusCode: 400, body: 'Missing song_id' }
			// Guard ownership by visitor
			const { data: song, error: se } = await sb
				.from('songs')
				.select('id')
				.eq('id', song_id)
				.eq('owner_id', ownerId)
				.single()
			if (se) return { statusCode: 403, body: 'Not allowed' }
			const { error } = await sb
				.from('song_versions')
				.insert({ song_id, label, body_chordpro })
			if (error) throw error
			return json({ ok: true })
		}

		if (method === 'GET' && action === 'list') {
			const { data, error } = await sb
				.from('songs')
				.select('id, title, key, bpm, updated_at')
				.eq('owner_id', ownerId)
				.order('updated_at', { ascending: false })
			if (error) throw error
			return json({ songs: data })
		}

		if (method === 'GET' && action === 'get') {
			const id = event.queryStringParameters?.id
			if (!id) return { statusCode: 400, body: 'Missing id' }
			const { data, error } = await sb
				.from('songs')
				.select('id, title, key, bpm, body_chordpro, updated_at')
				.eq('owner_id', ownerId)
				.eq('id', id)
				.single()
			if (error) throw error
			return json({ song: data })
		}

		if (method === 'POST' && action === 'delete') {
			const { id } = body
			if (!id) return { statusCode: 400, body: 'Missing id' }
			// Guard ownership
			const { error } = await sb
				.from('songs')
				.delete()
				.eq('owner_id', ownerId)
				.eq('id', id)
			if (error) throw error
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

