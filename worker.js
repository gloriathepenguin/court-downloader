/**
 * Cloudflare Workers 代理脚本
 * 部署步骤：
 * 1. 登录 https://workers.cloudflare.com
 * 2. 新建 Worker，粘贴此代码，点击 Save and Deploy
 * 3. 将 Worker 地址填入网页的代理设置中
 *
 * 用法：代理 URL 格式为  https://your-worker.workers.dev/{encodeURIComponent(targetUrl)}
 */

const ALLOWED_HOST = 'zxfw.court.gov.cn'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Accept-Language, DNT, Referer, Origin',
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const url = new URL(request.url)

  // The target URL is everything after the first '/' in the path (URL-encoded)
  // e.g. /https%3A%2F%2Fzxfw.court.gov.cn%2F...
  let targetUrl = url.pathname.slice(1)       // remove leading '/'
  if (targetUrl.startsWith('http')) {
    // already a raw URL (not encoded) - use as-is
  } else {
    targetUrl = decodeURIComponent(targetUrl)
  }

  // Also support ?url= query param as fallback
  if (!targetUrl || !targetUrl.startsWith('http')) {
    targetUrl = url.searchParams.get('url') || ''
  }

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing target URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    })
  }

  // Security: only proxy requests to the court domain
  let targetHost
  try {
    targetHost = new URL(targetUrl).hostname
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    })
  }

  const allowedHosts = [ALLOWED_HOST, '.aliyuncs.com', '.aliyun-inc.com']
  const hostOk = allowedHosts.some(h => targetHost === h || targetHost.endsWith(h))
  if (!hostOk) {
    return new Response(JSON.stringify({ error: 'Forbidden host: ' + targetHost }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    })
  }

  // Forward the request
  const proxyHeaders = new Headers()
  const isCourtHost = targetHost === ALLOWED_HOST
  if (isCourtHost) {
    // Copy safe headers from the original request
    const allowedReqHeaders = ['content-type', 'accept', 'accept-language']
    for (const [k, v] of request.headers.entries()) {
      if (allowedReqHeaders.includes(k.toLowerCase())) {
        proxyHeaders.set(k, v)
      }
    }
    // Set browser-like headers to satisfy the court API
    proxyHeaders.set('Origin', 'https://zxfw.court.gov.cn')
    proxyHeaders.set('Referer', 'https://zxfw.court.gov.cn/zxfw/')
    proxyHeaders.set('User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36')
  }
  // OSS 预签名 URL：不加任何额外 header，避免破坏签名验证

  const proxyReq = new Request(targetUrl, {
    method: request.method,
    headers: proxyHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD'
      ? request.body
      : undefined,
  })

  try {
    const resp = await fetch(proxyReq)
    const respHeaders = new Headers(resp.headers)
    // Inject CORS headers
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      respHeaders.set(k, v)
    }
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    })
  }
}
