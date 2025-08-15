export default async (request, context) => {
  const user = process.env.SITE_BASIC_AUTH_USER || 'youruser'
  const pass = process.env.SITE_BASIC_AUTH_PASS || 'yourpass'
  const bypass = [
    '/robots.txt',
  ]
  const url = new URL(request.url)
  // Allow Netlify functions and static assets to flow; browser will re-use auth automatically after first success
  if (
    url.pathname.startsWith('/.netlify/functions/') ||
    url.pathname.startsWith('/assets/') ||
    bypass.includes(url.pathname)
  ) {
    return context.next()
  }
  const auth = request.headers.get('authorization') || ''
  const expected = 'Basic ' + btoa(`${user}:${pass}`)
  if (auth === expected) {
    return context.next()
  }
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Site"' },
  })
}
