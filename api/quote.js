export default async function handler(req, res) {
  // 1. Enable CORS for your frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, 0x-api-key, 0x-version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 2. Extract query parameters passed from frontend
    const queryParams = new URLSearchParams(req.query).toString();
    const targetUrl = `https://api.0x.org/swap/permit2/quote?${queryParams}`;

    // 3. Get API Key from Vercel environment variables
    const apiKey = process.env.VITE_ZEROX_API_KEY || process.env.ZEROX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing 0x API Key in Vercel environment variables" });
    }

    // 4. Fetch quote from 0x API with v2 headers
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        '0x-api-key': apiKey,
        '0x-version': 'v2'
      }
    });

    const data = await response.json();

    // 5. Pass response status and data back to frontend
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Proxy Execution Error:", error);
    return res.status(500).json({ error: "Internal Proxy Error", details: error.message });
  }
}