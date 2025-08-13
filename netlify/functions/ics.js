// Netlify Function: GET /api/ics?token=...
exports.handler = async (event) => {
	const token = event.queryStringParameters && event.queryStringParameters.token
	if (!token) {
		return { statusCode: 400, body: 'Missing token' }
	}
	const ics = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//CharlotteApp//EN',
		'END:VCALENDAR',
	].join('\r\n')
	return {
		statusCode: 200,
		headers: { 'Content-Type': 'text/calendar' },
		body: ics,
	}
}

