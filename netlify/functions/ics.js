// Netlify Function: GET /api/ics?token=...  -> returns RFC 5545 iCalendar feed
// - Optional shared-secret: set ICS_TOKEN in the environment. If set, a matching
//   token query param is required. If not set, feed is public.
// - Reads events from Supabase via PostgREST using SUPABASE_SERVICE_ROLE_KEY.

function toIcsDate(dt) {
	// Input: ISO string or Date; Output: YYYYMMDDTHHMMSSZ (UTC)
	const d = typeof dt === 'string' ? new Date(dt) : dt
	const pad = (n) => String(n).padStart(2, '0')
	return (
		d.getUTCFullYear().toString() +
		pad(d.getUTCMonth() + 1) +
		pad(d.getUTCDate()) +
		'T' +
		pad(d.getUTCHours()) +
		pad(d.getUTCMinutes()) +
		pad(d.getUTCSeconds()) +
		'Z'
	)
}

function toIcsDateOnly(dt) {
	const d = typeof dt === 'string' ? new Date(dt) : dt
	const pad = (n) => String(n).padStart(2, '0')
	return (
		d.getUTCFullYear().toString() +
		pad(d.getUTCMonth() + 1) +
		pad(d.getUTCDate())
	)
}

function escapeText(s = '') {
	return s
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n')
}

function foldLine(line) {
	// Simple folding at 74 chars (continuation lines start with one space)
	const max = 74
	if (line.length <= max) return line
	let out = ''
	let i = 0
	while (i < line.length) {
		const chunk = line.slice(i, i + max)
		out += (i === 0 ? '' : '\r\n ') + chunk
		i += max
	}
	return out
}

function buildIcs(events) {
	const lines = []
	const now = new Date()
	lines.push('BEGIN:VCALENDAR')
	lines.push('VERSION:2.0')
	lines.push('PRODID:-//CharlotteApp//EN')
	lines.push('CALSCALE:GREGORIAN')
	lines.push('METHOD:PUBLISH')
	lines.push('X-WR-CALNAME:Charlotte Personal')
	for (const ev of events) {
		const uid = `${ev.id || toIcsDate(ev.starts_at)}@charlotte.local`
		const dtstamp = toIcsDate(now)
		const isAllDay = !!ev.all_day
		lines.push('BEGIN:VEVENT')
		lines.push(`UID:${uid}`)
		lines.push(`DTSTAMP:${dtstamp}`)
		if (isAllDay) {
			lines.push(`DTSTART;VALUE=DATE:${toIcsDateOnly(ev.starts_at)}`)
			// For all-day, DTEND is non-inclusive next day
			const end = new Date(ev.ends_at || ev.starts_at)
			end.setUTCDate(end.getUTCDate() + 1)
			lines.push(`DTEND;VALUE=DATE:${toIcsDateOnly(end)}`)
		} else {
			lines.push(`DTSTART:${toIcsDate(ev.starts_at)}`)
			if (ev.ends_at) lines.push(`DTEND:${toIcsDate(ev.ends_at)}`)
		}
		if (ev.title) lines.push(foldLine(`SUMMARY:${escapeText(ev.title)}`))
		if (ev.description)
			lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`))
		if (ev.location) lines.push(foldLine(`LOCATION:${escapeText(ev.location)}`))
		lines.push('STATUS:CONFIRMED')
		lines.push('END:VEVENT')
	}
	lines.push('END:VCALENDAR')
	return lines.join('\r\n')
}

async function fetchEvents() {
	const url = process.env.SUPABASE_URL
	const service = process.env.SUPABASE_SERVICE_ROLE_KEY
	if (!url || !service)
		throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
	const q = new URL(url.replace(/\/$/, '') + '/rest/v1/events')
	q.searchParams.set('select', '*')
	q.searchParams.set('order', 'starts_at.asc')
	const res = await fetch(q, {
		headers: {
			apikey: service,
			Authorization: `Bearer ${service}`,
			Accept: 'application/json',
		},
	})
	if (!res.ok) throw new Error(`Supabase error ${res.status}`)
	return res.json()
}

exports.handler = async (event) => {
	try {
		const required = process.env.ICS_TOKEN
		const token =
			event.queryStringParameters && event.queryStringParameters.token
		if (required && token !== required) {
			return { statusCode: 401, body: 'Unauthorized' }
		}
		const events = await fetchEvents()
		const body = buildIcs(events)
		return {
			statusCode: 200,
			headers: {
				'Content-Type': 'text/calendar; charset=utf-8',
				'Cache-Control': 'public, max-age=300',
			},
			body,
		}
	} catch (e) {
		return { statusCode: 500, body: `ICS error: ${e.message}` }
	}
}

