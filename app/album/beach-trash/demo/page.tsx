'use client';

import { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { LNURLService } from '@/lib/lightning/lnurl';
import AlbumDetailClient from '@/app/album/[id]/AlbumDetailClient';
import { RSSAlbum } from '@/lib/rss-parser';
import confetti from 'canvas-confetti';

function QRModal({
  isOpen,
  onClose,
  lightningAddress,
  trackTitle,
  albumTitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  lightningAddress: string | null;
  trackTitle?: string;
  albumTitle?: string;
}) {
  const [step, setStep] = useState<'intro' | 'payment'>('intro');
  const [invoice, setInvoice] = useState<string | null>(null);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dollarAmount, setDollarAmount] = useState(1.25); // Default $1.25
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [invoiceCreatedAt, setInvoiceCreatedAt] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const INVOICE_EXPIRY_SECONDS = 600; // 10 minutes

  const triggerConfetti = useCallback(() => {
    // Fire confetti from both sides
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { x: 0.2, y: 0.6 },
    });
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { x: 0.8, y: 0.6 },
    });
    // Second burst after a short delay
    setTimeout(() => {
      confetti({
        particleCount: 50,
        spread: 100,
        origin: { x: 0.5, y: 0.5 },
      });
    }, 200);
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const generateInvoice = useCallback(async (newDollarAmount?: number) => {
    const dollars = newDollarAmount || dollarAmount;

    if (!lightningAddress) {
      setInvoiceError('No Lightning address found');
      return;
    }

    if (!btcPrice) {
      setInvoiceError('Waiting for BTC price...');
      return;
    }

    // Convert dollars to sats
    const amountToUse = Math.round((dollars / btcPrice) * 100000000);

    if (amountToUse < 1) {
      setInvoiceError('Amount too small');
      return;
    }

    setIsGenerating(true);
    setInvoice(null);
    setInvoiceError(null);

    try {
      console.log('[Demo] Generating invoice for:', lightningAddress, 'amount:', amountToUse);

      // First resolve the LNURL to check min/max limits
      const lnurlParams = await LNURLService.resolveLightningAddress(lightningAddress);
      const minSats = Math.ceil((lnurlParams.minSendable || 1000) / 1000);
      const maxSats = Math.floor((lnurlParams.maxSendable || 100000000) / 1000);

      console.log('[Demo] LNURL limits:', { minSats, maxSats, requested: amountToUse });

      if (amountToUse < minSats) {
        setInvoiceError(`Minimum amount is ${minSats} sats`);
        setIsGenerating(false);
        return;
      }

      if (amountToUse > maxSats) {
        setInvoiceError(`Maximum amount is ${maxSats} sats`);
        setIsGenerating(false);
        return;
      }

      const comment = trackTitle
        ? `Boost for "${trackTitle}"${albumTitle ? ` from ${albumTitle}` : ''}`
        : `Boost for ${albumTitle || 'album'}`;

      console.log('[Demo] Requesting invoice...');
      const result = await LNURLService.payLightningAddress(
        lightningAddress,
        amountToUse,
        comment
      );
      console.log('[Demo] Invoice received:', result.invoice?.substring(0, 50) + '...');
      console.log('[Demo] Verify URL:', result.verify || 'none');
      setInvoice(result.invoice);
      setVerifyUrl(result.verify || null);
      setInvoiceCreatedAt(Date.now());
      setTimeRemaining(INVOICE_EXPIRY_SECONDS);
    } catch (err: any) {
      console.error('[Demo] Invoice error:', err);
      console.error('[Demo] Error details:', { message: err.message, stack: err.stack });
      setInvoiceError(err.message || 'Failed to generate invoice');
    } finally {
      console.log('[Demo] Invoice generation complete');
      setIsGenerating(false);
    }
  }, [lightningAddress, dollarAmount, btcPrice, trackTitle, albumTitle]);

  // Fetch BTC price on modal open
  useEffect(() => {
    if (isOpen && !btcPrice) {
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')
        .then(res => res.json())
        .then(data => {
          const price = data.bitcoin?.usd;
          if (price) {
            setBtcPrice(price);
            console.log('[Demo] BTC price:', price);
          }
        })
        .catch(err => console.warn('[Demo] Failed to fetch BTC price:', err));
    }
  }, [isOpen]);

  // Poll for payment status when we have a verify URL
  useEffect(() => {
    if (!verifyUrl || isPaid || !invoice) return;

    setIsPolling(true);
    console.log('[Demo] Starting payment polling...');

    const pollInterval = setInterval(async () => {
      try {
        const status = await LNURLService.checkPaymentStatus(verifyUrl);
        console.log('[Demo] Payment status:', status);

        if (status.settled) {
          console.log('[Demo] Payment confirmed!');
          clearInterval(pollInterval);
          setIsPolling(false);
          setIsPaid(true);
          triggerConfetti();
          setTimeout(() => {
            onClose();
          }, 1500);
        }
      } catch (err) {
        console.warn('[Demo] Poll error:', err);
      }
    }, 2000); // Poll every 2 seconds

    return () => {
      clearInterval(pollInterval);
      setIsPolling(false);
    };
  }, [verifyUrl, invoice, isPaid, triggerConfetti, onClose]);

  // Auto-generate invoice when user reaches payment step and BTC price is loaded
  useEffect(() => {
    if (isOpen && step === 'payment' && lightningAddress && btcPrice && !invoice && !isGenerating && !invoiceError) {
      generateInvoice();
    }
  }, [isOpen, step, lightningAddress, btcPrice]);

  // Countdown timer for invoice expiry
  useEffect(() => {
    if (!invoiceCreatedAt || !invoice || isPaid) return;

    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - invoiceCreatedAt) / 1000);
      const remaining = INVOICE_EXPIRY_SECONDS - elapsed;

      if (remaining <= 0) {
        setTimeRemaining(0);
        setInvoiceError('Invoice expired. Please generate a new one.');
        setInvoice(null);
        setInvoiceCreatedAt(null);
        clearInterval(timer);
      } else {
        setTimeRemaining(remaining);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [invoiceCreatedAt, invoice, isPaid]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('intro');
      setInvoice(null);
      setVerifyUrl(null);
      setInvoiceError(null);
      setDollarAmount(1.25); // Reset to default $1.25
      setIsPaid(false);
      setIsPolling(false);
      setInvoiceCreatedAt(null);
      setTimeRemaining(null);
    }
  }, [isOpen]);

  const copyInvoice = async () => {
    if (invoice) {
      await navigator.clipboard.writeText(invoice);
      alert('Invoice copied!');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-white">
            {step === 'intro' ? 'CashApp Demo' : 'Lightning Payment (QR)'}
          </h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-white text-2xl">
            &times;
          </button>
        </div>

        {/* Intro Screen */}
        {step === 'intro' && (
          <div className="text-center py-8">
            <p className="text-white text-lg mb-4">
              This is a demo for using CashApp to pay lightning invoices
            </p>
            <p className="text-gray-400 text-sm mb-6">
              CashApp has a $1 min to use this feature so thats why the min here is $1.25 to make sure that it works with the Cash balance in CashApp
            </p>
            <button
              onClick={() => setStep('payment')}
              className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Payment Flow */}
        {step === 'payment' && (
          <>
        {/* Track info */}
        {trackTitle && (
          <div className="mb-4 p-3 bg-gray-700/50 rounded-lg">
            <p className="text-sm text-gray-400">Boosting</p>
            <p className="text-white font-semibold">{trackTitle}</p>
            {albumTitle && <p className="text-sm text-gray-400">from {albumTitle}</p>}
          </div>
        )}

        {/* Amount selector */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-2">Select Amount</label>
          <div className="flex gap-2 flex-wrap">
            {[1.25, 3, 5, 10, 20].map(amt => (
              <button
                key={amt}
                onClick={() => {
                  setDollarAmount(amt);
                  generateInvoice(amt);
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  dollarAmount === amt
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                }`}
              >
                ${amt < 10 ? amt.toFixed(2) : amt}
              </button>
            ))}
          </div>

          {/* Show sats equivalent */}
          {btcPrice && (
            <div className="mt-3 text-sm text-gray-400">
              <p>${dollarAmount.toFixed(2)} = {Math.round((dollarAmount / btcPrice) * 100000000).toLocaleString()} sats</p>
            </div>
          )}
          {!btcPrice && (
            <div className="mt-3">
              <span className="text-xs text-gray-500">Loading BTC price...</span>
            </div>
          )}
        </div>

        {/* Recipient */}
        <div className="mb-4 text-sm text-gray-400">
          <p>To: {lightningAddress || 'Unknown'}</p>
        </div>

        {/* QR / Loading / Error */}
        <div className="flex flex-col items-center">
          {isGenerating && (
            <div className="py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-500 mx-auto mb-4"></div>
              <p className="text-gray-400">Generating invoice...</p>
            </div>
          )}

          {invoiceError && !isGenerating && (
            <div className="py-8 text-center">
              <p className="text-red-400 mb-4">{invoiceError}</p>
              <button
                onClick={() => generateInvoice()}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded text-white"
              >
                Retry
              </button>
            </div>
          )}

          {invoice && !isGenerating && !isPaid && (
            <>
              <div className="bg-white p-4 rounded-lg mb-4">
                <QRCodeSVG value={invoice.toUpperCase()} size={256} level="M" />
              </div>
              <p className="text-sm text-gray-400 mb-2 text-center">
                Scan with any Lightning wallet
              </p>
              {/* Timer display */}
              {timeRemaining !== null && (
                <p className={`text-sm mb-4 text-center font-mono ${
                  timeRemaining < 60 ? 'text-red-400' : timeRemaining < 180 ? 'text-yellow-400' : 'text-gray-400'
                }`}>
                  Expires in {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
                </p>
              )}
              <div className="flex gap-2 w-full">
                <button
                  onClick={copyInvoice}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
                >
                  Copy Invoice
                </button>
                <a
                  href={`lightning:${invoice}`}
                  className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded text-center text-white"
                >
                  Open Wallet
                </a>
              </div>

              {/* Payment status indicator */}
              {isPolling && (
                <div className="mt-4 flex items-center justify-center gap-2 text-yellow-400">
                  <div className="animate-pulse">●</div>
                  <span className="text-sm">Waiting for payment...</span>
                </div>
              )}

              {/* Manual paid button */}
              <button
                onClick={() => {
                  setIsPaid(true);
                  triggerConfetti();
                  setTimeout(() => onClose(), 3000);
                }}
                className="mt-4 w-full px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-white font-medium"
              >
                Paid
              </button>

            </>
          )}

          {/* Success state after payment */}
          {isPaid && (
            <div className="py-8 text-center">
              <div className="text-6xl mb-4">🎉</div>
              <p className="text-2xl font-bold text-green-400 mb-2">Payment Sent!</p>
              <p className="text-gray-400">Thank you for your boost!</p>
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

function DemoAlbumContent() {
  const [album, setAlbum] = useState<RSSAlbum | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrPaymentInfo, setQrPaymentInfo] = useState<{
    lightningAddress: string | null;
    trackTitle?: string;
  }>({ lightningAddress: null });

  const containerRef = useRef<HTMLDivElement>(null);

  // Extract Lightning address from v4v data
  const getLightningAddress = (v4vValue: any): string | null => {
    if (!v4vValue?.recipients) return null;
    for (const recipient of v4vValue.recipients) {
      if (recipient.name && recipient.name.includes('@')) {
        return recipient.name;
      }
    }
    return null;
  };

  useEffect(() => {
    fetch('/api/albums/beach-trash')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setAlbum(data.album);
        setIsLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setIsLoading(false);
      });
  }, []);


  const openAlbumQR = () => {
    setQrPaymentInfo({
      lightningAddress: getLightningAddress(album?.v4vValue),
      trackTitle: undefined,
    });
    setShowQRModal(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-500 mx-auto mb-4"></div>
          <p>Loading album...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center text-red-400">
          <p className="text-xl mb-2">Error loading album</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" ref={containerRef}>
      {/* QR Modal */}
      <QRModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        lightningAddress={qrPaymentInfo.lightningAddress}
        trackTitle={qrPaymentInfo.trackTitle}
        albumTitle={album?.title}
      />

      {/* Album Component */}
      <AlbumDetailClient
        albumTitle={album?.title || 'Beach Trash'}
        albumId="beach-trash"
        initialAlbum={album}
        extraAlbumActions={
          <button
            onClick={openAlbumQR}
            className="flex items-center gap-2 px-6 py-3 text-base bg-[#00D632] hover:bg-[#00C22D] text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v2h-3v-2zm-5 0h3v2h-3v-2zm2 4h3v2h-3v-2zm3 3h2v3h-2v-3zm-5 0h3v3h-3v-3z"/>
            </svg>
            CashApp Demo
          </button>
        }
      />
    </div>
  );
}

export default function BeachTrashDemoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-500"></div>
        </div>
      }
    >
      <DemoAlbumContent />
    </Suspense>
  );
}
