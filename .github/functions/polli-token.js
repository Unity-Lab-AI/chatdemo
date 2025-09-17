function readTokenFromEnvironment(context) {
  const envSources = [];
  if (context?.env) envSources.push(context.env);
  if (typeof process !== 'undefined' && process?.env) envSources.push(process.env);

  for (const env of envSources) {
    const candidate =
      env?.POLLI_TOKEN ??
      env?.VITE_POLLI_TOKEN ??
      env?.POLLINATIONS_TOKEN ??
      env?.VITE_POLLINATIONS_TOKEN ??
      null;
    if (candidate != null) {
      const value = String(candidate).trim();
      if (value) return value;
    }
  }
  return null;
}

export async function onRequest(context) {
  const token = readTokenFromEnvironment(context);
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
