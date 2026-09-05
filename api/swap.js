export default async function handler(req, res) {
  // 1. Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. Destructure query parameters
  const { 
    sellToken, 
    buyToken, 
    sellAmount, 
    taker, 
    chainId = '8453', // Default to Base (8453) instead of Ethereum Mainnet (1)
    swapFeeRecipient,
    swapFeeBps,
    swapFeeToken
  } = req.query;

  // 3. Validate required query parameters
  if (!sellToken || !buyToken || !sellAmount || !taker) {
    return res.status(400).json({
      error: 'Missing required parameters: sellToken, buyToken, sellAmount, and taker are required.',
    });
  }

  // 4. Check for 0x API key configuration
  if (!process.env.ZEROX_API_KEY) {
    return res.status(500).json({ error: 'ZEROX_API_KEY environment variable is not configured on the server.' });
  }

  try {
    // 5. Build query params (excluding chainId, as 0x v2 takes chainId in headers)
    const queryParams = new URLSearchParams({
      sellToken,
      buyToken,
      sellAmount,
      taker,
    });

    // Forward affiliate fee parameters if present
    if (swapFeeRecipient) queryParams.append('swapFeeRecipient', swapFeeRecipient);
    if (swapFeeBps) queryParams.append('swapFeeBps', swapFeeBps);
    if (swapFeeToken) queryParams.append('swapFeeToken', swapFeeToken);

    // 6. Make request to 0x v2 API with chainId passed as '0x-chain-id' header
    const response = await fetch(`https://api.0x.org/swap/permit2/quote?${queryParams.toString()}`, {
      headers: {
        '0x-api-key': process.env.ZEROX_API_KEY,
        '0x-version': 'v2',
        '0x-chain-id': String(chainId), // <-- CRITICAL FIX: chainId belongs in headers
      },
    });

    const data = await response.json();

    // 7. Handle errors from 0x API
    if (!response.ok) {
      return res.status(response.status).json({
        error: '0x API Request Failed',
        details: data,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}