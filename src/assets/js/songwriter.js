// Songcraft-style workspace: editor, chord palette, autosave, audio capture
import { initSupabase } from '/assets/js/supabase.js'

// Tiny utilities
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))

// Basic chord data
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'])
const SHARP_KEYS = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'C#'])
const NOTE_NAMES = {
	sharp: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
	flat: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'],
}

function preferAccidental(key) {
	if (FLAT_KEYS.has(key)) return 'flat'
	if (SHARP_KEYS.has(key)) return 'sharp'
	return 'sharp'
}

function pcOf(name) {
	const idxSharp = NOTE_NAMES.sharp.indexOf(name)
	if (idxSharp >= 0) return idxSharp
	const idxFlat = NOTE_NAMES.flat.indexOf(name)
	if (idxFlat >= 0) return idxFlat
	throw new Error('Unknown note: ' + name)
}
function nameOf(pc, pref) {
	const set = NOTE_NAMES[pref]
	return set[((pc % 12) + 12) % 12]
}

function transposeChordSymbol(sym, semis, pref) {
	// naive: transpose only root (before first non-letter/#/b)
	const m = sym.match(/^([A-G](?:#|b)?)(.*)$/)
	if (!m) return sym
	const root = m[1]
	const rest = m[2] || ''
	const pc = pcOf(root)
	const to = (pc + semis + 1200) % 12
	return nameOf(to, pref) + rest
}

function chordSetForKey(key) {
	// Very basic diatonic set in major only for MVP
	const pref = preferAccidental(key)
	const roots = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
	const rel = pcOf(key) // treat as major
	const triadQual = ['', 'm', 'm', '', '', 'm', 'dim']
	const seventhQual = ['Maj7', 'm7', 'm7', 'Maj7', '7', 'm7', 'm7b5']
	const triads = roots.map(
		(r, i) => nameOf((pcOf(r) + rel) % 12, pref) + triadQual[i]
	)
	const sevenths = roots.map(
		(r, i) => nameOf((pcOf(r) + rel) % 12, pref) + seventhQual[i]
	)
	const borrowed = ['bIII', 'bVI', 'bVII'].map((sym) => sym) // placeholders
	return { triads, sevenths, borrowed }
}

// ChordPro helpers
function transposeChordPro(text, semis, pref) {
	return text.replace(
		/\[([^\]]+)\]/g,
		(_, ch) => `[${transposeChordSymbol(ch, semis, pref)}]`
	)
}

function insertAtCursor(textarea, str) {
	const start = textarea.selectionStart || 0
	const end = textarea.selectionEnd || 0
	const before = textarea.value.slice(0, start)
	const after = textarea.value.slice(end)
	textarea.value = before + str + after
	const pos = start + str.length
	textarea.setSelectionRange(pos, pos)
	textarea.focus()
}

// Debounced autosave (Supabase + IndexedDB)
let db
async function idb() {
	if (db) return db
	db = await new Promise((resolve, reject) => {
		const req = indexedDB.open('songcraft', 1)
		req.onupgradeneeded = () => {
			const d = req.result
			d.createObjectStore('drafts', { keyPath: 'id' })
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
	return db
}
async function saveDraft(draft) {
	const d = await idb()
	await new Promise((resolve, reject) => {
		const tx = d.transaction('drafts', 'readwrite')
		tx.objectStore('drafts').put(draft)
		tx.oncomplete = resolve
		tx.onerror = () => reject(tx.error)
	})
}
async function loadDraft(id) {
	const d = await idb()
	return await new Promise((resolve, reject) => {
		const tx = d.transaction('drafts', 'readonly')
		const req = tx.objectStore('drafts').get(id)
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

let sb,
	user,
	songId = null
// Single-user mode; server function uses service role
let autosaveTimer
async function autosave() {
	clearTimeout(autosaveTimer)
	autosaveTimer = setTimeout(async () => {
		const body = $('#editor').value
		const payload = {
			title: $('#songTitle').value || 'Untitled',
			key: $('#songKey').value,
			bpm: parseInt($('#songBpm').value || '90', 10),
			body_chordpro: body,
		}
		await saveDraft({ id: 'current', payload, ts: Date.now() })
		try {
			// Prefer server function so login isn't required
			const res = await fetch('/.netlify/functions/songcraft', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					// no visitor id required in single-user mode
				},
				body: JSON.stringify({ action: 'upsert', id: songId, ...payload }),
			})
			if (res.ok) {
				const j = await res.json()
				if (!songId && j?.id) {
					songId = j.id
					ensureDeleteButton()
				}
			}
		} catch (e) {
			// ignore; remain local-only if offline
		}
	}, 800)
}

async function renderPalette() {
	const key = $('#songKey').value
	const { triads, sevenths, borrowed } = chordSetForKey(key)
	const makeBtn = (sym) => {
		const b = document.createElement('button')
		b.className = 'btn btn-small'
		b.textContent = sym
		b.onclick = () => {
			insertAtCursor($('#editor'), `[${sym}]`)
			autosave()
			audition(sym)
		}
		return b
	}
	const pal = $('#palette')
	pal.innerHTML = ''
	triads.forEach((c) => pal.appendChild(makeBtn(c)))
	const pal7 = $('#palette7')
	pal7.innerHTML = ''
	sevenths.forEach((c) => pal7.appendChild(makeBtn(c)))
	const bor = $('#borrowed')
	bor.innerHTML = ''
	borrowed.forEach((c) => bor.appendChild(makeBtn(c)))
}

// Structure helpers: use | as bar delimiter; build a preview grid like iReal
function insertBarDelimiter() {
	const ed = document.querySelector('#editor')
	if (!ed) return
	insertAtCursor(ed, ' | ')
	autosave()
	renderBarPreview()
}
function addEmptyBars(n = 4) {
	const ed = document.querySelector('#editor')
	if (!ed) return
	const bars = Array.from({ length: n }, () => ' | ').join('')
	insertAtCursor(ed, bars)
	autosave()
	renderBarPreview()
}
function parseBarsDetailed() {
	const text = document.querySelector('#editor')?.value || ''
	const beatsPerBar = parseInt(
		document.querySelector('#timeBeats')?.value || '4',
		10
	)
	const lines = text.split(/\n/)
	const out = [] // items: { type:'section', title } | { type:'bar', chords:[{sym,beats}] }
	const chordToken = /(\[([^\]]+)\]|([A-G](?:#|b)?[^\s\|\{\}]*))(?:\{(\d+)\})?/g
	const sectionLine = /^\s*\[([^\]]+)\]\s*$/
	const isChordLike = (s) => /^[A-G](?:#|b)?/.test(s)
	for (const rawLine of lines) {
		const line = rawLine.trim()
		const sec = line.match(sectionLine)
		if (sec && !isChordLike(sec[1] || '')) {
			out.push({ type: 'section', title: sec[1].trim() })
			continue
		}
		if (!line) continue
		const segments = line.split('|')
		for (let seg of segments) {
			seg = seg.trim()
			if (seg === '' && out.length === 0) continue
			if (seg === '%') {
				// repeat previous bar (copy chords)
				for (let j = out.length - 1; j >= 0; j--) {
					if (out[j]?.type === 'bar') {
						const prev = out[j]
						out.push({
							type: 'bar',
							chords: prev.chords.map((c) => ({ ...c })),
						})
						break
					}
				}
				continue
			}
			const chords = []
			let m
			while ((m = chordToken.exec(seg))) {
				const sym = (m[2] || m[3] || '').trim()
				if (!sym) continue
				const beats = m[4] ? parseInt(m[4], 10) : 0
				chords.push({ sym, beats })
			}
			if (!chords.length) {
				out.push({ type: 'bar', chords: [] })
				continue
			}
			// assign default beats where 0, distributing evenly
			const zeros = chords.filter((c) => !c.beats).length
			if (zeros) {
				const count = chords.length
				const base = Math.floor(beatsPerBar / count)
				const rem = beatsPerBar - base * count
				chords.forEach((c, i) => {
					if (!c.beats) c.beats = base + (i === count - 1 ? rem : 0)
				})
			}
			out.push({ type: 'bar', chords })
		}
	}
	return { items: out, beatsPerBar }
}
function renderBarPreview() {
	const wrap = document.querySelector('#barPreview')
	if (!wrap) return
	const bpl = parseInt(document.querySelector('#barsPerLine')?.value || '4', 10)
	const beats = parseInt(document.querySelector('#timeBeats')?.value || '4', 10)
	const layoutSel = document.querySelector('#chartLayout')?.value || 'comfy'
	const parsed = parseBarsDetailed()
	const items = parsed.items
	wrap.innerHTML = ''
	wrap.style.gridTemplateColumns = `repeat(${bpl}, 1fr)`
	wrap.classList.remove('compact', 'large')
	if (layoutSel === 'compact') wrap.classList.add('compact')
	if (layoutSel === 'large') wrap.classList.add('large')
	items.forEach((it) => {
		if (it.type === 'section') {
			const sec = document.createElement('div')
			sec.className = 'bar-section'
			sec.textContent = it.title
			sec.style.gridColumn = `1 / ${bpl + 1}`
			wrap.appendChild(sec)
			return
		}
		const cell = document.createElement('div')
		cell.className = 'bar-cell'
		const label = it.chords
			.map((c) =>
				c.beats && c.beats !== beats ? `${c.sym}(${c.beats})` : c.sym
			)
			.join('  ')
		cell.textContent = label || '—'
		const beatsRow = document.createElement('div')
		beatsRow.className = 'beat-grid'
		for (let i = 0; i < beats; i++) {
			const sp = document.createElement('span')
			beatsRow.appendChild(sp)
		}
		cell.appendChild(beatsRow)
		wrap.appendChild(cell)
	})
}

// Audio audition via Tone.js (optional)
let Tone, synth, poly, TonalMod, reverb, eq, piano, metroHigh, metroLow
// (Removed instrument preference; piano is the only voice)
async function ensureTone() {
	if (Tone) return
	try {
		Tone = await import('https://esm.sh/tone@14.8.49')
		// Mastering: gentle EQ and lush reverb for pleasant tone
		eq = new Tone.EQ3({ low: -2, mid: 0, high: 1 }).toDestination()
		reverb = new Tone.Reverb({ decay: 2.8, wet: 0.18, preDelay: 0.02 })
		reverb.connect(eq)
		// Soft, musical poly synth with detune and subtle chorus-like feel
		poly = new Tone.PolySynth(Tone.Synth, {
			maxPolyphony: 6,
			oscillator: { type: 'sawtooth' },
			envelope: { attack: 0.02, decay: 0.25, sustain: 0.6, release: 1.6 },
			portamento: 0.0,
		}).connect(reverb)
		// Keep mono synth as fallback for single tones
		synth = new Tone.Synth({
			oscillator: { type: 'triangle' },
			envelope: { attack: 0.02, release: 0.9 },
		}).connect(reverb)
		// Optional: lazy-load tonal for chord parsing
		TonalMod = await import('https://esm.sh/@tonaljs/tonal@5')
		// Metronome click synths
		try {
			metroHigh = new Tone.MembraneSynth({
				pitchDecay: 0.008,
				octaves: 4,
				oscillator: { type: 'sine' },
				envelope: { attack: 0.001, decay: 0.05, sustain: 0.0, release: 0.01 },
			}).connect(eq)
			metroLow = new Tone.MembraneSynth({
				pitchDecay: 0.008,
				octaves: 4,
				oscillator: { type: 'sine' },
				envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.02 },
			}).connect(eq)
		} catch {}
	} catch (e) {
		console.warn('Tone load failed; fallback silent', e)
	}
}
function midiOf(note) {
	const m = note.match(/^([A-G](?:#|b)?)/)
	const root = m ? m[1] : 'C'
	const pc = pcOf(root)
	const base = 60 // C4
	return base + (pc - pcOf('C'))
}
function normalizeQuality(rest) {
	const r = (rest || '').trim()
	if (!r) return ''
	if (/^Maj7$/i.test(r)) return 'maj7'
	if (/^M7$/i.test(r)) return 'maj7'
	if (/^m7b5$/i.test(r) || r === 'ø') return 'm7b5'
	if (/^dim7$/i.test(r)) return 'dim7'
	if (/^dim$/i.test(r) || r === 'o') return 'dim'
	if (/^m7$/i.test(r)) return 'm7'
	if (/^m(?!aj)/i.test(r)) return 'm'
	if (/^7$/.test(r)) return '7'
	return r
}
function chordNotesFromSymbol(sym) {
	// Skip non-note placeholders (e.g., bIII)
	if (!/^[A-G]/.test(sym)) return null
	const m = sym.match(/^([A-G](?:#|b)?)(.*)$/)
	if (!m) return null
	const root = m[1]
	const qual = normalizeQuality(m[2] || '')

	// Use tonal if available
	if (TonalMod?.Chord?.get) {
		const name = root + qual
		const got = TonalMod.Chord.get(name)
		if (got?.notes?.length) return got.notes
	}

	// Fallback: basic sets
	const q = qual.toLowerCase()
	const basePc = pcOf(root)
	const intervals =
		q === 'm7b5'
			? [0, 3, 6, 10]
			: q === 'dim7'
			? [0, 3, 6, 9]
			: q === 'dim'
			? [0, 3, 6]
			: q === 'maj7'
			? [0, 4, 7, 11]
			: q === 'm7'
			? [0, 3, 7, 10]
			: q === '7'
			? [0, 4, 7, 10]
			: q === 'm'
			? [0, 3, 7]
			: [0, 4, 7]
	const pref = preferAccidental(root)
	return intervals.map((i) => nameOf(basePc + i, pref))
}
function withOctaves(notes, baseOct = 3) {
	// Use pleasant close voicings; avoid stacked semitones across octaves
	const uniq = []
	for (const n of notes) if (!uniq.includes(n)) uniq.push(n)
	const out = []
	for (let i = 0; i < uniq.length; i++) {
		const oct = baseOct + (i > 2 ? 1 : 0)
		out.push(`${uniq[i]}${oct}`)
	}
	// If major/minor triad, optionally add 9 for sweetness
	if (uniq.length === 3) {
		try {
			const root = uniq[0]
			const pref = preferAccidental(root)
			out.push(`${nameOf(pcOf(root) + 14, pref)}${baseOct + 1}`) // add 9 an octave up
		} catch {}
	}
	return out
}
async function audition(sym) {
	await ensureTone()
	if (!Tone) return
	const chordPc =
		chordNotesFromSymbol(sym) ||
		chordNotesFromSymbol($('#songKey')?.value || 'C')
	const mode = 'piano'
	if (chordPc?.length) {
		const notes = withOctaves(chordPc)
		try {
			await playPiano(notes)
			return
		} catch {}
	}
	// Fallback single tone if poly not available
	if (synth) {
		const n = midiOf(sym)
		try {
			synth.triggerAttackRelease(Tone.Frequency(n, 'midi'), '1n')
		} catch {}
	}
}

// (Guitar/drums removed to keep the app focused on piano)

// Piano: sample-based via Tone.Sampler
async function ensurePiano() {
	await ensureTone()
	if (piano) return piano
	try {
		// Using free public piano samples (Yamaha Grand) from Tone.js CDN
		// For a Steinway-like tone, these suffice for preview; can swap later
		piano = new Tone.Sampler(
			{
				A1: 'A1.mp3',
				C2: 'C2.mp3',
				'D#2': 'Ds2.mp3',
				'F#2': 'Fs2.mp3',
				A2: 'A2.mp3',
				C3: 'C3.mp3',
				'D#3': 'Ds3.mp3',
				'F#3': 'Fs3.mp3',
				A3: 'A3.mp3',
				C4: 'C4.mp3',
				'D#4': 'Ds4.mp3',
				'F#4': 'Fs4.mp3',
				A4: 'A4.mp3',
				C5: 'C5.mp3',
				'D#5': 'Ds5.mp3',
				'F#5': 'Fs5.mp3',
				A5: 'A5.mp3',
			},
			{
				baseUrl: 'https://tonejs.github.io/audio/salamander/',
				release: 2,
			}
		).connect(reverb)
		await Tone.loaded()
	} catch (e) {
		console.warn('Piano load failed', e)
	}
	return piano
}

async function playPiano(notes) {
	await ensurePiano()
	if (!piano) return
	const now = Tone.now()
	const dur = 1.5
	try {
		notes.forEach((n, i) => piano.triggerAttackRelease(n, dur, now + i * 0.01))
	} catch {}
}

// Recording mini-panel
let media,
	chunks = [],
	rec,
	t0
function fmt(t) {
	const s = Math.floor(t / 1000),
		m = Math.floor(s / 60)
			.toString()
			.padStart(2, '0'),
		ss = (s % 60).toString().padStart(2, '0')
	return `${m}:${ss}`
}
{
	const el = $('#btnRec')
	if (el)
		el.addEventListener('click', async () => {
			try {
				media = await navigator.mediaDevices.getUserMedia({ audio: true })
				chunks = []
				rec = new MediaRecorder(media)
				t0 = Date.now()
				$('#recTimer').textContent = '00:00'
				$('#btnRec').style.display = 'none'
				$('#btnStop').style.display = ''
				rec.ondataavailable = (e) => chunks.push(e.data)
				rec.onstop = () => {
					const blob = new Blob(chunks, { type: 'audio/webm' })
					$('#recAudio').src = URL.createObjectURL(blob)
					$('#recAudio').style.display = ''
					$('#btnUpload').style.display = ''
					media.getTracks().forEach((t) => t.stop())
				}
				rec.start()
				const tick = () => {
					if (!rec || rec.state !== 'recording') return
					$('#recTimer').textContent = fmt(Date.now() - t0)
					requestAnimationFrame(tick)
				}
				tick()
			} catch (e) {
				alert('Mic permission error')
			}
		})
}
{
	const el = $('#btnStop')
	if (el)
		el.addEventListener('click', () => {
			try {
				rec.stop()
			} catch {}
			$('#btnStop').style.display = 'none'
			$('#btnRec').style.display = ''
		})
}
{
	const el = $('#btnUpload')
	if (el)
		el.addEventListener('click', async () => {
			if (!songId) return alert('Type something first to create the song.')
			if (!chunks?.length) return alert('No recording to upload.')
			try {
				await ensureTone() // no-op if already
				const blob = new Blob(chunks, { type: 'audio/webm' })
				const res = await fetch(
					`/.netlify/functions/songcraft?action=uploadAudio&songId=${encodeURIComponent(
						songId
					)}`,
					{
						method: 'POST',
						headers: { 'content-type': 'audio/webm' },
						body: await blob.arrayBuffer(),
					}
				)
				if (!res.ok) {
					const t = await res.text().catch(() => '')
					return alert('Upload failed: ' + t)
				}
				await res.json()
				renderTakes()
				alert('Uploaded')
			} catch (e) {
				alert('Upload failed')
			}
		})
}

// Init
async function init() {
	// No auth required

	// Restore draft
	const d = await loadDraft('current')
	if (d?.payload) {
		$('#songTitle').value = d.payload.title || ''
		$('#songKey').value = d.payload.key || 'C'
		$('#songBpm').value = d.payload.bpm || 90
		$('#editor').value = d.payload.body_chordpro || ''
	}
	// If ?id= is present, load that song from server
	const qid = new URLSearchParams(location.search).get('id')
	if (qid) {
		try {
			const r = await fetch(
				`/.netlify/functions/songcraft?action=get&id=${encodeURIComponent(qid)}`
			)
			if (r.ok) {
				const dj = await r.json()
				const row = dj.song
				if (row) {
					songId = row.id
					$('#songTitle').value = row.title || ''
					$('#songKey').value = row.key || 'C'
					$('#songBpm').value = row.bpm || 90
					$('#editor').value = row.body_chordpro || ''
					ensureDeleteButton()
					renderTakes()
				}
			}
		} catch {}
	}
	renderPalette()
	renderRecent()

	// Handlers
	$('#songKey').addEventListener('change', () => {
		renderPalette()
		autosave()
	})
	$('#songTitle').addEventListener('input', autosave)
	$('#songBpm').addEventListener('input', autosave)
	$('#editor').addEventListener('input', autosave)
	$('#editor').addEventListener('input', renderBarPreview)
	$('#btnTransposeDown').addEventListener('click', () => {
		const pref = preferAccidental($('#songKey').value)
		$('#editor').value = transposeChordPro($('#editor').value, -1, pref)
		autosave()
	})
	$('#btnTransposeUp').addEventListener('click', () => {
		const pref = preferAccidental($('#songKey').value)
		$('#editor').value = transposeChordPro($('#editor').value, 1, pref)
		autosave()
	})
	$('#btnAudition').addEventListener('click', async () => {
		await ensureTone()
		try {
			await Tone.start?.()
		} catch {}
		const val = $('#editor').value
		const pos = $('#editor').selectionStart || 0
		const upto = val.slice(0, pos)
		const m = upto.match(/\[([^\]]+)\](?!.*\[[^\]]+\])/) // last chord before cursor
		if (m) audition(m[1])
		else {
			// audition tonic by default
			audition($('#songKey').value)
		}
	})

	// Structure controls
	$('#btnInsertBar')?.addEventListener('click', insertBarDelimiter)
	$('#btnAdd4Bars')?.addEventListener('click', () => addEmptyBars(4))
	$('#timeBeats')?.addEventListener('change', renderBarPreview)
	$('#barsPerLine')?.addEventListener('change', renderBarPreview)
	$('#chartLayout')?.addEventListener('change', renderBarPreview)
	$('#btnPrintChart')?.addEventListener('click', () => window.print())

	// Play/Stop song buttons
	$('#btnPlaySong')?.addEventListener('click', () => playSongFromEditor())
	$('#btnStopSong')?.addEventListener('click', () => stopSong())

	// Wire: New, Export, Import, Save Version
	$('#btnNew')?.addEventListener('click', async () => {
		if (
			!confirm(
				'Start a new blank song? Unsaved local changes are kept in drafts.'
			)
		)
			return
		songId = null
		$('#songTitle').value = ''
		$('#songKey').value = 'C'
		$('#songBpm').value = 90
		$('#editor').value = ''
		renderPalette()
		autosave()
	})
	$('#btnExport')?.addEventListener('click', () => {
		const payload = {
			title: $('#songTitle').value || 'Untitled',
			key: $('#songKey').value,
			bpm: $('#songBpm').value,
			body_chordpro: $('#editor').value,
		}
		const blob = new Blob([JSON.stringify(payload, null, 2)], {
			type: 'application/json',
		})
		const a = document.createElement('a')
		a.href = URL.createObjectURL(blob)
		a.download = (payload.title || 'song') + '.songcraft.json'
		a.click()
		URL.revokeObjectURL(a.href)
	})
	$('#importFile')?.addEventListener('change', async (e) => {
		const file = e.target.files?.[0]
		if (!file) return
		const text = await file.text()
		if (file.name.endsWith('.json')) {
			try {
				const p = JSON.parse(text)
				if (p.title) $('#songTitle').value = p.title
				if (p.key) $('#songKey').value = p.key
				if (p.bpm) $('#songBpm').value = p.bpm
				if (p.body_chordpro) $('#editor').value = p.body_chordpro
				renderPalette()
				autosave()
			} catch {
				alert('Invalid JSON file')
			}
		} else {
			// treat as raw ChordPro
			$('#editor').value = text
			autosave()
		}
		e.target.value = ''
	})
	$('#btnSaveVersion')?.addEventListener('click', async () => {
		if (!songId) await autosave() // ensure song exists
		if (!songId) return alert('Type something first to create the song.')
		const label = prompt(
			'Label for this version (optional):',
			new Date().toLocaleString()
		)
		try {
			const res = await fetch('/.netlify/functions/songcraft', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					// single-user mode
				},
				body: JSON.stringify({
					action: 'saveVersion',
					song_id: songId,
					label,
					body_chordpro: $('#editor').value,
				}),
			})
			ensureDeleteButton()
			renderTakes()
			if (res.ok) alert('Version saved')
			else alert('Failed to save version')
		} catch {
			alert('Failed to save version')
		}
	})

	// No auth controls
}

// Kick off
init()
renderBarPreview()
renderPiano()

// Recent songs (top 5)
async function renderRecent() {
	try {
		const res = await fetch('/.netlify/functions/songcraft?action=list')
		if (!res.ok) return
		const j = await res.json()
		const list = Array.isArray(j.songs) ? j.songs.slice(0, 5) : []
		const ul = $('#recentSongs')
		if (!ul) return
		ul.innerHTML = ''
		if (!list.length) {
			const li = document.createElement('li')
			li.style.opacity = '.8'
			li.textContent = 'No recent songs yet.'
			ul.appendChild(li)
			return
		}
		for (const s of list) {
			const li = document.createElement('li')
			li.innerHTML = `<button class="btn btn-small" style="width:100%;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-id="${
				s.id
			}">${s.title || 'Untitled'} · ${s.key || ''} · ${
				s.bpm || ''
			} BPM</button>`
			li.querySelector('button').addEventListener('click', async () => {
				try {
					const r = await fetch(
						`/.netlify/functions/songcraft?action=get&id=${encodeURIComponent(
							s.id
						)}`
					)
					if (!r.ok) return
					const dj = await r.json()
					const row = dj.song || {}
					songId = row.id || s.id
					$('#songTitle').value = row.title || s.title || ''
					$('#songKey').value = row.key || s.key || 'C'
					$('#songBpm').value = row.bpm || s.bpm || 90
					if (row.body_chordpro) $('#editor').value = row.body_chordpro
					renderPalette()
					ensureDeleteButton()
					renderTakes()
				} catch {}
			})
			ul.appendChild(li)
		}
	} catch {}
}

// Ensure Delete button exists when a song is present
function ensureDeleteButton() {
	if (!songId) return
	if (document.querySelector('#btnDelete')) return
	const btn = document.createElement('button')
	btn.id = 'btnDelete'
	btn.className = 'btn btn-small'
	btn.style.background = '#5a2233'
	btn.textContent = 'Delete'
	const controls =
		document.querySelector('#importFile')?.parentElement?.parentElement
	if (controls) controls.appendChild(btn)
	btn.addEventListener('click', async () => {
		if (!songId) return alert('No song selected')
		if (!confirm('Delete this song? This cannot be undone.')) return
		try {
			const res = await fetch('/.netlify/functions/songcraft', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'delete', id: songId }),
			})
			if (!res.ok) return alert('Delete failed')
			// Reset UI
			songId = null
			$('#songTitle').value = ''
			$('#songKey').value = 'C'
			$('#songBpm').value = 90
			$('#editor').value = ''
			renderPalette()
			renderRecent()
			const del = document.querySelector('#btnDelete')
			del?.parentElement?.removeChild(del)
			alert('Deleted')
		} catch {
			alert('Delete failed')
		}
	})
}

// Render a simple 2.5-octave piano keyboard for melody picking
function renderPiano() {
	const el = document.querySelector('#piano')
	if (!el) return
	const start = 60 - 4 // C4 minus 4 semitones = G3
	const keys = []
	for (let i = 0; i < 32; i++) keys.push(start + i) // ~2.5 octaves
	el.innerHTML = ''
	el.style.display = 'grid'
	el.style.gridAutoFlow = 'column'
	el.style.gridAutoColumns = 'minmax(22px,1fr)'
	el.style.gap = '2px'
	keys.forEach((midi) => {
		const name = Tone?.Frequency?.(midi, 'midi')?.toNote?.() || midi
		const isSharp = /#/.test(name)
		const btn = document.createElement('button')
		btn.className = 'pkey'
		btn.textContent = ''
		btn.style.height = isSharp ? '90px' : '140px'
		btn.style.alignSelf = 'end'
		btn.style.borderRadius = '6px'
		btn.style.border = '1px solid rgba(255,255,255,.2)'
		btn.style.background = isSharp ? '#1c2032' : '#f3f3f7'
		btn.style.color = isSharp ? '#fff' : '#111'
		btn.style.position = 'relative'
		btn.title = name
		const startNote = async () => {
			await ensurePiano()
			try {
				await Tone.start?.()
			} catch {}
			piano?.triggerAttack(name)
		}
		const stopNote = () => {
			piano?.triggerRelease(name)
		}
		btn.addEventListener('mousedown', startNote)
		btn.addEventListener(
			'touchstart',
			(e) => {
				e.preventDefault()
				startNote()
			},
			{ passive: false }
		)
		btn.addEventListener('mouseup', stopNote)
		btn.addEventListener('mouseleave', stopNote)
		btn.addEventListener('touchend', stopNote)
		el.appendChild(btn)
	})
}

// Simple chord playback across the editor's chord tags [Cmaj7] etc.
let songTimerHandles = []
function stopSong() {
	songTimerHandles.forEach((h) => clearTimeout(h))
	songTimerHandles = []
	try {
		Tone.Transport.stop()
		Tone.Transport.cancel()
	} catch {}
}
async function playSongFromEditor() {
	const bpm = parseInt(document.querySelector('#songBpm')?.value || '90', 10)
	const beatsPerBar = parseInt(
		document.querySelector('#timeBeats')?.value || '4',
		10
	)
	const metOn = document.querySelector('#metronome')?.checked
	const parsed = parseBarsDetailed()
	const items = parsed.items
	if (!items.some((x) => x.type === 'bar' && x.chords.length)) {
		// fallback: scan chord tags only
		const text = document.querySelector('#editor')?.value || ''
		const chords = []
		const re = /\[([^\]]+)\]/g
		let m
		while ((m = re.exec(text))) chords.push(m[1])
		if (!chords.length) return alert('No chords found in the editor.')
		await ensurePiano()
		try {
			await Tone.start?.()
		} catch {}
		const beatMs = 60000 / bpm
		stopSong()
		if (metOn && Tone?.Transport) {
			try {
				Tone.Transport.bpm.value = bpm
				Tone.Transport.cancel()
				let beatIdx = 0
				Tone.Transport.scheduleRepeat((time) => {
					const down = beatIdx % beatsPerBar === 0
					try {
						if (down) metroHigh?.triggerAttackRelease('C5', '8n', time)
						else metroLow?.triggerAttackRelease('C4', '8n', time)
					} catch {}
					beatIdx = (beatIdx + 1) % (beatsPerBar * 1000)
				}, '4n')
				Tone.Transport.start()
			} catch {}
		}
		chords.forEach((sym, i) => {
			const h = setTimeout(() => audition(sym), i * 4 * beatMs)
			songTimerHandles.push(h)
		})
		return
	}
	await ensurePiano()
	try {
		await Tone.start?.()
	} catch {}
	const beatMs = 60000 / bpm
	stopSong()
	if (metOn && Tone?.Transport) {
		try {
			Tone.Transport.bpm.value = bpm
			Tone.Transport.cancel()
			let beatIdx = 0
			Tone.Transport.scheduleRepeat((time) => {
				const down = beatIdx % beatsPerBar === 0
				try {
					if (down) metroHigh?.triggerAttackRelease('C5', '8n', time)
					else metroLow?.triggerAttackRelease('C4', '8n', time)
				} catch {}
				beatIdx = (beatIdx + 1) % (beatsPerBar * 1000)
			}, '4n')
			Tone.Transport.start()
		} catch {}
	}
	let t = 0
	for (const it of items) {
		if (it.type !== 'bar') continue
		if (!it.chords.length) {
			t += parsed.beatsPerBar * beatMs
			continue
		}
		const total =
			it.chords.reduce((s, c) => s + (c.beats || 0), 0) || parsed.beatsPerBar
		const scale = (parsed.beatsPerBar * beatMs) / total
		for (const c of it.chords) {
			const dur = (c.beats || 1) * scale
			const h = setTimeout(() => audition(c.sym), t)
			songTimerHandles.push(h)
			t += dur
		}
	}
}

// Takes rendering
async function renderTakes() {
	const list = document.querySelector('#audioList')
	if (!list || !songId) return
	list.innerHTML = ''
	try {
		const r = await fetch(
			`/.netlify/functions/songcraft?action=listAudio&songId=${encodeURIComponent(
				songId
			)}`
		)
		if (!r.ok) return
		const j = await r.json()
		const items = Array.isArray(j.items)
			? j.items.sort((a, b) => (a.name > b.name ? -1 : 1))
			: []
		if (!items.length) {
			const li = document.createElement('li')
			li.style.opacity = '.8'
			li.textContent = 'No takes yet.'
			list.appendChild(li)
			return
		}
		items.forEach((it) => {
			const li = document.createElement('li')
			li.style.display = 'flex'
			li.style.alignItems = 'center'
			li.style.gap = '.5rem'
			const a = document.createElement('a')
			a.href = it.url
			a.textContent = it.name
			a.target = '_blank'
			const del = document.createElement('button')
			del.className = 'btn btn-small'
			del.style.background = '#5a2233'
			del.textContent = 'Delete'
			del.addEventListener('click', async () => {
				if (!confirm('Delete this take?')) return
				try {
					const res = await fetch('/.netlify/functions/songcraft', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							action: 'deleteAudio',
							song_id: songId,
							path: it.path,
						}),
					})
					if (res.ok) renderTakes()
					else alert('Delete failed')
				} catch {
					alert('Delete failed')
				}
			})
			li.appendChild(a)
			li.appendChild(del)
			list.appendChild(li)
		})
	} catch {}
}

