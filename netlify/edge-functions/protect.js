export default async (request, context) => {
	const url = new URL(request.url)
	// Allow only truly benign public files if needed; by default protect everything
	const publicBypass = new Set(['/robots.txt', '/favicon.ico'])
	if (publicBypass.has(url.pathname)) {
		return context.next()
	}

	// Static credentials (no env to avoid edge bundling issues)
	const USER = 'croc'
	const PASS = 'cr0c'

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
			if (au === USER && ap === PASS) {
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

