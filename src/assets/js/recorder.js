// Minimal MediaRecorder sketch; integrate upload+transcribe in next step
let mediaRecorder,
	chunks = []
export async function startRec() {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
	mediaRecorder = new MediaRecorder(stream)
	mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
	mediaRecorder.onstop = async () => {
		const blob = new Blob(chunks, { type: 'audio/webm' })
		chunks = []
		// TODO: upload to Supabase and call /api/transcribe
		console.log('Recorded blob', blob)
		window.lastRecordedBlob = blob
	}
	mediaRecorder.start()
}
export function stopRec() {
	mediaRecorder?.stop()
}

