// Serverless proxy — forwards browser requests to the Anthropic API.
// This eliminates CORS issues: the browser calls /.netlify/functions/ai-proxy
// (same origin), and this function calls api.anthropic.com server-to-server.
// Uses Netlify Functions v2 format so `config.timeout` sets the 26s limit.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'Missing x-api-key header' } }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const body = await request.text();
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const responseText = await upstream.text();

    return new Response(responseText, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return new Response(
      JSON.stringify({ error: { message: isTimeout
        ? 'Request timed out — try a shorter prompt or lower token budget'
        : 'Proxy error: ' + err.message } }),
      { status: isTimeout ? 504 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

export const config = { timeout: 26 };
