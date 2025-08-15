// Songcraft-style workspace: auth, editor, chord palette, autosave, audio capture
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
			// If Supabase isn't configured or user not signed in, keep local only
			if (!sb || !user) return
			if (!songId) {
				const { data, error } = await sb
					.from('songs')
					.insert(payload)
					.select('id')
					.single()
				if (error) throw error
				songId = data.id
			} else {
				const { error } = await sb
					.from('songs')
					.update(payload)
					.eq('id', songId)
				if (error) throw error
			}
		} catch (e) {
			console.warn('autosave failed', e)
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

// Audio audition via Tone.js (optional)
let Tone, synth, poly, TonalMod
async function ensureTone() {
	if (Tone) return
	try {
		Tone = await import('https://esm.sh/tone@14.8.49')
		// Soft, musical poly synth
		poly = new Tone.PolySynth(Tone.Synth, {
			maxPolyphony: 6,
			oscillator: { type: 'triangle' },
			envelope: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 1.2 },
		}).toDestination()
		// Keep mono synth as fallback for single tones
		synth = new Tone.Synth({
			oscillator: { type: 'sine' },
			envelope: { attack: 0.01, release: 0.8 },
		}).toDestination()
		// Optional: lazy-load tonal for chord parsing
		TonalMod = await import('https://esm.sh/@tonaljs/tonal@5')
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
	// Spread across two octaves for a fuller voicing
	const out = []
	for (let i = 0; i < notes.length; i++) {
		const oct = baseOct + (i > 1 ? 1 : 0)
		out.push(`${notes[i]}${oct}`)
	}
	return out
}
async function audition(sym) {
	await ensureTone()
	if (!Tone) return
	const chordPc =
		chordNotesFromSymbol(sym) ||
		chordNotesFromSymbol($('#songKey')?.value || 'C')
	if (chordPc?.length && poly) {
		const notes = withOctaves(chordPc)
		try {
			poly.triggerAttackRelease(notes, '1n')
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
			if (!user || !songId) {
				alert('Sign in first or start typing to create the song.')
				return
			}
			const resp = await fetch($('#recAudio').src)
			const buf = await resp.arrayBuffer()
			const filename = `${crypto.randomUUID()}.webm`
			const path = `${user.id}/${songId}/${filename}`
			const { error } = await sb.storage
				.from('audio_ideas')
				.upload(path, new Blob([buf], { type: 'audio/webm' }), {
					upsert: false,
				})
			if (error) {
				alert('Upload failed')
				return
			}
			await sb.from('audio_ideas').insert({
				song_id: songId,
				storage_path: path,
				duration_sec: Math.floor((Date.now() - t0) / 1000),
			})
			const li = document.createElement('li')
			li.textContent = `Saved: ${filename}`
			$('#audioList').appendChild(li)
			$('#btnUpload').style.display = 'none'
		})
}

// Auth + init
async function init() {
	try {
		sb = await initSupabase()
	} catch (e) {
		sb = null
	}

	// If Supabase configured, check session; else hide auth UI and run offline
	if (sb) {
		try {
			const {
				data: { session },
			} = await sb.auth.getSession()
			user = session?.user || null
			sb.auth.onAuthStateChange((_evt, sess) => {
				user = sess?.user || null
				$('#authStatus').textContent = user ? 'Signed in' : 'Signed out'
				$('#authEmail').style.display = user ? 'none' : ''
				$('#btnSignIn').style.display = user ? 'none' : ''
				$('#btnSignOut').style.display = user ? '' : 'none'
			})
			$('#authStatus').textContent = user ? 'Signed in' : 'Signed out'
			$('#authEmail').style.display = user ? 'none' : ''
			$('#btnSignIn').style.display = user ? 'none' : ''
			$('#btnSignOut').style.display = user ? '' : 'none'
		} catch (e) {
			// Fallback to offline
			sb = null
		}
	}
	if (!sb) {
		$('#authStatus').textContent = 'Offline mode'
		$('#authEmail').style.display = 'none'
		$('#btnSignIn').style.display = 'none'
		$('#btnSignOut').style.display = 'none'
	}

	// Restore draft
	const d = await loadDraft('current')
	if (d?.payload) {
		$('#songTitle').value = d.payload.title || ''
		$('#songKey').value = d.payload.key || 'C'
		$('#songBpm').value = d.payload.bpm || 90
		$('#editor').value = d.payload.body_chordpro || ''
	}
	renderPalette()

	// Handlers
	$('#songKey').addEventListener('change', () => {
		renderPalette()
		autosave()
	})
	$('#songTitle').addEventListener('input', autosave)
	$('#songBpm').addEventListener('input', autosave)
	$('#editor').addEventListener('input', autosave)
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
	$('#btnAudition').addEventListener('click', () => {
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
		if (!sb || !user) return alert('Sign in to save versions to the cloud.')
		if (!songId) await autosave() // ensure song exists
		if (!songId) return alert('Type something first to create the song.')
		const label = prompt(
			'Label for this version (optional):',
			new Date().toLocaleString()
		)
		const { error } = await sb.from('song_versions').insert({
			song_id: songId,
			label,
			body_chordpro: $('#editor').value,
		})
		if (error) alert('Failed to save version')
		else alert('Version saved')
	})

	// Auth controls (email link), show only if Supabase available
	if (sb) {
		$('#btnSignIn').addEventListener('click', async () => {
			const email = $('#authEmail').value.trim()
			if (!email) return alert('Enter email')
			const { error } = await sb.auth.signInWithOtp({
				email,
				options: { emailRedirectTo: window.location.origin + '/lyrics/' },
			})
			if (error) return alert('Sign-in failed')
			alert('Check your email for a sign-in link.')
		})
		$('#btnSignOut').addEventListener('click', async () => {
			await sb.auth.signOut()
			location.reload()
		})
	}
}

// Kick off
init()

