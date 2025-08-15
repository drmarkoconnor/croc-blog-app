export default async (request, context) => {
	// Static credentials
	const expected = 'croc:cr0c'

	const auth = request.headers.get('authorization') || ''
	if (auth.startsWith('Basic ')) {
		let decoded = ''
		const b64 = auth.slice(6)
		try {
			decoded = typeof atob === 'function' ? atob(b64) : ''
		} catch (_) {
			try {
				decoded = typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf-8') : ''
			} catch (_) {
				decoded = ''
			}
		}
		if (decoded === expected) {
			return context.next()
		}
	}
	return new Response('Unauthorized', {
		status: 401,
		headers: { 'WWW-Authenticate': 'Basic realm="Site", charset="UTF-8"' },
	})
}

