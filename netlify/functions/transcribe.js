// Netlify Function: POST /api/transcribe
// Minimal placeholder that echoes input. Replace with Whisper + Supabase integration.
exports.handler = async (event) => {
	if (event.httpMethod !== 'POST') {
		return { statusCode: 405, body: 'Method Not Allowed' }
	}
	try {
		const body = JSON.parse(event.body || '{}')
		return {
			statusCode: 200,
			body: JSON.stringify({
				ok: true,
				received: body,
				text: 'transcription-placeholder',
			}),
		}
	} catch (e) {
		return { statusCode: 400, body: JSON.stringify({ error: String(e) }) }
	}
}

