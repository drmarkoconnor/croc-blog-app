// Lightweight client-side rewards system (stars & suns)
;(function () {
	const LS_KEY = 'rewards.v1'
	const API = '/.netlify/functions/rewards'
	const DEFAULT = {
		stars: 0, // 0..99 then roll into suns
		suns: 0,
		history: [], // {ts, type, amount, note, page}
		visitedPages: {}, // pathname => true
	}

	function load() {
		try {
			const raw = localStorage.getItem(LS_KEY)
			if (!raw) return { ...DEFAULT }
			const obj = JSON.parse(raw)
			return {
				...DEFAULT,
				...obj,
				history: Array.isArray(obj.history) ? obj.history : [],
				visitedPages: obj.visitedPages || {},
			}
		} catch {
			return { ...DEFAULT }
		}
	}
	function save(state) {
		try {
			localStorage.setItem(LS_KEY, JSON.stringify(state))
		} catch {}
	}

	function pushHistory(state, type, amount, note) {
		state.history.unshift({
			ts: Date.now(),
			type,
			amount,
			note,
			page: location?.pathname || '/',
		})
		// keep last 500 events
		state.history = state.history.slice(0, 500)
	}

	function rollup(state) {
		// Convert every 100 stars into 1 sun
		while (state.stars >= 100) {
			state.stars -= 100
			state.suns += 1
			pushHistory(state, 'sun', 0, 'You earned a SUN! ⭐️×100 → ☀️')
		}
	}

	async function syncToServer(payload) {
		try {
			const r = await fetch(API, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			})
			if (!r.ok) throw new Error('sync failed')
			const s = await r.json()
			save(s) // mirror server state locally
			return s
		} catch {
			return null
		}
	}

	async function fetchServer() {
		try {
			const r = await fetch(API)
			if (!r.ok) throw new Error('failed')
			const s = await r.json()
			save(s)
			return s
		} catch {
			return null
		}
	}

	const Rewards = {
		getState() {
			return load()
		},
		resetAll() {
			const s = { ...DEFAULT }
			save(s)
			return s
		},
		async award(type, amount, note) {
			if (!amount || amount <= 0) return this.getState()
			// optimistic local update
			let s = load()
			s.stars = Math.min(1000000, (s.stars || 0) + amount)
			pushHistory(s, type, amount, note)
			rollup(s)
			save(s)
			this.updateNav()
			// server sync
			const srv = await syncToServer({ action: 'award', type, amount, note })
			if (srv) {
				this.updateNav()
				return srv
			}
			return s
		},
		// Award 1 star the first time a pathname is visited
		async awardPageVisit(pathname) {
			const s = load()
			const key = pathname || location?.pathname || '/'
			if (s.visitedPages[key]) return s
			s.visitedPages[key] = true
			pushHistory(s, 'page_visit', 1, `First visit: ${key}`)
			s.stars += 1
			rollup(s)
			save(s)
			this.updateNav()
			// try server; if success, local is overwritten by server response via save
			const srv = await syncToServer({ action: 'visit', pathname: key })
			if (srv) {
				this.updateNav()
				return srv
			}
			return s
		},
		// Update nav counters if present
		updateNav() {
			try {
				const s = load()
				const el = document.getElementById('nav-rewards')
				if (el) {
					el.textContent = `☀️ ${s.suns} | ⭐ ${s.stars}`
				}
			} catch {}
		},
	}

	// expose globally
	window.Rewards = Rewards

	// Auto-award first-time visit and refresh nav on DOM ready
	const run = async () => {
		try {
			// fetch server state first to prime local
			await fetchServer()
			await Rewards.awardPageVisit(location.pathname)
			Rewards.updateNav()
		} catch {}
	}
	if (document.readyState === 'complete') run()
	else window.addEventListener('DOMContentLoaded', run)
})()

