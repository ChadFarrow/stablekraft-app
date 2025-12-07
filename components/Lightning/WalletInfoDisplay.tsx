'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useBitcoinConnect } from './BitcoinConnectProvider';
import { Wallet, RefreshCw, Copy, ExternalLink, Check, Plus, X, CheckCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  formatBalance,
  getWalletExternalUrl,
  getProviderColors,
} from '@/lib/lightning/wallet-detection';

interface WalletInfoDisplayProps {
  variant?: 'compact' | 'full' | 'card';
  showBalance?: boolean;
  showAddress?: boolean;
  className?: string;
}

export function WalletInfoDisplay({
  variant = 'compact',
  showBalance = true,
  showAddress = true,
  className = '',
}: WalletInfoDisplayProps) {
  const {
    isConnected,
    walletInfo,
    balance,
    isBalanceLoading,
    refreshBalance,
    walletProviderType,
    makeInvoice,
  } = useBitcoinConnect();

  const [copied, setCopied] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState('');
  const [invoice, setInvoice] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [invoiceCopied, setInvoiceCopied] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [initialBalance, setInitialBalance] = useState<number | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for payment when invoice is generated
  useEffect(() => {
    if (!invoice || !initialBalance || isPaid) {
      return;
    }

    // Poll balance every 3 seconds to detect payment
    pollIntervalRef.current = setInterval(async () => {
      await refreshBalance();
    }, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [invoice, initialBalance, isPaid, refreshBalance]);

  // Detect payment by balance increase
  useEffect(() => {
    if (invoice && initialBalance !== null && balance !== null && balance > initialBalance) {
      // Payment detected!
      setIsPaid(true);

      // Stop polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      // Auto-close after showing confirmation
      setTimeout(() => {
        handleCloseReceive();
      }, 2500);
    }
  }, [balance, initialBalance, invoice]);

  if (!isConnected || !walletInfo) return null;

  const colors = getProviderColors(walletProviderType);
  const externalUrl = getWalletExternalUrl(walletProviderType);

  // Get provider logo URL
  const getProviderLogo = () => {
    if (walletProviderType === 'coinos') {
      return '/coinos-logo.png';
    }
    return null;
  };
  const providerLogo = getProviderLogo();

  const handleCopyAddress = async () => {
    if (walletInfo.lightningAddress) {
      try {
        await navigator.clipboard.writeText(walletInfo.lightningAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    }
  };

  const handleRefreshBalance = async () => {
    await refreshBalance();
  };

  const handleGenerateInvoice = async () => {
    const amount = parseInt(receiveAmount, 10);
    if (!amount || amount <= 0) {
      setInvoiceError('Please enter a valid amount');
      return;
    }

    setIsGenerating(true);
    setInvoiceError(null);
    setInvoice(null);
    setIsPaid(false);

    // Store current balance to detect payment
    setInitialBalance(balance);

    const result = await makeInvoice(amount);

    if (result.error) {
      setInvoiceError(result.error);
    } else if (result.invoice) {
      setInvoice(result.invoice);
    }

    setIsGenerating(false);
  };

  const handleCopyInvoice = async () => {
    if (invoice) {
      try {
        await navigator.clipboard.writeText(invoice);
        setInvoiceCopied(true);
        setTimeout(() => setInvoiceCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy invoice:', error);
      }
    }
  };

  const handleCloseReceive = () => {
    // Stop polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setShowReceive(false);
    setReceiveAmount('');
    setInvoice(null);
    setInvoiceError(null);
    setIsPaid(false);
    setInitialBalance(null);
  };

  // Compact variant - for inline display in buttons/headers
  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 text-sm ${className}`}>
        <span className={`font-medium ${colors.primary}`}>
          {walletInfo.providerName}
        </span>
        {showBalance && walletInfo.supportsBalance && balance !== null && (
          <span className="text-yellow-400 font-mono">
            {isBalanceLoading ? '...' : formatBalance(balance)}
          </span>
        )}
      </div>
    );
  }

  // Full variant - for dropdown menus
  if (variant === 'full') {
    return (
      <div className={`space-y-3 ${className}`}>
        {/* Provider Info */}
        <div className="flex items-center gap-3">
          {providerLogo ? (
            <img
              src={providerLogo}
              alt={walletInfo.providerName}
              className="w-10 h-10 rounded-lg"
            />
          ) : (
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${colors.bg}`}
            >
              <Wallet className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold ${colors.primary}`}>
              {walletInfo.providerName}
            </h3>
          </div>
        </div>

        {/* Balance */}
        {showBalance && walletInfo.supportsBalance && (
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-400 text-sm">Balance</span>
              <button
                onClick={handleRefreshBalance}
                disabled={isBalanceLoading}
                className="text-gray-400 hover:text-white transition-colors p-1 rounded"
                title="Refresh balance"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isBalanceLoading ? 'animate-spin' : ''}`}
                />
              </button>
            </div>
            <div className="text-xl font-bold text-yellow-400 font-mono">
              {balance !== null ? formatBalance(balance) : '---'}
            </div>
          </div>
        )}

        {/* Fund Wallet Button */}
        <button
          onClick={() => setShowReceive(true)}
          className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2 px-3 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Fund Wallet
        </button>

        {/* Fund Wallet Modal */}
        {showReceive && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={handleCloseReceive}
          >
            <div
              className="bg-gray-900 rounded-xl p-6 w-full max-w-sm mx-4 border border-gray-700 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {isPaid ? (
                /* Payment Confirmed */
                <div className="text-center py-8 space-y-4">
                  <div className="flex justify-center">
                    <CheckCircle className="w-16 h-16 text-green-500" />
                  </div>
                  <h3 className="text-xl font-semibold text-white">Payment Received!</h3>
                  <p className="text-green-400 font-medium text-lg">
                    +{parseInt(receiveAmount).toLocaleString()} sats
                  </p>
                  <p className="text-gray-400 text-sm">
                    Your wallet has been funded
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">Fund Wallet</h3>
                    <button
                      onClick={handleCloseReceive}
                      className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {!invoice ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-gray-400 text-sm mb-2">Amount (sats)</label>
                        <input
                          type="number"
                          value={receiveAmount}
                          onChange={(e) => setReceiveAmount(e.target.value)}
                          placeholder="Enter amount"
                          className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-green-500 border border-gray-700"
                          onKeyDown={(e) => e.key === 'Enter' && handleGenerateInvoice()}
                          autoFocus
                        />
                      </div>
                      {invoiceError && (
                        <p className="text-red-400 text-sm">{invoiceError}</p>
                      )}
                      <button
                        onClick={handleGenerateInvoice}
                        disabled={isGenerating || !receiveAmount}
                        className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isGenerating ? 'Generating...' : 'Create Invoice'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-center bg-white p-5 rounded-lg">
                        <QRCodeSVG value={invoice} size={260} />
                      </div>
                      <p className="text-center text-white font-medium">
                        {parseInt(receiveAmount).toLocaleString()} sats
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={invoice}
                          readOnly
                          className="flex-1 bg-gray-800 text-white rounded-lg px-3 py-2 text-xs font-mono truncate border border-gray-700"
                        />
                        <button
                          onClick={handleCopyInvoice}
                          className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                          title={invoiceCopied ? 'Copied!' : 'Copy invoice'}
                        >
                          {invoiceCopied ? (
                            <Check className="w-5 h-5 text-green-400" />
                          ) : (
                            <Copy className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                      <p className="text-gray-400 text-sm text-center">
                        Scan or copy this invoice to fund your wallet
                      </p>
                      <button
                        onClick={() => {
                          setInvoice(null);
                          setReceiveAmount('');
                          setIsPaid(false);
                          setInitialBalance(balance);
                        }}
                        className="w-full py-2 text-gray-400 hover:text-white text-sm underline transition-colors"
                      >
                        Create new invoice
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Lightning Address */}
        {showAddress && walletInfo.lightningAddress && (
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-400 text-sm">Lightning Address</span>
              <button
                onClick={handleCopyAddress}
                className="text-gray-400 hover:text-white transition-colors p-1 rounded"
                title={copied ? 'Copied!' : 'Copy address'}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="text-white font-mono text-sm break-all">
              {walletInfo.lightningAddress}
            </div>
            <p className="text-gray-500 text-xs mt-1">(inferred from alias)</p>
          </div>
        )}

        {/* External Link */}
        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 ${colors.primary} hover:opacity-80 text-sm transition-opacity`}
          >
            <ExternalLink className="w-4 h-4" />
            Open {walletInfo.providerName} Wallet
          </a>
        )}
      </div>
    );
  }

  // Card variant - for settings pages
  return (
    <div
      className={`bg-gray-800/50 backdrop-blur-sm rounded-lg p-4 border border-gray-700/50 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        {providerLogo ? (
          <img
            src={providerLogo}
            alt={walletInfo.providerName}
            className="w-12 h-12 rounded-lg"
          />
        ) : (
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center ${colors.bg}`}
          >
            <Wallet className="w-6 h-6 text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold text-lg ${colors.primary}`}>
            {walletInfo.providerName}
          </h3>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-3">
        {/* Balance */}
        {showBalance && walletInfo.supportsBalance && (
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-gray-400 text-sm block">Balance</span>
                <div className="text-2xl font-bold text-yellow-400 font-mono">
                  {balance !== null ? formatBalance(balance) : '---'}
                </div>
              </div>
              <button
                onClick={handleRefreshBalance}
                disabled={isBalanceLoading}
                className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-700/50"
                title="Refresh balance"
              >
                <RefreshCw
                  className={`w-5 h-5 ${isBalanceLoading ? 'animate-spin' : ''}`}
                />
              </button>
            </div>
          </div>
        )}

        {/* Lightning Address */}
        {showAddress && walletInfo.lightningAddress && (
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-400 text-sm">Lightning Address</span>
              <button
                onClick={handleCopyAddress}
                className="text-gray-400 hover:text-white transition-colors p-1 rounded"
                title={copied ? 'Copied!' : 'Copy address'}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="text-white font-mono text-sm break-all">
              {walletInfo.lightningAddress}
            </div>
            <p className="text-gray-500 text-xs mt-1">(inferred from alias)</p>
          </div>
        )}
      </div>

      {/* External Link */}
      {externalUrl && (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center justify-center gap-2 ${colors.primary} hover:opacity-80 text-sm transition-opacity mt-4 py-2 px-4 rounded-lg border border-current`}
        >
          <ExternalLink className="w-4 h-4" />
          Open {walletInfo.providerName} Wallet
        </a>
      )}
    </div>
  );
}

export default WalletInfoDisplay;
