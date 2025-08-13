fetch('/quotes.json')
	.then((r) => r.json())
	.then((quotes) => {
		const q = quotes[Math.floor(Math.random() * quotes.length)]
		document.getElementById(
			'quote'
		).innerHTML = `<em>"${q.text}"</em><br><small>${q.author}</small>`
	})
	.catch(() => {
		document.getElementById('quote').textContent = 'Stay motivated!'
	})

