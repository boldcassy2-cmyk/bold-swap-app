export default async function handler(req, res) {
  // CORS setup for client-side requests
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, 0x-chain-id'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { path = '', ...queryParams } = req.query;
    const apiKey = process.env.VITE_ZEROX_API_KEY || process.env.ZEROX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'Missing ZEROX_API_KEY environment variable on server.' });
    }

    const query = new URLSearchParams(queryParams).toString();
    const targetUrl = `https://api.0x.org/${path}${query ? `?${query}` : ''}`;

    const chainId = req.headers['0x-chain-id'] || req.query.chainId || '8453';

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        '0x-api-key': apiKey,
        '0x-version': 'v2',
        '0x-chain-id': chainId.toString(),
        'Accept': 'application/json',
      },
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Proxy request failed', details: error.message });
  }
}