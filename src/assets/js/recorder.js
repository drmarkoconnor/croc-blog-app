// Minimal MediaRecorder sketch; integrate upload+transcribe in next step
let mediaRecorder,
	chunks = []

async function blobToBase64(blob) {
	const buf = await blob.arrayBuffer()
	let binary = ''
	const bytes = new Uint8Array(buf)
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize)
		binary += String.fromCharCode.apply(null, chunk)
	}
	return btoa(binary)
}

export async function startRec() {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
	mediaRecorder = new MediaRecorder(stream)
	chunks = []
	mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
	mediaRecorder.onstop = async () => {
		const blob = new Blob(chunks, { type: 'audio/webm' })
		chunks = []
		window.lastRecordedBlob = blob
		document.dispatchEvent(
			new CustomEvent('recorder:stopped', { detail: { blob } })
		)
	}
	mediaRecorder.start()
}

export function stopRec() {
	mediaRecorder?.stop()
}

export async function uploadAndTranscribe(blob, title) {
	const audioBase64 = await blobToBase64(blob)
	const res = await fetch('/api/transcribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			audioBase64,
			mime: blob.type || 'audio/webm',
			title: title || null,
		}),
	})
	if (!res.ok) throw new Error(await res.text())
	return res.json()
}

