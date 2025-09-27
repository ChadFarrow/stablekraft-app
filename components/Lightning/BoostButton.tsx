'use client';

import React, { useState } from 'react';
import { useBitcoinConnect } from './BitcoinConnectProvider';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { LNURLService } from '@/lib/lightning/lnurl';
import { Zap, Send, X, Mail } from 'lucide-react';

interface BoostButtonProps {
  trackId?: string;
  feedId?: string;
  trackTitle?: string;
  artistName?: string;
  valueSplits?: Array<{
    name?: string;
    address: string;
    split: number;
    type: 'node' | 'lnaddress';
  }>;
  lightningAddress?: string; // Primary Lightning Address for this track/artist
  className?: string;
}

export function BoostButton({
  trackId,
  feedId,
  trackTitle,
  artistName,
  valueSplits = [],
  lightningAddress,
  className = '',
}: BoostButtonProps) {
  const { isConnected, connect, sendKeysend, sendPayment } = useBitcoinConnect();
  const [showModal, setShowModal] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState(100);
  const [customAmount, setCustomAmount] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleBoost = async () => {
    if (!isConnected) {
      await connect();
      return;
    }
    setShowModal(true);
  };

  const sendBoost = async () => {
    setIsSending(true);
    setError(null);
    setSuccess(false);

    try {
      const amount = customAmount ? parseInt(customAmount) : selectedAmount;

      if (amount < 1) {
        setError('Amount must be at least 1 sat');
        setIsSending(false);
        return;
      }

      let result: { preimage?: string; error?: string } = { error: 'No payment method configured' };

      // Determine payment destination priority:
      // 1. Lightning Address (if provided)
      // 2. Value splits (if configured)
      // 3. Platform default node pubkey

      if (lightningAddress && LNURLService.isLightningAddress(lightningAddress)) {
        // Pay to Lightning Address via LNURL-pay
        console.log(`⚡ Paying via Lightning Address: ${lightningAddress}`);

        try {
          const { invoice } = await LNURLService.payLightningAddress(
            lightningAddress,
            amount,
            message
          );

          result = await sendPayment(invoice);
        } catch (lnurlError) {
          console.error('Lightning Address payment failed:', lnurlError);
          result = { error: `Lightning Address payment failed: ${lnurlError instanceof Error ? lnurlError.message : 'Unknown error'}` };
        }
      } else if (valueSplits && valueSplits.length > 0) {
        // Use value splits for multiple recipients
        console.log(`⚡ Paying via value splits to ${valueSplits.length} recipients`);
        result = await sendValueSplitPayments(amount, message);
      } else {
        // Fallback to platform default
        const defaultAddress = LIGHTNING_CONFIG.platform.nodePublicKey;

        if (!defaultAddress) {
          setError('No payment destination configured');
          setIsSending(false);
          return;
        }

        console.log(`⚡ Paying via keysend to platform: ${defaultAddress.slice(0, 20)}...`);
        result = await sendKeysend(defaultAddress, amount, message);
      }

      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        // Log the boost to the database
        await logBoost({
          trackId,
          feedId,
          amount,
          message,
          preimage: result.preimage,
          paymentMethod: lightningAddress ? 'lightning-address' : valueSplits?.length ? 'value-splits' : 'keysend',
        });

        // Close modal after success
        setTimeout(() => {
          setShowModal(false);
          setSuccess(false);
          setMessage('');
          setCustomAmount('');
        }, 2000);
      }
    } catch (err) {
      console.error('Boost error:', err);
      setError(err instanceof Error ? err.message : 'Failed to send boost');
    } finally {
      setIsSending(false);
    }
  };

  // Handle value split payments (multiple recipients)
  const sendValueSplitPayments = async (
    totalAmount: number,
    message?: string
  ): Promise<{ preimage?: string; error?: string }> => {
    try {
      const results: Array<{ preimage?: string; error?: string }> = [];

      // Calculate split amounts
      const totalSplits = valueSplits.reduce((sum, split) => sum + split.split, 0);

      for (const recipient of valueSplits) {
        const recipientAmount = Math.floor((recipient.split / totalSplits) * totalAmount);

        if (recipientAmount < 1) {
          console.warn(`Skipping recipient ${recipient.name}: amount too small (${recipientAmount} sats)`);
          continue;
        }

        let recipientResult: { preimage?: string; error?: string };

        if (recipient.type === 'lnaddress' && LNURLService.isLightningAddress(recipient.address)) {
          // Pay via Lightning Address
          try {
            const { invoice } = await LNURLService.payLightningAddress(
              recipient.address,
              recipientAmount,
              message
            );
            recipientResult = await sendPayment(invoice);
          } catch (lnurlError) {
            recipientResult = { error: `Lightning Address failed: ${lnurlError instanceof Error ? lnurlError.message : 'Unknown error'}` };
          }
        } else if (recipient.type === 'node') {
          // Pay via keysend
          recipientResult = await sendKeysend(recipient.address, recipientAmount, message);
        } else {
          recipientResult = { error: `Unsupported recipient type: ${recipient.type}` };
        }

        results.push(recipientResult);

        console.log(`💸 Sent ${recipientAmount} sats to ${recipient.name || recipient.address.slice(0, 20)}...`,
                   recipientResult.error ? 'FAILED' : 'SUCCESS');
      }

      // Check if any payments succeeded
      const successful = results.filter(r => !r.error);
      const failed = results.filter(r => r.error);

      if (successful.length === 0) {
        return { error: `All payments failed. Errors: ${failed.map(f => f.error).join(', ')}` };
      }

      if (failed.length > 0) {
        console.warn(`${failed.length} of ${results.length} payments failed`);
      }

      // Return first successful preimage
      return { preimage: successful[0].preimage };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Value split payment failed' };
    }
  };

  const logBoost = async (data: {
    trackId?: string;
    feedId?: string;
    amount: number;
    message?: string;
    preimage?: string;
    paymentMethod?: string;
  }) => {
    try {
      await fetch('/api/lightning/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (err) {
      console.error('Failed to log boost:', err);
    }
  };

  return (
    <>
      <button
        onClick={handleBoost}
        className={`flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black rounded-lg font-semibold transition-colors ${className}`}
        title="Send a boost"
      >
        <Zap className="w-5 h-5" />
        <span>Boost</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">
                Send a Boost ⚡
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {trackTitle && (
              <div className="mb-4 p-3 bg-gray-800 rounded-lg">
                <p className="text-sm text-gray-400">Boosting</p>
                <p className="text-white font-semibold">{trackTitle}</p>
                {artistName && (
                  <p className="text-sm text-gray-400">by {artistName}</p>
                )}

                {/* Payment Method Indicator */}
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {lightningAddress && LNURLService.isLightningAddress(lightningAddress) ? (
                    <>
                      <Mail className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-400">Lightning Address: {lightningAddress}</span>
                    </>
                  ) : valueSplits && valueSplits.length > 0 ? (
                    <>
                      <Zap className="w-3 h-3 text-yellow-400" />
                      <span className="text-yellow-400">Value splits to {valueSplits.length} recipients</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3 h-3 text-gray-400" />
                      <span className="text-gray-400">Platform keysend</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Amount Selection */}
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">
                Amount (sats)
              </label>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {LIGHTNING_CONFIG.boostPresets.slice(0, 8).map((amount) => (
                  <button
                    key={amount}
                    onClick={() => {
                      setSelectedAmount(amount);
                      setCustomAmount('');
                    }}
                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      selectedAmount === amount && !customAmount
                        ? 'bg-yellow-500 text-black'
                        : 'bg-gray-800 text-white hover:bg-gray-700'
                    }`}
                  >
                    {amount.toLocaleString()}
                  </button>
                ))}
              </div>
              <input
                type="number"
                placeholder="Custom amount"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                min="1"
              />
            </div>

            {/* Message */}
            <div className="mb-6">
              <label className="text-sm text-gray-400 mb-2 block">
                Message (optional)
              </label>
              <textarea
                placeholder={LIGHTNING_CONFIG.boostagram.placeholder}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, LIGHTNING_CONFIG.boostagram.maxLength))}
                className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
                rows={3}
                maxLength={LIGHTNING_CONFIG.boostagram.maxLength}
              />
              <p className="text-xs text-gray-500 mt-1">
                {message.length}/{LIGHTNING_CONFIG.boostagram.maxLength}
              </p>
            </div>

            {/* Error/Success Messages */}
            {error && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-200 text-sm">
                ⚡ Boost sent successfully!
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendBoost}
                disabled={isSending || (!customAmount && !selectedAmount)}
                className="flex-1 py-2 px-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 text-black rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {isSending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>
                      Send {customAmount || selectedAmount} sats
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}