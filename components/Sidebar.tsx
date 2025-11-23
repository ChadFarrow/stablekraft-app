'use client';

import React from 'react';
import Link from 'next/link';
import { useSidebar } from '@/contexts/SidebarContext';
import { getVersionString, getBuildVersion } from '@/lib/version';

export default function Sidebar() {
  const { isSidebarOpen, closeSidebar } = useSidebar();

  return (
    <>
      {/* Sidebar */}
      <div className={`fixed top-0 left-0 h-full w-80 bg-gray-900/95 backdrop-blur-sm transform transition-transform duration-300 z-30 border-r border-gray-700 overflow-y-auto ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-4 pt-16 flex flex-col min-h-full">
          <h2 className="text-lg font-bold mb-4 text-white">Menu</h2>

          {/* Navigation Links */}
          <div className="mb-4 space-y-1">
            <Link
              href="/about"
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors text-gray-300"
              onClick={() => closeSidebar()}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-gray-300">About & Support</span>
            </Link>
          </div>

          {/* Version Display */}
          <div className="mt-auto pt-2 border-t border-gray-700 pb-20">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Version</span>
              <span className="text-xs text-gray-400 font-mono">{getVersionString()}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-gray-500">Build</span>
              <span className="text-xs text-gray-400 font-mono">{getBuildVersion()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay to close sidebar when clicking outside */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20"
          onClick={() => closeSidebar()}
        />
      )}
    </>
  );
}
