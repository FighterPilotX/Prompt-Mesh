// Serverless proxy — forwards browser requests to the Anthropic API.
// This eliminates CORS issues: the browser calls /.netlify/functions/ai-proxy
// (same origin), and this function calls api.anthropic.com server-to-server.
exports.handler = async function (event) {
  // Handle CORS preflight
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method not allowed' };
  }

  const apiKey = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  if (!apiKey) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Missing x-api-key header' } }),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version':
          event.headers['anthropic-version'] || '2023-06-01',
      },
      body: event.body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const responseText = await upstream.text();

    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: responseText,
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return {
      statusCode: isTimeout ? 504 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: isTimeout ? 'Request timed out — try a shorter prompt or lower token budget' : 'Proxy error: ' + err.message } }),
    };
  }
};
