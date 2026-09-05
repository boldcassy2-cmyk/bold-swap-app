import { useState, useEffect, useRef } from 'react';
import { BrowserProvider, Contract, parseUnits, formatUnits, isAddress } from 'ethers';
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';

const MY_FEE_RECIPIENT = "0xfa06f50dFC00D333D29f56862a19d5a1c4F87490"; 
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const QUOTE_EXPIRY_SECONDS = 30;

const DEFAULT_TOKENS = [
  { symbol: "ETH", name: "Ethereum", address: NATIVE_ETH, decimals: 18 },
  { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { symbol: "USDT", name: "Tether USD", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
  { symbol: "DAI", name: "Dai Stablecoin", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
  { symbol: "BRETT", name: "Brett", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18 }
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
  const { connect, connectors, pendingConnector } = useConnect();
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

  // Token Approval & Allowance State
  const [needApproval, setNeedApproval] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // Custom Import & Modals
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('sell');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
  }, [sellToken, buyToken, sellAmount, slippage]);

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

      if (MY_FEE_RECIPIENT && isAddress(MY_FEE_RECIPIENT)) {
        queryParams.swapFeeRecipient = MY_FEE_RECIPIENT;
        queryParams.swapFeeBps = "50";
        queryParams.swapFeeToken = buyToken.address;
      }

      const params = new URLSearchParams(queryParams);
      const response = await fetch(`/api-0x/swap/permit2/quote?${params.toString()}`);

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
      setStatus("Quote updated!");
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
      setStatus(`${sellToken.symbol} Approved! You can now execute the swap.`);
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

      setStatus('Swap executed successfully! 🎉');

      const newTxRecord = {
        hash: tx.hash,
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
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Base Swap</h1>
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

        {/* Direction Switcher Button */}
        <div className="flex justify-center -my-3 z-10 relative">
          <button
            type="button"
            onClick={handleSwitchTokens}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-400 p-2 rounded-xl transition-all cursor-pointer shadow-lg hover:scale-110 active:scale-95"
            title="Switch Swap Direction"
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

        {/* Slippage & Gas Estimate Summary */}
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
            {loading ? 'Fetching Quote...' : 'Get Quote'}
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
            {loading ? 'Processing Swap...' : 'Execute Swap'}
          </button>
        )}

        {/* Active Quote Refresh Panel */}
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

      {/* TRANSACTION HISTORY MODAL */}
      {historyModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold">Recent Swaps</h2>
              <button onClick={() => setHistoryModalOpen(false)} className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer">✕</button>
            </div>

            {txHistory.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6 font-mono">No recent transactions.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {txHistory.map((tx, idx) => (
                  <div key={idx} className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex justify-between items-center text-xs">
                    <div>
                      <p className="font-bold text-slate-200">{tx.sellAmount} {tx.sellSymbol} ➔ {Number(tx.buyAmount).toFixed(4)} {tx.buySymbol}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{tx.timestamp}</p>
                    </div>
                    <a 
                      href={`https://basescan.org/tx/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 font-mono text-[10px] underline"
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

      {/* SLIPPAGE SETTINGS MODAL */}
      {settingsModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xs rounded-2xl p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold">Swap Settings</h2>
              <button onClick={() => setSettingsModalOpen(false)} className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer">✕</button>
            </div>

            <p className="text-xs text-slate-400 mb-3">Slippage Tolerance</p>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {['0.1', '0.5', '1.0'].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setSlippage(preset)}
                  className={`py-2 text-xs font-bold rounded-xl border transition-colors cursor-pointer ${
                    slippage === preset 
                      ? 'bg-indigo-600 border-indigo-500 text-white' 
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {preset}%
                </button>
              ))}
              <div className="relative">
                <input
                  type="number"
                  placeholder="Custom"
                  value={['0.1', '0.5', '1.0'].includes(slippage) ? '' : slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className="w-full h-full bg-slate-950 border border-slate-800 text-xs text-center rounded-xl focus:outline-none focus:border-indigo-500 font-bold"
                />
              </div>
            </div>

            <button
              onClick={() => setSettingsModalOpen(false)}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-xs font-bold py-2.5 rounded-xl transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* WALLET SELECTION MODAL */}
      {walletModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold">Select Wallet</h2>
              <button onClick={() => setWalletModalOpen(false)} className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer">✕</button>
            </div>

            <div className="space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => {
                    connect({ connector });
                    setWalletModalOpen(false);
                  }}
                  className="w-full p-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-left font-bold text-sm flex justify-between items-center transition-colors cursor-pointer"
                >
                  <span>{connector.name}</span>
                  {pendingConnector?.uid === connector.uid && (
                    <span className="text-xs text-indigo-400 animate-pulse">Connecting...</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TOKEN SELECTOR MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold">Select Token</h2>
              <button onClick={() => { setModalOpen(false); setImportError(''); }} className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer">✕</button>
            </div>

            <input 
              type="text" 
              placeholder="Search name or paste address (0x...)" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl p-3 mb-2 focus:outline-none focus:border-indigo-500 font-mono text-slate-100"
            />

            {importing && (
              <p className="text-xs text-indigo-400 font-mono mb-3 animate-pulse">Fetching token contract details...</p>
            )}

            {importError && (
              <p className="text-xs text-rose-400 font-mono mb-3">{importError}</p>
            )}

            <div className="max-h-64 overflow-y-auto space-y-2 pr-1 mt-3">
              {filteredTokens.map((token) => (
                <div 
                  key={token.address}
                  onClick={() => selectToken(token)}
                  className="p-3 bg-slate-950 hover:bg-slate-800 rounded-xl cursor-pointer flex justify-between items-center transition-colors border border-slate-800/50"
                >
                  <div className="flex items-center gap-3">
                    <TokenImage token={token} size="w-7 h-7" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-bold">{token.symbol}</p>
                        {token.isCustom && (
                          <span className="bg-indigo-500/20 text-indigo-400 text-[9px] font-bold px-1.5 py-0.5 rounded">Custom</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{token.name}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">{token.address.slice(0, 6)}...{token.address.slice(-4)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;