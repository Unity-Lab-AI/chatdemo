export async function onRequest(context) {
  const token = context?.env?.POLLI_TOKEN ?? context?.env?.VITE_POLLI_TOKEN ?? null;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Pollinations token is not configured.' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Robots-Tag': 'noindex',
    },
  });
}
