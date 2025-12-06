import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '../globals.css';
import { AudioProvider } from '@/contexts/AudioContext';
import { ToastContainer } from '@/components/Toast';
import RadioNostrProvider from '@/components/Radio/RadioNostrProvider';
import RadioLightningWrapper from '@/components/Radio/RadioLightningWrapper';
import { UserSettingsProvider } from '@/contexts/UserSettingsContext';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  fallback: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif']
});

export const metadata: Metadata = {
  title: 'StableKraft Radio',
  description: 'Non-stop shuffled music from StableKraft',
  robots: 'noindex, nofollow', // Don't index radio subdomain
  manifest: '/manifest.json',
  icons: {
    icon: '/stablekraft-rocket.png',
    apple: '/app-icon-new.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1f2937',
  viewportFit: 'cover',
};

export default function RadioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="StableKraft Radio" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="icon" type="image/png" href="/stablekraft-rocket.png" />
      </head>
      <body className={inter.className}>
        <RadioNostrProvider>
          <UserSettingsProvider>
            <RadioLightningWrapper>
              <AudioProvider radioMode={true}>
                {children}
                <ToastContainer />
              </AudioProvider>
            </RadioLightningWrapper>
          </UserSettingsProvider>
        </RadioNostrProvider>
      </body>
    </html>
  );
}
