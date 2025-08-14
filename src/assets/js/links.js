// Client-side Links page script: fetch, render, add, and delete links via /api/links

const grid = document.getElementById('links-grid')
const form = document.getElementById('add-link-form')
const inputUrl = document.getElementById('add-link-url')
const inputTitle = document.getElementById('add-link-title')

function hostFrom(url) {
	try {
		return new URL(url).host.replace(/^www\./, '')
	} catch {
		return url
	}
}

function s2Favicon(url) {
	try {
		const origin = new URL(url).origin
		return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(
			origin
		)}&sz=256`
	} catch {
		return '/favicon.ico'
	}
}

function renderEmpty(message = 'No links yet. Add your first!') {
	grid.innerHTML = `<div class="card" style="text-align:center;padding:1.25rem;">${message}</div>`
}

function cardTemplate(row) {
	const cover = row.favicon_url || s2Favicon(row.url)
	const title = row.title && row.title.trim() ? row.title : hostFrom(row.url)
	const host = hostFrom(row.url)
	const id = row.id
	return `
		<article class="link-card" data-id="${id}">
			<a class="cover" href="${row.url}" target="_blank" rel="noopener" style="background-image:url('${cover}')"></a>
			<div class="meta">
				<img class="fav" alt="" src="${cover}" loading="lazy" />
				<div>
					<a class="title" href="${row.url}" target="_blank" rel="noopener">${title}</a>
					<div class="host">${host}</div>
				</div>
				<button class="delete" title="Delete" aria-label="Delete" data-id="${id}">✕</button>
			</div>
		</article>
	`
}

async function loadLinks() {
	try {
		grid.innerHTML =
			'<div class="card" style="text-align:center;padding:1.25rem;">Loading…</div>'
		const res = await fetch('/api/links')
		if (!res.ok) throw new Error(await res.text())
		const data = await res.json()
		if (!Array.isArray(data) || data.length === 0) {
			renderEmpty()
			return
		}
		grid.innerHTML = data.map(cardTemplate).join('')
	} catch (e) {
		renderEmpty('Failed to load links.')
		console.error('links load error', e)
	}
}

async function addLink(evt) {
	evt.preventDefault()
	const url = inputUrl?.value?.trim()
	const title = inputTitle?.value?.trim()
	if (!url) return
	try {
		const res = await fetch('/api/links', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url, title }),
		})
		if (!res.ok) throw new Error(await res.text())
		const row = await res.json()
		// Prepend new card
		const html = cardTemplate(row)
		if (!grid.querySelector('.link-card')) grid.innerHTML = ''
		grid.insertAdjacentHTML('afterbegin', html)
		form.reset()
		inputUrl?.focus()
	} catch (e) {
		alert('Could not add link. ' + (e?.message || ''))
		console.error('add link error', e)
	}
}

async function onGridClick(evt) {
	const btn = evt.target.closest('button.delete')
	if (!btn) return
	const id = btn.dataset.id
	if (!id) return
	if (!confirm('Delete this link?')) return
	try {
		const res = await fetch(`/api/links?id=${encodeURIComponent(id)}`, {
			method: 'DELETE',
		})
		if (!res.ok && res.status !== 204) throw new Error(await res.text())
		const card = grid.querySelector(`.link-card[data-id="${CSS.escape(id)}"]`)
		card?.remove()
		if (!grid.querySelector('.link-card')) renderEmpty()
	} catch (e) {
		alert('Delete failed. ' + (e?.message || ''))
		console.error('delete link error', e)
	}
}

// Wire up
if (form) form.addEventListener('submit', addLink)
if (grid) grid.addEventListener('click', onGridClick)
// Load on first paint
if (grid) loadLinks()

