// Cumulative Normal Distribution Function (Abramowitz & Stegun approximation)
function cnd(x) {
  const a1 = 0.319381530;
  const a2 = -0.356563782;
  const a3 = 1.781477937;
  const a4 = -1.821255978;
  const a5 = 1.330274429;
  const L = Math.abs(x);
  const k = 1.0 / (1.0 + 0.2316419 * L);
  let w = 1.0 - 1.0 / Math.sqrt(2 * Math.PI) * Math.exp(-L * L / 2) * (a1 * k + a2 * Math.pow(k, 2) + a3 * Math.pow(k, 3) + a4 * Math.pow(k, 4) + a5 * Math.pow(k, 5));
  
  if (x < 0) {
    w = 1.0 - w;
  }
  return w;
}

// Probability Density Function of standard normal distribution
function pdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Black-Scholes Model Engine
 * S = Spot price of underlying asset ($)
 * K = Strike price ($)
 * T = Time to maturity in years (e.g. 30 days = 30/365)
 * r = Risk-free interest rate (e.g. 0.05 for 5%)
 * v = Implied Volatility (e.g. 0.60 for 60% annualized volatility)
 */
export function calculateBlackScholes({ S, K, T, r = 0.05, v = 0.65 }) {
  if (S <= 0 || K <= 0 || T <= 0 || v <= 0) {
    return { callPrice: 0, putPrice: 0, deltaCall: 0, deltaPut: 0, gamma: 0, thetaCall: 0, vega: 0 };
  }

  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const d2 = d1 - v * Math.sqrt(T);

  const callPrice = S * cnd(d1) - K * Math.exp(-r * T) * cnd(d2);
  const putPrice = K * Math.exp(-r * T) * cnd(-d2) - S * cnd(-d1);

  // Greeks
  const deltaCall = cnd(d1);
  const deltaPut = deltaCall - 1;
  const gamma = pdf(d1) / (S * v * Math.sqrt(T));
  const vega = (S * pdf(d1) * Math.sqrt(T)) / 100; // Price change per 1% change in vol
  
  const thetaCall = (- (S * pdf(d1) * v) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * cnd(d2)) / 365;

  return {
    callPrice: Math.max(0, callPrice),
    putPrice: Math.max(0, putPrice),
    deltaCall,
    deltaPut,
    gamma,
    thetaCall,
    vega
  };
}