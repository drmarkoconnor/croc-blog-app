// Netlify Function: /api/links  GET (list), POST (add), DELETE (delete?id=)
// Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// Improved: picks high-res site image (manifest/icons, OG/Twitter, apple-touch) with fallbacks.

function normalizeUrl(u) {
	try {
		const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`)
		return url.toString()
	} catch (_) {
		return u
	}
}

function absoluteUrl(origin, href) {
	try {
		return new URL(href, origin).toString()
	} catch {
		return href
	}
}

function guessHighResFavicon(origin) {
	// Google S2 high-res PNG fallback
	return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(
		origin
	)}&sz=256`
}

async function sb(path, opts = {}) {
	const base = process.env.SUPABASE_URL
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY
	if (!base || !key)
		throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
	const res = await fetch(base.replace(/\/$/, '') + path, {
		...opts,
		headers: {
			apikey: key,
			Authorization: `Bearer ${key}`,
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

function withTimeout(ms, signal) {
	const ctrl = new AbortController()
	const timeout = setTimeout(() => ctrl.abort(), ms)
	const composite = signal ? new AbortController() : ctrl
	if (signal) {
		signal.addEventListener('abort', () => composite.abort(), { once: true })
		setTimeout(() => composite.abort(), ms)
	}
	return composite
}

async function fetchText(url) {
	try {
		const controller = new AbortController()
		const t = setTimeout(() => controller.abort(), 3500)
		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Netlify Function; +https://www.netlify.com/)',
				Accept:
					'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			},
			signal: controller.signal,
		})
		clearTimeout(t)
		if (!res.ok) return null
		return await res.text()
	} catch {
		return null
	}
}

async function fetchJson(url) {
	try {
		const controller = new AbortController()
		const t = setTimeout(() => controller.abort(), 3500)
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
			signal: controller.signal,
		})
		clearTimeout(t)
		if (!res.ok) return null
		return await res.json()
	} catch {
		return null
	}
}

function pickLargestIconFromManifest(icons, origin) {
	if (!Array.isArray(icons) || !icons.length) return null
	let best = null
	let bestArea = 0
	for (const icon of icons) {
		const sizes = String(icon.sizes || '').split(/\s+/)
		for (const s of sizes) {
			const m = /(\d+)x(\d+)/i.exec(s)
			if (!m) continue
			const area = parseInt(m[1], 10) * parseInt(m[2], 10)
			if (area > bestArea) {
				bestArea = area
				best = absoluteUrl(origin, icon.src)
			}
		}
	}
	// No sizes info? fall back to first src
	if (!best && icons[0]?.src) best = absoluteUrl(origin, icons[0].src)
	return best
}

function extractFromHtml(html, origin) {
	const find = (re) => {
		const m = re.exec(html)
		return m ? absoluteUrl(origin, m[1]) : null
	}
	// Prefer apple-touch-icon (often 180+), then og:image/twitter:image, then rel=icon with sizes
	let url =
		find(
			/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i
		) ||
		find(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
		find(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
	if (url) return url

	// rel=icon with sizes, choose largest
	const linkMatches = [
		...html.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi),
	]
	let best = null
	let bestArea = 0
	for (const tag of linkMatches) {
		const hrefM = /href=["']([^"']+)["']/i.exec(tag[0])
		if (!hrefM) continue
		const sizesM = /sizes=["'](\d+)x(\d+)["']/i.exec(tag[0])
		if (sizesM) {
			const area = parseInt(sizesM[1], 10) * parseInt(sizesM[2], 10)
			if (area > bestArea) {
				bestArea = area
				best = absoluteUrl(origin, hrefM[1])
			}
		} else if (!best) {
			best = absoluteUrl(origin, hrefM[1])
		}
	}
	return best
}

async function getBestSiteImage(inputUrl) {
	const url = new URL(inputUrl)
	const origin = url.origin

	// 1) Try site manifest icons
	const manifestPaths = [
		'/site.webmanifest',
		'/manifest.json',
		'/manifest.webmanifest',
	]
	for (const p of manifestPaths) {
		const data = await fetchJson(origin + p)
		if (data && data.icons) {
			const best = pickLargestIconFromManifest(data.icons, origin)
			if (best) return best
		}
	}

	// 2) Try HTML meta/link tags
	const html = await fetchText(url.toString())
	if (html) {
		const best = extractFromHtml(html, origin)
		if (best) return best
	}

	// 3) High-res favicon service
	return guessHighResFavicon(origin)
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
			const favicon_url = body.favicon_url || (await getBestSiteImage(url))
			const user_id = body.user_id || null // optional until auth is wired
			const payload = [{ url, title, favicon_url, user_id }]
			const r = await sb('/rest/v1/links', {
				method: 'POST',
				headers: { Prefer: 'return=representation' },
				body: JSON.stringify(payload),
			})
			const data = await r.json()
			return { statusCode: 200, body: JSON.stringify(data[0] || {}) }
		}
		if (event.httpMethod === 'DELETE') {
			const id = event.queryStringParameters && event.queryStringParameters.id
			if (!id) return { statusCode: 400, body: 'Missing id' }
			await sb(`/rest/v1/links?id=eq.${encodeURIComponent(id)}`, {
				method: 'DELETE',
			})
			return { statusCode: 204, body: '' }
		}
		return { statusCode: 405, body: 'Method Not Allowed' }
	} catch (e) {
		return { statusCode: 500, body: `links error: ${e.message}` }
	}
}

