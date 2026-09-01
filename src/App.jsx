import { useState } from 'react';
import { BrowserProvider, formatEther } from 'ethers';

function App() {
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const connectWallet = async () => {
    setError('');
    
    // Check if a Web3 browser extension (e.g., MetaMask) is installed
    if (!window.ethereum) {
      setError('No crypto wallet detected. Please install MetaMask.');
      return;
    }

    try {
      setLoading(true);

      // Initialize the Ethers v6 BrowserProvider
      const provider = new BrowserProvider(window.ethereum);

      // Request account access from the wallet popup
      const accounts = await provider.send("eth_requestAccounts", []);
      const userAddress = accounts[0];

      // Get current wallet ETH balance
      const rawBalance = await provider.getBalance(userAddress);
      const formattedBalance = formatEther(rawBalance);

      setAccount(userAddress);
      setBalance(parseFloat(formattedBalance).toFixed(4));
    } catch (err) {
      console.error('Connection error:', err);
      setError('Failed to connect wallet. Connection request was rejected.');
    } finally {
      setLoading(false);
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    setBalance(null);
  };

  // Helper function to truncate wallet addresses (0x1234...abcd)
  const formatAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div style={styles.container}>
      <header style={styles.card}>
        <h1>Web3 DApp</h1>
        <p>Connect your wallet to interact with the blockchain.</p>

        {error && <p style={styles.error}>{error}</p>}

        {!account ? (
          <button 
            style={styles.button} 
            onClick={connectWallet} 
            disabled={loading}
          >
            {loading ? 'Connecting...' : 'Connect Wallet'}
          </button>
        ) : (
          <div style={styles.walletInfo}>
            <p><strong>Address:</strong> {formatAddress(account)}</p>
            <p><strong>Balance:</strong> {balance} ETH</p>
            <button style={{ ...styles.button, ...styles.disconnectBtn }} onClick={disconnectWallet}>
              Disconnect
            </button>
          </div>
        )}
      </header>
    </div>
  );
}

// Inline styles for clean layout
const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily: 'sans-serif'
  },
  card: {
    padding: '2.5rem',
    borderRadius: '12px',
    backgroundColor: '#1e293b',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%'
  },
  button: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    marginTop: '1rem',
    transition: 'background-color 0.2s'
  },
  disconnectBtn: {
    backgroundColor: '#dc2626'
  },
  walletInfo: {
    marginTop: '1rem',
    padding: '1rem',
    backgroundColor: '#334155',
    borderRadius: '8px'
  },
  error: {
    color: '#f87171',
    fontSize: '0.875rem',
    marginTop: '0.5rem'
  }
};

export default App;