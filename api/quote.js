export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const queryString = new URLSearchParams(req.query).toString();
    const targetUrl = `https://api.0x.org/swap/permit2/quote?${queryString}`;

    const apiKey = process.env.VITE_ZEROX_API_KEY || process.env.ZEROX_API_KEY;

    // The backend makes the request with BOTH required headers safely
    const response = await fetch(targetUrl, {
      headers: {
        '0x-api-key': apiKey,
        '0x-version': 'v2'
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const queryString = new URLSearchParams(req.query).toString();
    const targetUrl = `https://api.0x.org/swap/permit2/quote?${queryString}`;

    const apiKey = process.env.VITE_ZEROX_API_KEY || process.env.ZEROX_API_KEY;

    // The backend makes the request with BOTH required headers safely
    const response = await fetch(targetUrl, {
      headers: {
        '0x-api-key': apiKey,
        '0x-version': 'v2'
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}