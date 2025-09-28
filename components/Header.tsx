'use client';

import React from 'react';
import Link from 'next/link';
import { LightningWalletButton } from '@/components/Lightning/LightningWalletButton';
import { Music, Zap } from 'lucide-react';

export default function Header() {
  return (
    <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-2 text-white hover:text-gray-300 transition-colors">
              <Music className="w-6 h-6" />
              <span className="font-bold text-lg">FUCKIT Music</span>
            </Link>
          </div>

          {/* Lightning Wallet Button */}
          <div className="flex items-center space-x-4">
            <LightningWalletButton 
              variant="dropdown" 
              showLabel={true}
              className="hidden sm:block"
            />
            
            {/* Mobile Lightning Button */}
            <LightningWalletButton 
              variant="minimal" 
              className="sm:hidden"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
