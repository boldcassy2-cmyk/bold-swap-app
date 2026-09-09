import { calculateBlackScholes } from './blackScholes';

/**
 * Calculates Vega for Black-Scholes model
 */
function getVega(S, K, T, r, v) {
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const nPrime = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * d1 * d1);
  return S * Math.sqrt(T) * nPrime;
}

/**
 * Newton-Raphson Implied Volatility Solver
 * @param {Object} params
 * @param {number} params.targetPrice - Market price of option
 * @param {number} params.S - Spot Price
 * @param {number} params.K - Strike Price
 * @param {number} params.T - Time to expiry (years)
 * @param {number} params.r - Risk-free interest rate (decimal)
 * @param {string} params.optionType - 'call' or 'put'
 * @returns {number|null} Implied Volatility in percentage (e.g., 45.2)
 */
export function solveImpliedVolatility({ targetPrice, S, K, T, r, optionType = 'call' }) {
  if (targetPrice <= 0 || S <= 0 || K <= 0 || T <= 0) return null;

  let sigma = 0.50; // Initial guess: 50% volatility
  const maxIterations = 100;
  const tolerance = 1e-5;

  for (let i = 0; i < maxIterations; i++) {
    const bs = calculateBlackScholes({ S, K, T, r, v: sigma });
    const currentPrice = optionType === 'call' ? bs.callPrice : bs.putPrice;
    const diff = currentPrice - targetPrice;

    if (Math.abs(diff) < tolerance) {
      return sigma * 100; // Return as percentage
    }

    const vega = getVega(S, K, T, r, sigma);

    if (vega < 1e-8) {
      // Avoid division by near-zero vega
      break;
    }

    sigma = sigma - diff / vega;

    // Keep sigma within sensible boundaries
    if (sigma <= 0.0001) sigma = 0.0001;
    if (sigma > 5.0) sigma = 5.0; // Max 500% IV
  }

  return sigma * 100;
}