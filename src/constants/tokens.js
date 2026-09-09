// src/constants/tokens.js

export const SUPPORTED_TOKENS = [
  {
    symbol: "ETH",
    name: "Ethereum",
    address: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE", // 0x Native ETH flag
    decimals: 18,
    logoURI: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: import.meta.env.VITE_WBTC_ETHEREUM || "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    decimals: 8, // NOTE: WBTC uses 8 decimals, not 18!
    logoURI: "https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_yellow.png",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    logoURI: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
  },
];