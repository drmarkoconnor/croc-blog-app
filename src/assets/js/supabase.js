// Lightweight client init via ESM CDN
// Usage: include from layout or specific pages with type="module"
export async function initSupabase() {
	const url = window.ENV?.SUPABASE_URL || '{{ env.SUPABASE_URL }}'
	const key = window.ENV?.SUPABASE_ANON_KEY || '{{ env.SUPABASE_ANON_KEY }}'

	// If env isn't configured, gracefully operate in offline mode by returning null
	const missing =
		!url || !key || String(url).includes('{{') || String(key).includes('{{')
	if (missing) return null

	const { createClient } = await import(
		'https://esm.sh/@supabase/supabase-js@2'
	)
	return createClient(url, key)
}

