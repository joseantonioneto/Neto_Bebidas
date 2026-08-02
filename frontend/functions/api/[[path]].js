const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function cleanBackendUrl(value) {
  return value ? value.replace(/\/+$/, '') : '';
}

function getProxyPath(pathParam) {
  if (Array.isArray(pathParam)) return pathParam.join('/');
  return pathParam || '';
}

export async function onRequest({ request, env, params }) {
  const backendUrl = cleanBackendUrl(env.BACKEND_URL);

  if (!backendUrl) {
    return Response.json(
      { detail: 'BACKEND_URL nao configurada no Cloudflare Pages.' },
      { status: 503 }
    );
  }

  const incomingUrl = new URL(request.url);
  const proxyPath = getProxyPath(params.path);
  const targetUrl = new URL(`${backendUrl}/${proxyPath}`);
  targetUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);
  headers.delete('host');

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual'
  });

  const responseHeaders = new Headers(response.headers);
  for (const header of hopByHopHeaders) responseHeaders.delete(header);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}
