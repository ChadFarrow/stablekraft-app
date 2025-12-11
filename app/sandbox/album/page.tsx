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
          <span className="text-yellow-300 text-sm">Boost buttons show QR codes</span>
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
  const [amount, setAmount] = useState(21);
  const [dollarAmount, setDollarAmount] = useState('');
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

  const generateInvoice = useCallback(async (newAmount?: number) => {
    const amountToUse = newAmount || amount;

    if (!lightningAddress) {
      setInvoiceError('No Lightning address found');
      return;
    }

    if (amountToUse < 1) {
      setInvoiceError('Amount must be at least 1 sat');
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
  }, [lightningAddress, amount, trackTitle, albumTitle]);

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

  // Convert dollars to sats
  const dollarsToSats = (dollars: number): number => {
    if (!btcPrice) return 0;
    // 1 BTC = 100,000,000 sats
    return Math.round((dollars / btcPrice) * 100000000);
  };

  const handleDollarChange = (value: string) => {
    setDollarAmount(value);
    const dollars = parseFloat(value);
    if (!isNaN(dollars) && dollars > 0 && btcPrice) {
      const sats = dollarsToSats(dollars);
      setAmount(sats);
    }
  };

  useEffect(() => {
    if (isOpen && lightningAddress && !invoice && !isGenerating && !invoiceError) {
      generateInvoice();
    }
  }, [isOpen, lightningAddress]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInvoice(null);
      setVerifyUrl(null);
      setInvoiceError(null);
      setAmount(21);
      setDollarAmount('');
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
          <label className="block text-sm text-gray-400 mb-2">Amount (sats)</label>
          <div className="flex gap-2 flex-wrap">
            {[21, 100, 500, 1000].map(amt => (
              <button
                key={amt}
                onClick={() => {
                  setAmount(amt);
                  setDollarAmount('');
                  generateInvoice(amt);
                }}
                className={`px-3 py-1 rounded ${
                  amount === amt && !dollarAmount ? 'bg-yellow-500 text-black' : 'bg-gray-700 hover:bg-gray-600 text-white'
                }`}
              >
                {amt}
              </button>
            ))}
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(parseInt(e.target.value) || 21);
                setDollarAmount('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  generateInvoice();
                }
              }}
              className="w-20 px-2 py-1 bg-gray-700 rounded text-center text-white"
              min="1"
            />
            <button
              onClick={() => generateInvoice()}
              className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-white"
            >
              Go
            </button>
          </div>

          {/* Dollar amount input */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input
              type="number"
              step="0.01"
              placeholder="USD"
              value={dollarAmount}
              onChange={(e) => handleDollarChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  generateInvoice();
                }
              }}
              className="w-24 px-2 py-1 bg-gray-700 rounded text-center text-white"
              min="0.01"
            />
            {btcPrice && dollarAmount && (
              <span className="text-sm text-gray-400">
                = {amount.toLocaleString()} sats
              </span>
            )}
            {!btcPrice && (
              <span className="text-xs text-gray-500">Loading price...</span>
            )}
          </div>
          {btcPrice && (
            <p className="text-xs text-gray-500 mt-1">
              BTC: ${btcPrice.toLocaleString()}
            </p>
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

              <p className="text-xs text-gray-500 mt-4 break-all max-h-20 overflow-auto">
                {invoice}
              </p>
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

  // Override boost buttons with QR functionality
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !album) return;

    const overrideBoostButton = (button: HTMLButtonElement) => {
      // Skip if already overridden
      if (button.dataset.sandboxOverride) return;
      button.dataset.sandboxOverride = 'true';

      // Find track context - look for the track row (has rounded-lg and group classes)
      const trackRow = button.closest('.group');

      let trackTitle: string | undefined;
      let trackV4v: any = null;

      if (trackRow) {
        // The title is in a p element with line-clamp-2 class
        const titleEl = trackRow.querySelector('p.line-clamp-2');
        if (titleEl) {
          // Get the text content, but the title might have " • Artist" after it
          const fullText = titleEl.textContent || '';
          // Split on the bullet separator to get just the title
          trackTitle = fullText.split(' • ')[0].trim();
        }

        // Fallback: try to get title from image alt attribute
        if (!trackTitle) {
          const img = trackRow.querySelector('img[alt]');
          if (img) {
            trackTitle = img.getAttribute('alt') || undefined;
          }
        }

        // Try to match with album tracks by title
        if (trackTitle && album.tracks) {
          const matchingTrack = album.tracks.find(t => t.title === trackTitle);
          if (matchingTrack) {
            trackV4v = matchingTrack.v4vValue;
            trackTitle = matchingTrack.title; // Use exact title from data
          }
        }
      }

      // Clone and replace the button to remove all React event handlers
      const newButton = button.cloneNode(true) as HTMLButtonElement;
      newButton.dataset.sandboxOverride = 'true';

      newButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        console.log('[Sandbox] QR boost for:', trackTitle || 'album');

        const lightningAddress = getLightningAddress(trackV4v) || getLightningAddress(album.v4vValue);

        setQrPaymentInfo({
          lightningAddress,
          trackTitle,
        });
        setShowQRModal(true);
      });

      button.parentNode?.replaceChild(newButton, button);
    };

    const findAndOverrideBoostButtons = () => {
      // Find all boost buttons (yellow background with Zap icon or "Boost" text)
      const buttons = container.querySelectorAll('button');
      buttons.forEach(button => {
        const hasZap = button.querySelector('svg.lucide-zap');
        const hasBoostText = button.textContent?.includes('Boost');
        const isYellow = button.className.includes('yellow');

        if ((hasZap || hasBoostText) && isYellow && !button.dataset.sandboxOverride) {
          overrideBoostButton(button as HTMLButtonElement);
        }
      });
    };

    // Initial override
    const timeoutId = setTimeout(findAndOverrideBoostButtons, 500);

    // Watch for new buttons being added
    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldCheck = true;
          break;
        }
      }
      if (shouldCheck) {
        findAndOverrideBoostButtons();
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [album]);

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
