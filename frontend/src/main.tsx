import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import '@rainbow-me/rainbowkit/styles.css';

import {
  RainbowKitProvider,
  darkTheme,
  connectorsForWallets
} from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  injectedWallet,
  phantomWallet,
  walletConnectWallet
} from '@rainbow-me/rainbowkit/wallets';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { arbitrumSepolia, arbitrum } from 'wagmi/chains';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

const projectId = 'c07834ce800f0fdcea34e46cfe3ef082';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [metaMaskWallet, phantomWallet, injectedWallet, walletConnectWallet],
    },
  ],
  {
    appName: 'HSwarm',
    projectId,
  }
);

const config = createConfig({
  connectors,
  chains: [arbitrumSepolia, arbitrum],
  transports: {
    [arbitrumSepolia.id]: http(),
    [arbitrum.id]: http(),
  },
  ssr: false, 
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          theme={darkTheme({
            accentColor: '#8a2be2',
            accentColorForeground: 'white',
            borderRadius: 'medium',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
