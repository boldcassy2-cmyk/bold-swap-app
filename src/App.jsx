import { useState, useEffect, useRef } from 'react';
import { BrowserProvider, Contract, parseUnits, formatUnits, isAddress } from 'ethers';
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';
import { calculateBlackScholes } from './utils/blackScholes';
import { solveImpliedVolatility } from './utils/ivSolver';
import PayoffChart from './components/PayoffChart';

const MY_FEE_RECIPIENT = "0xfa06f50dFC00D333D29f56862a19d5a1c4F87490"; 
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const QUOTE_EXPIRY_SECONDS = 30;

const DEFAULT_TOKENS = [
  { symbol: "ETH", name: "Ethereum", address: NATIVE_ETH, decimals: 18, coingeckoId: "ethereum" },
  { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, coingeckoId: "usd-coin" },
  { symbol: "USDT", name: "Tether USD", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, coingeckoId: "tether" },
  { symbol: "DAI", name: "Dai Stablecoin", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, coingeckoId: "dai" },
  { symbol: "BRETT", name: "Brett", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18, coingeckoId: "based-brett" }
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const getTokenLogo = (address) => {
  if (address.toLowerCase() === NATIVE_ETH.toLowerCase()) {
    return "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png";
  }
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${address}/logo.png`;
};

function TokenImage({ token, size = "w-6 h-6" }) {
  const [error, setError] = useState(false);

  if (error || !token.address) {
    return (
      <div className={`${size} rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-[10px] shrink-0`}>
        {token.symbol.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={getTokenLogo(token.address)}
      alt={token.symbol}
      className={`${size} rounded-full object-cover bg-slate-800 shrink-0`}
      onError={() => setError(true)}
    />
  );
}

function App() {
  const { address: account, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const [tokens, setTokens] = useState(DEFAULT_TOKENS);
  const [sellToken, setSellToken] = useState(DEFAULT_TOKENS[0]);
  const [buyToken, setBuyToken] = useState(DEFAULT_TOKENS[1]);
  const [sellAmount, setSellAmount] = useState('0.005');
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const [lastTxHash, setLastTxHash] = useState(null);
  const [txHistory, setTxHistory] = useState([]);

  // Execution Order Type State: market, limit, or stop
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');

  // Token Approval & Allowance State
  const [needApproval, setNeedApproval] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // Custom Import & Modals State
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('sell');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Black-Scholes Options & Newton-Raphson IV State
  const [bsModalOpen, setBsModalOpen] = useState(false);
  const [spotPrice, setSpotPrice] = useState(3000);
  const [strikePrice, setStrikePrice] = useState(3000);
  const [daysToExpiry, setDaysToExpiry] = useState(30);
  const [volatility, setVolatility] = useState(50);
  const [riskFreeRate, setRiskFreeRate] = useState(5);
  const [selectedOptionType, setSelectedOptionType] = useState('call');
  const [targetOptionPrice, setTargetOptionPrice] = useState('');
  const [solvedIv, setSolvedIv] = useState(null);

  const [timeLeft, setTimeLeft] = useState(QUOTE_EXPIRY_SECONDS);
  const timerRef = useRef(null);

  // Balances
  const { data: sellBalanceData } = useBalance({
    address: account,
    token: sellToken.address.toLowerCase() === NATIVE_ETH.toLowerCase() ? undefined : sellToken.address,
    watch: true,
  });

  const { data: buyBalanceData } = useBalance({
    address: account,
    token: buyToken.address.toLowerCase() === NATIVE_ETH.toLowerCase() ? undefined : buyToken.address,
    watch: true,
  });

  // Balance Check
  const hasInsufficientBalance = Boolean(
    sellBalanceData &&
    sellAmount &&
    Number(sellAmount) > Number(sellBalanceData.formatted)
  );

  // Load Saved Tokens & History
  useEffect(() => {
    const savedTokens = localStorage.getItem('custom_dex_tokens');
    if (savedTokens) {
      try {
        setTokens([...DEFAULT_TOKENS, ...JSON.parse(savedTokens)]);
      } catch (e) {
        console.error("Failed to load custom tokens", e);
      }
    }

    const savedHistory = localStorage.getItem('dex_tx_history');
    if (savedHistory) {
      try {
        setTxHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  // Clear Quote on Parameter Change
  useEffect(() => {
    setQuote(null);
    setNeedApproval(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, [sellToken, buyToken, sellAmount, slippage, orderType, limitPrice, stopPrice]);

  // Quote Expiry Timer
  useEffect(() => {
    if (!quote) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    setTimeLeft(QUOTE_EXPIRY_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          fetchQuote(true);
          return QUOTE_EXPIRY_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [quote?.buyAmount, quote?.sellAmount]);

  // Check Allowance When Quote Loaded
  useEffect(() => {
    const checkAllowance = async () => {
      if (!quote || !account || sellToken.address.toLowerCase() === NATIVE_ETH.toLowerCase()) {
        setNeedApproval(false);
        return;
      }

      if (quote.issues?.allowance?.spender && window.ethereum) {
        try {
          const provider = new BrowserProvider(window.ethereum);
          const tokenContract = new Contract(sellToken.address, ERC20_ABI, provider);
          const requiredAmount = parseUnits(sellAmount, sellToken.decimals);
          const currentAllowance = await tokenContract.allowance(account, quote.issues.allowance.spender);

          setNeedApproval(BigInt(currentAllowance) < BigInt(requiredAmount));
        } catch (err) {
          console.error("Allowance check error:", err);
        }
      }
    };

    checkAllowance();
  }, [quote, account, sellToken, sellAmount]);

  // Import Custom Token via Contract Address
  useEffect(() => {
    const checkAndImportToken = async () => {
      const cleanQuery = searchQuery.trim();
      setImportError('');

      if (!isAddress(cleanQuery)) return;

      const exists = tokens.some(t => t.address.toLowerCase() === cleanQuery.toLowerCase());
      if (exists) return;

      if (!window.ethereum) {
        setImportError("Ethereum provider missing.");
        return;
      }

      setImporting(true);
      try {
        const provider = new BrowserProvider(window.ethereum);
        const tokenContract = new Contract(cleanQuery, ERC20_ABI, provider);

        const [symbol, name, decimals] = await Promise.all([
          tokenContract.symbol(),
          tokenContract.name(),
          tokenContract.decimals()
        ]);

        const newToken = {
          symbol: String(symbol),
          name: String(name),
          address: cleanQuery,
          decimals: Number(decimals),
          isCustom: true
        };

        const existingCustom = JSON.parse(localStorage.getItem('custom_dex_tokens') || '[]');
        const updatedCustom = [...existingCustom, newToken];
        localStorage.setItem('custom_dex_tokens', JSON.stringify(updatedCustom));

        setTokens((prev) => [...prev, newToken]);
        setSearchQuery('');
      } catch (err) {
        console.error("Token fetch error:", err);
        setImportError("Could not fetch ERC-20 token info.");
      } finally {
        setImporting(false);
      }
    };

    checkAndImportToken();
  }, [searchQuery, tokens]);

  // Solves IV directly from target market option price using Newton-Raphson
  const handleSolveIV = () => {
    if (!targetOptionPrice || Number(targetOptionPrice) <= 0) {
      setSolvedIv(null);
      return;
    }

    const iv = solveImpliedVolatility({
      targetPrice: Number(targetOptionPrice),
      S: Number(spotPrice),
      K: Number(strikePrice),
      T: Math.max(0.001, Number(daysToExpiry) / 365),
      r: Number(riskFreeRate) / 100,
      optionType: selectedOptionType
    });

    if (iv !== null) {
      setSolvedIv(iv.toFixed(2));
      setVolatility(Math.round(iv));
    } else {
      setSolvedIv("Unable to converge");
    }
  };

  // Compute Black-Scholes Pricing & Greeks
  const bsResults = calculateBlackScholes({
    S: Number(spotPrice) || 1,
    K: Number(strikePrice) || 1,
    T: Math.max(0.001, (Number(daysToExpiry) || 1) / 365),
    r: (Number(riskFreeRate) || 0) / 100,
    v: (Number(volatility) || 1) / 100
  });

  // Flip Tokens
  const handleSwitchTokens = () => {
    const prevSell = sellToken;
    const prevBuy = buyToken;
    setSellToken(prevBuy);
    setBuyToken(prevSell);
  };

  const selectToken = (token) => {
    if (modalMode === 'sell') {
      setSellToken(token);
      if (token.address === buyToken.address) setBuyToken(sellToken);
    } else {
      setBuyToken(token);
      if (token.address === sellToken.address) setSellToken(buyToken);
    }
    setModalOpen(false);
    setSearchQuery('');
  };

  const handleMaxClick = () => {
    if (!sellBalanceData) return;
    const rawBalance = Number(sellBalanceData.formatted);

    if (sellToken.address.toLowerCase() === NATIVE_ETH.toLowerCase()) {
      const maxEth = Math.max(0, rawBalance - 0.002);
      setSellAmount(maxEth > 0 ? maxEth.toFixed(6) : '0');
    } else {
      setSellAmount(rawBalance.toString());
    }
  };

  const fetchQuote = async (isRefresh = false) => {
    if (!isConnected || !account) {
      setWalletModalOpen(true);
      return;
    }

    if (!sellAmount || Number(sellAmount) <= 0) {
      setStatus("Please enter a valid sell amount.");
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setQuote(null);
    }

    setStatus(isRefresh ? "Refreshing quote..." : "Fetching optimal route...");
    setLastTxHash(null);

    try {
      const sellAmountWei = parseUnits(sellAmount, sellToken.decimals).toString();
      const slippageBps = Math.round(parseFloat(slippage || '0.5') * 100).toString();

      const queryParams = {
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: sellAmountWei,
        taker: account,
        chainId: "8453",
        slippageBps: slippageBps
      };

      if (orderType === 'limit' && limitPrice) {
        queryParams.price = limitPrice;
      }

      if (MY_FEE_RECIPIENT && isAddress(MY_FEE_RECIPIENT)) {
        queryParams.swapFeeRecipient = MY_FEE_RECIPIENT;
        queryParams.swapFeeBps = "50";
        queryParams.swapFeeToken = buyToken.address;
      }

      const params = new URLSearchParams(queryParams);

// 1. Get your 0x API key from .env
const apiKey = import.meta.env.VITE_ZEROX_API_KEY;

// 2. Fetch directly from official 0x API with v2 headers
const quoteUrl = `https://api.0x.org/swap/permit2/quote?${params.toString()}`;
const response = await fetch(quoteUrl, {
  headers: {
    "0x-api-key": apiKey,
  },
});

const contentType = response.headers.get("content-type");
if (!contentType || !contentType.includes("application/json")) {
  const rawText = await response.text();
  throw new Error(`Server response error (${response.status}): ${rawText.slice(0, 100)}`);
}

      const data = await response.json();

      if (!response.ok || data.errors || data.reason) {
        const errorMsg = data.details?.reason || data.reason || data.message || `API Error ${response.status}`;
        throw new Error(errorMsg);
      }

      setQuote(data);
      setTimeLeft(QUOTE_EXPIRY_SECONDS);
      setStatus(orderType === 'limit' ? "Limit order prepared!" : "Quote updated!");
    } catch (err) {
      console.error("Quote Error:", err);
      setStatus(`Quote Error: ${err.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const approveToken = async () => {
    if (!quote?.issues?.allowance?.spender || !window.ethereum) return;
    setIsApproving(true);
    setStatus(`Approving ${sellToken.symbol}...`);

    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const requiredAmount = parseUnits(sellAmount, sellToken.decimals);
      const tokenContract = new Contract(sellToken.address, ERC20_ABI, signer);

      const tx = await tokenContract.approve(quote.issues.allowance.spender, requiredAmount);
      await tx.wait();

      setNeedApproval(false);
      setStatus(`${sellToken.symbol} Approved! You can now execute the order.`);
    } catch (err) {
      console.error("Approval Error:", err);
      setStatus(`Approval Failed: ${err.reason || err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const executeSwap = async () => {
    if (!quote?.transaction || !window.ethereum) return;
    setLoading(true);
    setLastTxHash(null);
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      setStatus('Awaiting wallet signature...');
      
      const txParams = {
        to: quote.transaction.to,
        data: quote.transaction.data,
        value: quote.transaction.value ? BigInt(quote.transaction.value) : 0n
      };

      if (quote.transaction.gas) {
        txParams.gasLimit = BigInt(quote.transaction.gas);
      }

      const tx = await signer.sendTransaction(txParams);
      setLastTxHash(tx.hash);
      setStatus(`Tx submitted... Waiting on Base network confirmation.`);

      await tx.wait();

      setStatus('Order executed successfully! 🎉');

      const newTxRecord = {
        hash: tx.hash,
        type: orderType.toUpperCase(),
        sellSymbol: sellToken.symbol,
        buySymbol: buyToken.symbol,
        sellAmount: sellAmount,
        buyAmount: formatUnits(quote.buyAmount, buyToken.decimals),
        timestamp: new Date().toLocaleTimeString()
      };

      const updatedHistory = [newTxRecord, ...txHistory.slice(0, 9)];
      setTxHistory(updatedHistory);
      localStorage.setItem('dex_tx_history', JSON.stringify(updatedHistory));

      setQuote(null);
    } catch (err) {
      console.error("Execution Error:", err);
      if (err.code === 4001 || err?.info?.error?.code === 4001 || err?.code === 'ACTION_REJECTED') {
        setStatus('Transaction rejected in wallet.');
      } else {
        setStatus(`Execution failed: ${err.reason || err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredTokens = tokens.filter(t => 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.address.toLowerCase() === searchQuery.trim().toLowerCase()
  );

  const progressPercent = (timeLeft / QUOTE_EXPIRY_SECONDS) * 100;
  const priceImpactVal = quote?.estimatedPriceImpact ? Number(quote.estimatedPriceImpact) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Bold Terminal</h1>
            <button 
              onClick={() => setBsModalOpen(true)}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer text-sm"
              title="Black-Scholes & IV Solver"
            >
              📈
            </button>
            <button 
              onClick={() => setSettingsModalOpen(true)}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer text-sm"
              title="Slippage Settings"
            >
              ⚙️
            </button>
            <button 
              onClick={() => setHistoryModalOpen(true)}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer text-sm"
              title="Transaction History"
            >
              📜
            </button>
          </div>

          {!isConnected ? (
            <button 
              onClick={() => setWalletModalOpen(true)} 
              className="bg-indigo-600 hover:bg-indigo-500 text-xs font-bold py-2 px-3 rounded-xl cursor-pointer transition-colors shadow-lg shadow-indigo-500/20"
            >
              Connect Wallet
            </button>
          ) : (
            <button 
              onClick={() => disconnect()}
              className="text-xs font-mono text-cyan-400 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl border border-slate-700 cursor-pointer transition-colors"
            >
              {account?.slice(0, 6)}...{account?.slice(-4)}
            </button>
          )}
        </div>

        {/* Order Type Selector */}
        <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl mb-4 border border-slate-800 font-mono text-xs">
          {['market', 'limit', 'stop'].map((type) => (
            <button
              key={type}
              onClick={() => setOrderType(type)}
              className={`py-1.5 rounded-lg capitalize font-bold transition-all cursor-pointer ${
                orderType === type
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Limit / Stop Price Inputs */}
        {orderType !== 'market' && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4 space-y-1 font-mono">
            <div className="flex justify-between text-xs text-slate-400">
              <span>{orderType === 'limit' ? 'Target Limit Price' : 'Stop-Loss Price'}</span>
              <span>In {buyToken.symbol}</span>
            </div>
            <input
              type="number"
              placeholder={`Enter ${orderType} price...`}
              value={orderType === 'limit' ? limitPrice : stopPrice}
              onChange={(e) => orderType === 'limit' ? setLimitPrice(e.target.value) : setStopPrice(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}

        {/* You Pay Box */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
            <span>You Pay</span>
            {isConnected && (
              <div className="flex items-center gap-1.5 font-mono">
                <span>Balance: {sellBalanceData ? Number(sellBalanceData.formatted).toFixed(4) : '0.00'}</span>
                <button
                  onClick={handleMaxClick}
                  className="bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                >
                  MAX
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="number" 
              value={sellAmount} 
              onChange={(e) => setSellAmount(e.target.value)}
              className="w-full bg-transparent text-2xl font-bold focus:outline-none"
              placeholder="0.0"
            />
            <button 
              onClick={() => { setModalMode('sell'); setModalOpen(true); }}
              className="bg-slate-800 hover:bg-slate-700 text-sm font-bold border border-slate-700 rounded-xl px-3 py-1.5 cursor-pointer flex items-center gap-2 transition-colors shrink-0"
            >
              <TokenImage token={sellToken} size="w-5 h-5" />
              <span>{sellToken.symbol}</span>
              <span className="text-xs text-slate-400">▼</span>
            </button>
          </div>
        </div>

        {/* Switch Tokens Button */}
        <div className="flex justify-center -my-3 z-10 relative">
          <button
            type="button"
            onClick={handleSwitchTokens}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-400 p-2 rounded-xl transition-all cursor-pointer shadow-lg hover:scale-110 active:scale-95"
            title="Switch Direction"
          >
            ⇅
          </button>
        </div>

        {/* You Receive Box */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4">
          <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
            <span>You Receive (Estimated)</span>
            {isConnected && (
              <span className="font-mono">
                Balance: {buyBalanceData ? Number(buyBalanceData.formatted).toFixed(4) : '0.00'}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold text-emerald-400">
              {quote ? Number(formatUnits(quote.buyAmount, buyToken.decimals)).toFixed(4) : '0.00'}
            </span>
            <button 
              onClick={() => { setModalMode('buy'); setModalOpen(true); }}
              className="bg-slate-800 hover:bg-slate-700 text-sm font-bold border border-slate-700 rounded-xl px-3 py-1.5 cursor-pointer flex items-center gap-2 transition-colors shrink-0"
            >
              <TokenImage token={buyToken} size="w-5 h-5" />
              <span>{buyToken.symbol}</span>
              <span className="text-xs text-slate-400">▼</span>
            </button>
          </div>
        </div>

        {/* High Price Impact Alert */}
        {priceImpactVal > 2 && (
          <div className={`p-3 rounded-xl border text-xs font-mono mb-3 ${
            priceImpactVal > 5 
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' 
              : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
          }`}>
            ⚠️ High Price Impact: <strong>{priceImpactVal.toFixed(2)}%</strong>. High slippage loss expected!
          </div>
        )}

        {/* Slippage & Gas Summary */}
        <div className="flex justify-between items-center text-xs text-slate-400 px-1 mb-3 font-mono">
          <span>Slippage: <strong className="text-indigo-400">{slippage}%</strong></span>
          {quote?.transaction?.gas && (
            <span>Est. Gas: <strong className="text-slate-200">~${(Number(quote.transaction.gas) * 0.00000002).toFixed(4)}</strong></span>
          )}
        </div>

        {/* Dynamic Action Button */}
        {!isConnected ? (
          <button 
            onClick={() => setWalletModalOpen(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl mb-3 cursor-pointer transition-colors shadow-lg shadow-indigo-500/20"
          >
            Connect Wallet
          </button>
        ) : !sellAmount || Number(sellAmount) <= 0 ? (
          <button 
            disabled 
            className="w-full bg-slate-800 text-slate-500 font-bold py-3 rounded-xl mb-3"
          >
            Enter Amount
          </button>
        ) : hasInsufficientBalance ? (
          <button 
            disabled 
            className="w-full bg-rose-900/40 border border-rose-800/50 text-rose-400 font-bold py-3 rounded-xl mb-3 cursor-not-allowed"
          >
            Insufficient {sellToken.symbol} Balance
          </button>
        ) : !quote ? (
          <button 
            onClick={() => fetchQuote(false)} 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-3 rounded-xl mb-3 cursor-pointer transition-colors shadow-lg shadow-emerald-600/20"
          >
            {loading ? 'Fetching Route...' : `Submit ${orderType.toUpperCase()} Order`}
          </button>
        ) : needApproval ? (
          <button 
            onClick={approveToken}
            disabled={isApproving}
            className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-xl mb-3 cursor-pointer transition-colors shadow-lg shadow-amber-600/20"
          >
            {isApproving ? `Approving ${sellToken.symbol}...` : `Approve ${sellToken.symbol}`}
          </button>
        ) : (
          <button 
            onClick={executeSwap}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-bold py-3 rounded-xl mb-3 cursor-pointer transition-colors shadow-lg shadow-indigo-600/20"
          >
            {loading ? 'Processing Order...' : `Execute ${orderType.toUpperCase()} Order`}
          </button>
        )}

        {/* Active Quote Timer */}
        {quote && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-3 space-y-2">
            <div className="flex justify-between items-center text-xs font-mono text-slate-400">
              <span>Quote Refresh: <strong className="text-amber-400">{timeLeft}s</strong></span>
              <button 
                type="button"
                onClick={() => fetchQuote(true)}
                disabled={refreshing || loading}
                className="text-indigo-400 hover:text-indigo-300 disabled:text-slate-600 underline cursor-pointer"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
              <div 
                className="bg-amber-400 h-full transition-all duration-1000 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Status Toast & BaseScan Link */}
        {status && (
          <div className="mt-3 text-center">
            <p className="text-xs text-amber-400 font-mono break-words">{status}</p>
            {lastTxHash && (
              <a 
                href={`https://basescan.org/tx/${lastTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-xs font-mono text-indigo-400 hover:text-indigo-300 underline"
              >
                View on BaseScan ↗
              </a>
            )}
          </div>
        )}
      </div>

      {/* BLACK-SCHOLES & NEWTON-RAPHSON IV SOLVER MODAL */}
      {bsModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-2xl p-5 shadow-2xl space-y-4 my-8">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-bold bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
                Black-Scholes & Newton-Raphson IV Solver
              </h2>
              <button onClick={() => setBsModalOpen(false)} className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer">✕</button>
            </div>

            {/* Newton-Raphson IV Direct Solver Panel */}
            <div className="bg-slate-950 border border-cyan-500/30 rounded-xl p-3 space-y-2 font-mono">
              <span className="text-xs font-bold text-cyan-400 block">⚡ Solve Implied Volatility from Market Price</span>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Market Option Price ($)"
                  value={targetOptionPrice}
                  onChange={(e) => setTargetOptionPrice(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={handleSolveIV}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs px-3 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Solve IV
                </button>
              </div>
              {solvedIv && (
                <p className="text-xs text-emerald-400 font-bold">
                  Solved Implied Volatility: <span className="text-white">{solvedIv}%</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 font-mono">Spot Price ($)</label>
                <input
                  type="number"
                  value={spotPrice}
                  onChange={(e) => setSpotPrice(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs font-mono mt-1 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-mono">Strike Price ($)</label>
                <input
                  type="number"
                  value={strikePrice}
                  onChange={(e) => setStrikePrice(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs font-mono mt-1 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 font-mono">Days to Expiry</label>
                <input
                  type="number"
                  value={daysToExpiry}
                  onChange={(e) => setDaysToExpiry(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs font-mono mt-1 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-mono">Risk-Free Rate (%)</label>
                <input
                  type="number"
                  value={riskFreeRate}
                  onChange={(e) => setRiskFreeRate(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs font-mono mt-1 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-400 font-mono">
                <span>Volatility (σ)</span>
                <span className="text-indigo-400 font-bold">{volatility}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="200"
                value={volatility}
                onChange={(e) => setVolatility(Number(e.target.value))}
                className="w-full mt-1 accent-indigo-500 cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSelectedOptionType('call')}
                className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                  selectedOptionType === 'call'
                    ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span className="text-[10px] uppercase font-mono font-bold block">European Call</span>
                <span className="text-lg font-bold font-mono">${bsResults.callPrice.toFixed(2)}</span>
                <span className="text-[10px] font-mono block text-slate-400">Delta: {bsResults.deltaCall.toFixed(3)}</span>
              </button>

              <button
                onClick={() => setSelectedOptionType('put')}
                className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                  selectedOptionType === 'put'
                    ? 'bg-rose-950/60 border-rose-500 text-rose-300 ring-1 ring-rose-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span className="text-[10px] uppercase font-mono font-bold block">European Put</span>
                <span className="text-lg font-bold font-mono">${bsResults.putPrice.toFixed(2)}</span>
                <span className="text-[10px] font-mono block text-slate-400">Delta: {bsResults.deltaPut.toFixed(3)}</span>
              </button>
            </div>

            <PayoffChart
              spotPrice={spotPrice}
              strikePrice={strikePrice}
              optionType={selectedOptionType}
              optionPrice={selectedOptionType === 'call' ? bsResults.callPrice : bsResults.putPrice}
              daysToExpiry={daysToExpiry}
              volatility={volatility}
            />

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-slate-500">Gamma (Γ)</p>
                <p className="font-bold text-slate-200">{bsResults.gamma.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Theta (Θ/day)</p>
                <p className="font-bold text-amber-400">{bsResults.thetaCall.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Vega (ν/1%)</p>
                <p className="font-bold text-cyan-400">{bsResults.vega.toFixed(4)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOKEN SELECTOR MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-2xl p-5 shadow-2xl space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-slate-200">Select Token</h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white font-bold cursor-pointer">✕</button>
            </div>
            <input
              type="text"
              placeholder="Search symbol, name or paste 0x address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            {importing && <p className="text-xs text-indigo-400 font-mono">Fetching token details...</p>}
            {importError && <p className="text-xs text-rose-400 font-mono">{importError}</p>}
            <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
              {filteredTokens.map((t) => (
                <button
                  key={t.address}
                  onClick={() => selectToken(t)}
                  className="w-full flex items-center justify-between p-2 hover:bg-slate-800 rounded-xl cursor-pointer transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <TokenImage token={t} size="w-6 h-6" />
                    <div>
                      <p className="text-sm font-bold text-slate-200">{t.symbol}</p>
                      <p className="text-[10px] text-slate-400">{t.name}</p>
                    </div>
                  </div>
                  {t.isCustom && <span className="text-[9px] bg-indigo-950 text-indigo-400 px-1.5 py-0.5 rounded font-mono">Custom</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SLIPPAGE SETTINGS MODAL */}
      {settingsModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xs rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-slate-200">Slippage Tolerance</h3>
              <button onClick={() => setSettingsModalOpen(false)} className="text-slate-400 hover:text-white font-bold cursor-pointer">✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              {['0.1', '0.5', '1.0'].map((val) => (
                <button
                  key={val}
                  onClick={() => setSlippage(val)}
                  className={`py-2 rounded-xl border transition-all cursor-pointer ${
                    slippage === val
                      ? 'bg-indigo-600 border-indigo-500 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {val}%
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs text-slate-400 font-mono">Custom Slippage (%)</label>
              <input
                type="number"
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs font-mono mt-1 text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* WALLET CONNECT MODAL */}
      {walletModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xs rounded-2xl p-5 shadow-2xl space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-slate-200">Connect Wallet</h3>
              <button onClick={() => setWalletModalOpen(false)} className="text-slate-400 hover:text-white font-bold cursor-pointer">✕</button>
            </div>
            <div className="space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => { connect({ connector }); setWalletModalOpen(false); }}
                  className="w-full bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl p-3 text-sm font-bold text-slate-200 cursor-pointer transition-colors text-left flex justify-between items-center"
                >
                  <span>{connector.name}</span>
                  <span className="text-xs text-indigo-400">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TRANSACTION HISTORY MODAL */}
      {historyModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-2xl p-5 shadow-2xl space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-slate-200">Recent Transactions</h3>
              <button onClick={() => setHistoryModalOpen(false)} className="text-slate-400 hover:text-white font-bold cursor-pointer">✕</button>
            </div>
            {txHistory.length === 0 ? (
              <p className="text-xs text-slate-500 font-mono text-center py-4">No recent transactions recorded.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2 font-mono text-xs pr-1">
                {txHistory.map((tx, idx) => (
                  <div key={idx} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex justify-between items-center">
                    <div>
                      <p className="font-bold text-slate-200">
                        {tx.type ? `[${tx.type}] ` : ''}{tx.sellAmount} {tx.sellSymbol} → {Number(tx.buyAmount).toFixed(4)} {tx.buySymbol}
                      </p>
                      <p className="text-[10px] text-slate-500">{tx.timestamp}</p>
                    </div>
                    <a
                      href={`https://basescan.org/tx/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 text-xs underline shrink-0"
                    >
                      BaseScan ↗
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;