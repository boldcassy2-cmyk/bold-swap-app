import { useState, useEffect } from 'react';
import { BrowserProvider, Contract, parseUnits, formatUnits, isAddress } from 'ethers';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

// Optional: Enter your fee recipient address here
const MY_FEE_RECIPIENT = ""; 

const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

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
  const [status, setStatus] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('sell');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const savedTokens = localStorage.getItem('custom_dex_tokens');
    if (savedTokens) {
      try {
        setTokens([...DEFAULT_TOKENS, ...JSON.parse(savedTokens)]);
      } catch (e) {
        console.error("Failed to load custom tokens", e);
      }
    }
  }, []);

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

  const getSwapQuote = async () => {
    if (!isConnected || !account) {
      setWalletModalOpen(true);
      return;
    }

    if (!sellAmount || Number(sellAmount) <= 0) {
      setStatus("Please enter a valid sell amount.");
      return;
    }

    setLoading(true);
    setQuote(null);
    setStatus("Fetching quote from Base network...");

    try {
      const sellAmountWei = parseUnits(sellAmount, sellToken.decimals).toString();

      const queryParams = {
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: sellAmountWei,
        taker: account,
        chainId: "8453"
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
        throw new Error(`Server returned non-JSON response (${response.status}): ${rawText.slice(0, 100)}`);
      }

      const data = await response.json();

      if (!response.ok || data.errors || data.reason) {
        const errorMsg = data.details?.reason || data.reason || data.message || `API Error ${response.status}`;
        throw new Error(errorMsg);
      }

      setQuote(data);
      setStatus("Quote ready!");
    } catch (err) {
      console.error("Quote Error:", err);
      setStatus(`Quote Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const executeSwap = async () => {
    if (!quote?.transaction || !window.ethereum) return;
    setLoading(true);

    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      if (sellToken.address.toLowerCase() !== NATIVE_ETH.toLowerCase() && quote.issues?.allowance) {
        const { spender } = quote.issues.allowance;
        const requiredAmount = parseUnits(sellAmount, sellToken.decimals);
        
        const tokenContract = new Contract(sellToken.address, ERC20_ABI, signer);
        const currentAllowance = await tokenContract.allowance(account, spender);

        if (BigInt(currentAllowance) < BigInt(requiredAmount)) {
          setStatus(`Approving ${sellToken.symbol}...`);
          const approveTx = await tokenContract.approve(spender, requiredAmount);
          await approveTx.wait();
        }
      }

      setStatus('Submitting transaction on Base...');
      
      const txParams = {
        to: quote.transaction.to,
        data: quote.transaction.data,
        value: quote.transaction.value ? BigInt(quote.transaction.value) : 0n
      };

      if (quote.transaction.gas) {
        txParams.gasLimit = BigInt(quote.transaction.gas);
      }

      const tx = await signer.sendTransaction(txParams);

      setStatus(`Tx submitted: ${tx.hash}`);
      await tx.wait();
      setStatus('Swap successful!');
    } catch (err) {
      console.error("Swap Execution Error:", err);
      setStatus(`Execution failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredTokens = tokens.filter(t => 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-bold">Base DEX Swap</h1>
          {!isConnected ? (
            <button 
              onClick={() => setWalletModalOpen(true)} 
              className="bg-indigo-600 hover:bg-indigo-500 text-xs font-bold py-2 px-3 rounded-xl cursor-pointer transition-colors"
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

        {/* You Pay */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-3">
          <div className="text-xs text-slate-400 mb-2">You Pay</div>
          <div className="flex items-center gap-2">
            <input 
              type="number" 
              value={sellAmount} 
              onChange={(e) => setSellAmount(e.target.value)}
              className="w-full bg-transparent text-xl font-bold focus:outline-none"
              placeholder="0.0"
            />
            <button 
              onClick={() => { setModalMode('sell'); setModalOpen(true); }}
              className="bg-slate-800 hover:bg-slate-700 text-sm font-bold border border-slate-700 rounded-lg px-3 py-1.5 cursor-pointer flex items-center gap-1 transition-colors"
            >
              {sellToken.symbol} <span className="text-xs">▼</span>
            </button>
          </div>
        </div>

        {/* You Receive */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4">
          <div className="text-xs text-slate-400 mb-2">You Receive (Estimated)</div>
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-emerald-400">
              {quote ? Number(formatUnits(quote.buyAmount, buyToken.decimals)).toFixed(4) : '0.00'}
            </span>
            <button 
              onClick={() => { setModalMode('buy'); setModalOpen(true); }}
              className="bg-slate-800 hover:bg-slate-700 text-sm font-bold border border-slate-700 rounded-lg px-3 py-1.5 cursor-pointer flex items-center gap-1 transition-colors"
            >
              {buyToken.symbol} <span className="text-xs">▼</span>
            </button>
          </div>
        </div>

        {/* Action Button */}
        {!isConnected ? (
          <button 
            onClick={() => setWalletModalOpen(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl mb-3 cursor-pointer transition-colors"
          >
            Connect Wallet
          </button>
        ) : (
          <button 
            onClick={getSwapQuote} 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-3 rounded-xl mb-3 cursor-pointer transition-colors"
          >
            {loading ? 'Fetching Quote...' : 'Get Quote'}
          </button>
        )}

        {quote && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-3">
            <button 
              onClick={executeSwap}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-3 rounded-xl cursor-pointer transition-colors"
            >
              {loading ? 'Processing...' : 'Execute Swap'}
            </button>
          </div>
        )}

        {status && <p className="text-xs text-amber-400 text-center mt-2 font-mono break-words">{status}</p>}
      </div>

      {/* WALLET SELECTION MODAL */}
      {walletModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold">Select Wallet</h2>
              <button onClick={() => setWalletModalOpen(false)} className="text-slate-400 hover:text-white text-lg font-bold">✕</button>
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
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white text-lg font-bold">✕</button>
            </div>

            <input 
              type="text" 
              placeholder="Search by name or symbol" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl p-3 mb-4 focus:outline-none focus:border-indigo-500 font-mono text-slate-100"
            />

            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {filteredTokens.map((token) => (
                <div 
                  key={token.address}
                  onClick={() => selectToken(token)}
                  className="p-3 bg-slate-950 hover:bg-slate-800 rounded-xl cursor-pointer flex justify-between items-center transition-colors border border-slate-800/50"
                >
                  <div>
                    <p className="text-sm font-bold">{token.symbol}</p>
                    <p className="text-xs text-slate-400">{token.name}</p>
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