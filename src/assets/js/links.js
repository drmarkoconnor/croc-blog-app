async function fetchLinks() {
	const res = await fetch('/api/links')
	if (!res.ok) throw new Error('failed to load links')
	return res.json()
}

async function addLink(url) {
	const res = await fetch('/api/links', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url }),
	})
	if (!res.ok) throw new Error('failed to add link')
	return res.json()
}

async function deleteLink(id) {
	const res = await fetch(`/api/links?id=${encodeURIComponent(id)}`, {
		method: 'DELETE',
	})
	if (!res.ok) throw new Error('failed to delete link')
}

function cardTemplate(item) {
	const u = new URL(item.url)
	const title = item.title || u.hostname
	const bg = item.favicon_url || `${u.origin}/favicon.ico`
	return `
  <article class="link-card" data-id="${item.id}">
    <a href="${item.url}" target="_blank" rel="noopener" class="cover" style="background-image:url('${bg}')"></a>
    <div class="meta">
      <img class="fav" src="${bg}" alt="" onerror="this.style.display='none'"/>
      <div class="text">
        <a href="${item.url}" target="_blank" rel="noopener" class="title">${title}</a>
        <div class="host">${u.hostname}</div>
      </div>
      <button class="delete" title="Remove">✕</button>
    </div>
  </article>`
}

function bindHandlers(root) {
	root.addEventListener('click', async (e) => {
		const delBtn = e.target.closest('.delete')
		if (delBtn) {
			const card = delBtn.closest('.link-card')
			const id = card?.dataset?.id
			if (id) {
				await deleteLink(id)
				card.remove()
			}
		}
	})
}

async function initLinks() {
	const form = document.getElementById('add-link-form')
	const input = document.getElementById('add-link-url')
	const grid = document.getElementById('links-grid')
	bindHandlers(grid)
	const items = await fetchLinks()
	grid.innerHTML = items.map(cardTemplate).join('')
	form.addEventListener('submit', async (e) => {
		e.preventDefault()
		const url = (input.value || '').trim()
		if (!url) return
		const created = await addLink(url)
		grid.insertAdjacentHTML('afterbegin', cardTemplate(created))
		input.value = ''
	})
}

if (typeof window !== 'undefined') {
	window.addEventListener('DOMContentLoaded', () => {
		const el = document.getElementById('links-grid')
		if (el) initLinks().catch(console.error)
	})
}

