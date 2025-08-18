// Rewards persistence via Supabase Storage (single-user mode)
// Stores JSON at storage bucket `rewards-kv` path rewards/{ownerId}.json

const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function cors() {
	return {
		'access-control-allow-origin': '*',
		'access-control-allow-headers': 'Content-Type',
		'access-control-allow-methods': 'GET,POST,OPTIONS',
	}
}
function json(statusCode, body) {
	return {
		statusCode,
		headers: { 'content-type': 'application/json', ...cors() },
		body: JSON.stringify(body),
	}
}

function uuidV5FromString(
	name,
	namespace = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'
) {
	const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
	const hash = crypto.createHash('sha1')
	hash.update(ns)
	hash.update(name)
	const bytes = hash.digest().slice(0, 16)
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	const hex = bytes.toString('hex')
	return [
		hex.substring(0, 8),
		hex.substring(8, 12),
		hex.substring(12, 16),
		hex.substring(16, 20),
		hex.substring(20),
	].join('-')
}

const DEFAULT_STATE = {
	stars: 0,
	suns: 0,
	history: [],
	visitedPages: {},
}

async function ensureBucket(name) {
	try {
		await fetch(SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/bucket', {
			method: 'POST',
			headers: {
				apikey: SERVICE_KEY,
				Authorization: `Bearer ${SERVICE_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name, public: true }),
		})
	} catch (_) {}
}

async function getState(ownerId, bucket) {
	// Try fetch object; if 404, return default
	const path = `rewards/${ownerId}.json`
	const url =
		SUPABASE_URL.replace(/\/$/, '') +
		`/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(
			path
		)}`
	const r = await fetch(url, {
		headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
	})
	if (r.status === 404) return { ...DEFAULT_STATE }
	if (!r.ok) throw new Error(`Supabase ${r.status}`)
	try {
		return await r.json()
	} catch (_) {
		return { ...DEFAULT_STATE }
	}
}

async function putState(ownerId, bucket, state) {
	const path = `rewards/${ownerId}.json`
	const url =
		SUPABASE_URL.replace(/\/$/, '') +
		`/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(
			path
		)}`
	const up = await fetch(url, {
		method: 'POST',
		headers: {
			apikey: SERVICE_KEY,
			Authorization: `Bearer ${SERVICE_KEY}`,
			'Content-Type': 'application/json',
			'x-upsert': 'true',
		},
		body: JSON.stringify(state),
	})
	if (!up.ok) {
		const t = await up.text().catch(() => '')
		throw new Error(`Supabase put ${up.status} ${t}`)
	}
	return true
}

function pushHistory(state, type, amount, note, page) {
	state.history = Array.isArray(state.history) ? state.history : []
	state.history.unshift({
		ts: Date.now(),
		type,
		amount,
		note,
		page,
	})
	state.history = state.history.slice(0, 500)
}
function rollup(state) {
	while ((state.stars || 0) >= 100) {
		state.stars -= 100
		state.suns = (state.suns || 0) + 1
		pushHistory(state, 'sun', 0, 'You earned a SUN! ⭐️×100 → ☀️')
	}
}

exports.handler = async (event) => {
	try {
		if (!SUPABASE_URL || !SERVICE_KEY)
			return json(500, { error: 'Missing Supabase env' })

		const ownerId =
			process.env.SONGCRAFT_OWNER_ID ||
			uuidV5FromString(
				process.env.URL || process.env.DEPLOY_URL || 'single-user'
			)

		const bucket = process.env.REWARDS_BUCKET || 'rewards-kv'
		await ensureBucket(bucket)

		if (event.httpMethod === 'OPTIONS') {
			return { statusCode: 200, headers: cors(), body: '' }
		}

		if (event.httpMethod === 'GET') {
			const state = await getState(ownerId, bucket)
			return json(200, state)
		}

		if (event.httpMethod === 'POST') {
			const isJson =
				(event.headers?.['content-type'] || '').includes('application/json') ||
				(event.headers?.['Content-Type'] || '').includes('application/json')
			const body = isJson && event.body ? JSON.parse(event.body) : {}
			const action = body.action || 'award'
			const page = body.page || event.headers?.Referer || ''

			const state = await getState(ownerId, bucket)

			if (action === 'visit') {
				const path = body.pathname || '/'
				state.visitedPages = state.visitedPages || {}
				if (!state.visitedPages[path]) {
					state.visitedPages[path] = Date.now()
					state.stars = (state.stars || 0) + 1
					pushHistory(state, 'page_visit', 1, `First visit: ${path}`, path)
					rollup(state)
				}
				await putState(ownerId, bucket, state)
				return json(200, state)
			}

			if (action === 'award') {
				const amount = Number(body.amount || 0) || 0
				const type = String(body.type || 'award')
				const note = body.note || ''
				if (amount > 0) {
					state.stars = (state.stars || 0) + amount
					pushHistory(state, type, amount, note, page)
					rollup(state)
				}
				await putState(ownerId, bucket, state)
				return json(200, state)
			}

			if (action === 'reset') {
				const s = { ...DEFAULT_STATE }
				await putState(ownerId, bucket, s)
				return json(200, s)
			}

			return json(400, { error: 'Bad action' })
		}

		return json(405, { error: 'Method not allowed' })
	} catch (e) {
		console.error('rewards error', e)
		return json(500, { error: 'Server error' })
	}
}

