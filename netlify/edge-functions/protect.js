export default async (request, context) => {
	// Prefer Edge runtime env, fallback to Node env for local dev
	const ce = context?.env || {}
	const SITE_BASIC_AUTH_USER =
		ce.SITE_BASIC_AUTH_USER ??
		(typeof process !== 'undefined' && process?.env?.SITE_BASIC_AUTH_USER)
	const SITE_BASIC_AUTH_PASS =
		ce.SITE_BASIC_AUTH_PASS ??
		(typeof process !== 'undefined' && process?.env?.SITE_BASIC_AUTH_PASS)
	if (!SITE_BASIC_AUTH_USER || !SITE_BASIC_AUTH_PASS) {
		return new Response(
			'Server misconfigured: missing SITE_BASIC_AUTH_USER/PASS',
			{ status: 500 }
		)
	}

	const bypass = ['/robots.txt', '/favicon.ico']
	const url = new URL(request.url)
	// Allow Netlify functions and static assets to flow; browser will re-use auth automatically after first success
	if (
		url.pathname.startsWith('/.netlify/functions/') ||
		url.pathname.startsWith('/assets/') ||
		bypass.includes(url.pathname)
	) {
		return context.next()
	}

	const auth = request.headers.get('authorization') || ''
	if (auth.startsWith('Basic ')) {
		try {
			const b64 = auth.slice(6)
			const decoded =
				typeof atob === 'function'
					? atob(b64)
					: typeof Buffer !== 'undefined'
					? Buffer.from(b64, 'base64').toString('utf-8')
					: ''
			const sep = decoded.indexOf(':')
			const au = sep >= 0 ? decoded.slice(0, sep) : decoded
			const ap = sep >= 0 ? decoded.slice(sep + 1) : ''
			if (au === SITE_BASIC_AUTH_USER && ap === SITE_BASIC_AUTH_PASS) {
				return context.next()
			}
		} catch (_) {
			// fall through to 401
		}
	}
	return new Response('Unauthorized', {
		status: 401,
		headers: { 'WWW-Authenticate': 'Basic realm="Site"' },
	})
}

