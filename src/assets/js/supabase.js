// Lightweight client init via ESM CDN
// Usage: include from layout or specific pages with type="module"
export async function initSupabase() {
	const { createClient } = await import(
		'https://esm.sh/@supabase/supabase-js@2'
	)
	const url = window.ENV?.SUPABASE_URL || '{{ env.SUPABASE_URL }}'
	const key = window.ENV?.SUPABASE_ANON_KEY || '{{ env.SUPABASE_ANON_KEY }}'
	return createClient(url, key)
}

