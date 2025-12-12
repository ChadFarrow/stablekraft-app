'use client';

import { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { LNURLService } from '@/lib/lightning/lnurl';
import AlbumDetailClient from '@/app/album/[id]/AlbumDetailClient';
import { RSSAlbum } from '@/lib/rss-parser';
import confetti from 'canvas-confetti';

function SandboxControls({
  album,
  onGenerateInvoice,
}: {
  album: RSSAlbum | null;
  onGenerateInvoice: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showRawData, setShowRawData] = useState(false);

  return (
    <div className="bg-yellow-900/90 text-white p-4 sticky top-0 z-50 border-b-2 border-yellow-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🐛</span>
          <span className="font-bold">SANDBOX MODE</span>
          <span className="text-yellow-300 text-sm">Use QR Invoice button for Lightning payments</span>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xl"
        >
          {isExpanded ? '▲' : '▼'}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onGenerateInvoice}
              className="flex items-center gap-1 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 rounded text-sm"
            >
              ⚡ Generate QR Invoice
            </button>
            <button
              onClick={() => setShowRawData(!showRawData)}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-sm"
            >
              {showRawData ? '🙈 Hide' : '👁️ Show'} Raw Data
            </button>
          </div>

          {showRawData && album && (
            <pre className="mt-4 bg-black/50 p-3 rounded text-xs max-h-64 overflow-auto">
              {JSON.stringify(album, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

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
  const [invoice, setInvoice] = useState<string | null>(null);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dollarAmount, setDollarAmount] = useState(3); // Default $3
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

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

  // Close handler that fires confetti if invoice was shown
  const handleClose = useCallback(() => {
    if (invoice && !isPaid) {
      triggerConfetti();
    }
    onClose();
  }, [invoice, isPaid, triggerConfetti, onClose]);

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
      console.log('[Sandbox] Generating invoice for:', lightningAddress, 'amount:', amountToUse);

      // First resolve the LNURL to check min/max limits
      const lnurlParams = await LNURLService.resolveLightningAddress(lightningAddress);
      const minSats = Math.ceil((lnurlParams.minSendable || 1000) / 1000);
      const maxSats = Math.floor((lnurlParams.maxSendable || 100000000) / 1000);

      console.log('[Sandbox] LNURL limits:', { minSats, maxSats, requested: amountToUse });

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

      console.log('[Sandbox] Requesting invoice...');
      const result = await LNURLService.payLightningAddress(
        lightningAddress,
        amountToUse,
        comment
      );
      console.log('[Sandbox] Invoice received:', result.invoice?.substring(0, 50) + '...');
      console.log('[Sandbox] Verify URL:', result.verify || 'none');
      setInvoice(result.invoice);
      setVerifyUrl(result.verify || null);
    } catch (err: any) {
      console.error('[Sandbox] Invoice error:', err);
      console.error('[Sandbox] Error details:', { message: err.message, stack: err.stack });
      setInvoiceError(err.message || 'Failed to generate invoice');
    } finally {
      console.log('[Sandbox] Invoice generation complete');
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
            console.log('[Sandbox] BTC price:', price);
          }
        })
        .catch(err => console.warn('[Sandbox] Failed to fetch BTC price:', err));
    }
  }, [isOpen]);

  // Poll for payment status when we have a verify URL
  useEffect(() => {
    if (!verifyUrl || isPaid || !invoice) return;

    setIsPolling(true);
    console.log('[Sandbox] Starting payment polling...');

    const pollInterval = setInterval(async () => {
      try {
        const status = await LNURLService.checkPaymentStatus(verifyUrl);
        console.log('[Sandbox] Payment status:', status);

        if (status.settled) {
          console.log('[Sandbox] Payment confirmed!');
          clearInterval(pollInterval);
          setIsPolling(false);
          setIsPaid(true);
          triggerConfetti();
          setTimeout(() => {
            onClose();
          }, 1500);
        }
      } catch (err) {
        console.warn('[Sandbox] Poll error:', err);
      }
    }, 2000); // Poll every 2 seconds

    return () => {
      clearInterval(pollInterval);
      setIsPolling(false);
    };
  }, [verifyUrl, invoice, isPaid, triggerConfetti, onClose]);

  // Auto-generate invoice when modal opens and BTC price is loaded
  useEffect(() => {
    if (isOpen && lightningAddress && btcPrice && !invoice && !isGenerating && !invoiceError) {
      generateInvoice();
    }
  }, [isOpen, lightningAddress, btcPrice]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInvoice(null);
      setVerifyUrl(null);
      setInvoiceError(null);
      setDollarAmount(3); // Reset to default $3
      setIsPaid(false);
      setIsPolling(false);
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
          <h3 className="text-xl font-bold text-white">Lightning Payment (QR)</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-white text-2xl">
            &times;
          </button>
        </div>

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
              <p className="text-sm text-gray-400 mb-4 text-center">
                Scan with any Lightning wallet
              </p>
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
      </div>
    </div>
  );
}

function SandboxAlbumContent() {
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
          <p>Loading beach-trash album...</p>
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
      {/* Sandbox Controls */}
      <SandboxControls
        album={album}
        onGenerateInvoice={openAlbumQR}
      />

      {/* QR Modal */}
      <QRModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        lightningAddress={qrPaymentInfo.lightningAddress}
        trackTitle={qrPaymentInfo.trackTitle}
        albumTitle={album?.title}
      />

      {/* Production Album Component */}
      <AlbumDetailClient
        albumTitle={album?.title || 'Beach Trash'}
        albumId="beach-trash"
        initialAlbum={album}
        extraAlbumActions={
          <button
            onClick={openAlbumQR}
            className="flex items-center gap-2 px-6 py-3 text-base bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v2h-3v-2zm-5 0h3v2h-3v-2zm2 4h3v2h-3v-2zm3 3h2v3h-2v-3zm-5 0h3v3h-3v-3z"/>
            </svg>
            QR Invoice
          </button>
        }
      />
    </div>
  );
}

export default function SandboxAlbumPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-500"></div>
        </div>
      }
    >
      <SandboxAlbumContent />
    </Suspense>
  );
}
