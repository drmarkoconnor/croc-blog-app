// Netlify Function: POST /api/transcribe
// Accepts JSON { audioBase64: string, mime: string, title?: string }
// 1) Uploads audio to Supabase Storage (snippets bucket)
// 2) Inserts song_snippets row
// 3) Calls OpenAI Whisper to transcribe
// 4) Inserts transcripts row
// 5) Calls GPT-mini to produce structured summary with TODOs & songwriting suggestions
// Returns JSON with snippet, transcript, and analysis

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function resp(statusCode, data) {
	return {
		statusCode,
		body: typeof data === 'string' ? data : JSON.stringify(data),
	}
}

function inferExt(mime) {
	if (!mime) return 'webm'
	const m = mime.toLowerCase()
	if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
	if (m.includes('mp4') || m.includes('m4a')) return 'm4a'
	if (m.includes('wav')) return 'wav'
	if (m.includes('ogg')) return 'ogg'
	if (m.includes('webm')) return 'webm'
	return 'webm'
}

async function sb(path, opts = {}) {
	const base = SUPABASE_URL
	if (!base || !SERVICE_KEY)
		throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
	const res = await fetch(base.replace(/\/$/, '') + path, {
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

async function uploadToStorage(buf, mime, path) {
	const url =
		SUPABASE_URL.replace(/\/$/, '') +
		`/storage/v1/object/snippets/${encodeURI(path)}`
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			apikey: SERVICE_KEY,
			Authorization: `Bearer ${SERVICE_KEY}`,
			'Content-Type': mime || 'application/octet-stream',
			'x-upsert': 'true',
		},
		body: buf,
	})
	if (!res.ok) throw new Error(`Storage ${res.status} ${await res.text()}`)
}

async function whisperTranscribe(buf, filename) {
	if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY')
	const boundary = '----netlifyform' + Math.random().toString(16).slice(2)
	const parts = []
	function addField(name, value) {
		parts.push(
			`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
		)
	}
	function addFile(name, filename, contentType, buffer) {
		parts.push(
			`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
		)
		parts.push(buffer)
		parts.push(`\r\n`)
	}
	addField('model', 'whisper-1')
	addFile('file', filename, 'application/octet-stream', buf)
	parts.push(`--${boundary}--`)
	const body = Buffer.isBuffer(parts[0])
		? Buffer.concat(parts)
		: Buffer.concat(
				parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p))
		  )

	const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${OPENAI_API_KEY}`,
			'Content-Type': `multipart/form-data; boundary=${boundary}`,
		},
		body,
	})
	if (!res.ok) throw new Error(`Whisper ${res.status} ${await res.text()}`)
	const data = await res.json()
	return data.text || ''
}

async function summarizeTranscript(text) {
	if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY')
	const system = `You are a concise songwriting assistant. Summarize the ideas and extract actionable TODOs.
Also augment with songwriting suggestions: possible rhymes, genres/moods, chord progression ideas, and 3-6 inspiration links (records, articles, sites) the idea evokes.
Respond as strict JSON with keys: summary (string), todos (string[]), songwriting_suggestions { rhymes: string[], genres: string[], chord_progressions: string[], inspirations: { title: string, url: string }[] }.`
	const user = `Transcript:\n\n${text}`
	const res = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${OPENAI_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: 'gpt-4o-mini',
			temperature: 0.4,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
		}),
	})
	if (!res.ok) throw new Error(`Summarize ${res.status} ${await res.text()}`)
	const data = await res.json()
	let content = data.choices?.[0]?.message?.content || '{}'
	try {
		return JSON.parse(content)
	} catch {
		return {
			summary: content,
			todos: [],
			songwriting_suggestions: {
				rhymes: [],
				genres: [],
				chord_progressions: [],
				inspirations: [],
			},
		}
	}
}

exports.handler = async (event) => {
	if (event.httpMethod !== 'POST') {
		return resp(405, 'Method Not Allowed')
	}
	try {
		const body = JSON.parse(event.body || '{}')
		const { audioBase64, mime, title } = body
		if (!audioBase64) return resp(400, { error: 'Missing audioBase64' })
		const buf = Buffer.from(audioBase64, 'base64')
		if (!buf || buf.length === 0) return resp(400, { error: 'Empty audio' })
		if (buf.length > 25 * 1024 * 1024)
			return resp(413, { error: 'Audio too large (25MB max)' })

		const ext = inferExt(mime)
		const id = (
			global.crypto?.randomUUID?.() || require('crypto').randomUUID()
		).replace(/-/g, '')
		const filename = `${id}.${ext}`
		const storagePath = `${new Date().getFullYear()}/${filename}`

		// 1) Upload to Storage
		await uploadToStorage(buf, mime || 'application/octet-stream', storagePath)

		// 2) Insert snippet row
		const insertPayload = [
			{
				user_id: null,
				title: title || null,
				notes: null,
				storage_path: storagePath,
				duration_seconds: null,
			},
		]
		const insertRes = await sb('/rest/v1/song_snippets', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			body: JSON.stringify(insertPayload),
		})
		const snippet = (await insertRes.json())?.[0]

		// 3) Transcribe via Whisper
		const transcriptText = await whisperTranscribe(buf, filename)

		// 4) Insert transcript row
		const trPayload = [
			{
				snippet_id: snippet.id,
				text: transcriptText,
				language: null,
				model: 'whisper-1',
				confidence: null,
			},
		]
		const trRes = await sb('/rest/v1/transcripts', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			body: JSON.stringify(trPayload),
		})
		const transcript = (await trRes.json())?.[0]

		// 5) Summarize with GPT-mini
		const analysis = await summarizeTranscript(transcriptText)

		// 6) Persist analysis
		const a = analysis || {}
		const inspirations = a?.songwriting_suggestions?.inspirations || []
		const anPayload = [
			{
				transcript_id: transcript.id,
				summary: a.summary || null,
				todos: Array.isArray(a.todos) ? a.todos : null,
				rhymes: Array.isArray(a.songwriting_suggestions?.rhymes)
					? a.songwriting_suggestions.rhymes
					: null,
				genres: Array.isArray(a.songwriting_suggestions?.genres)
					? a.songwriting_suggestions.genres
					: null,
				chord_progressions: Array.isArray(
					a.songwriting_suggestions?.chord_progressions
				)
					? a.songwriting_suggestions.chord_progressions
					: null,
				inspirations: Array.isArray(inspirations) ? inspirations : null,
				raw: analysis,
				model: 'gpt-4o-mini',
			},
		]
		const anRes = await sb('/rest/v1/transcript_analyses', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			body: JSON.stringify(anPayload),
		})
		const analysisRow = (await anRes.json())?.[0]

		return resp(200, { ok: true, snippet, transcript, analysis: analysisRow })
	} catch (e) {
		return resp(500, { error: String(e.message || e) })
	}
}

