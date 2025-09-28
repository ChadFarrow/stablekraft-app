'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';

// Dynamic import for the ControlsBar component with playlist support
const ControlsBar = dynamic(() => import('./ControlsBar'), {
  loading: () => (
    <div className="mb-8 p-4 bg-gray-800/20 rounded-lg animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-8 bg-gray-700/50 rounded w-24"></div>
        <div className="h-8 bg-gray-700/50 rounded w-20"></div>
        <div className="h-8 bg-gray-700/50 rounded w-16"></div>
        <div className="h-8 bg-gray-700/50 rounded w-20"></div>
      </div>
    </div>
  ),
  ssr: true // Controls can be server-side rendered
});

// Temporary direct import for debugging
import ControlsBarDirect from './ControlsBar';

// Re-export the types from the original component
export type { FilterType, ViewType, SortType } from './ControlsBar';

interface ControlsBarLazyProps {
  // Filter props
  activeFilter: any;
  onFilterChange: (filter: any) => void;
  showFilters?: boolean;
  filterOptions?: { value: any; label: string }[];
  isFilterLoading?: boolean;
  
  // Sort props
  sortType: any;
  onSortChange: (sort: any) => void;
  sortOptions?: { value: any; label: string }[];
  showSort?: boolean;
  
  // View props
  viewType: any;
  onViewChange: (view: any) => void;
  showViewToggle?: boolean;
  
  // Shuffle prop
  onShuffle?: () => void;
  showShuffle?: boolean;
  
  // Customization
  className?: string;
  resultCount?: number;
  resultLabel?: string;
}

export default function ControlsBarLazy(props: ControlsBarLazyProps) {
  console.log('ControlsBarLazy render:', props);
  return (
    <Suspense fallback={
      <div className="mb-8 p-4 bg-gray-800/20 rounded-lg animate-pulse">
        <div className="flex items-center gap-4">
          <div className="h-8 bg-gray-700/50 rounded w-24"></div>
          <div className="h-8 bg-gray-700/50 rounded w-20"></div>
          <div className="h-8 bg-gray-700/50 rounded w-16"></div>
          <div className="h-8 bg-gray-700/50 rounded w-20"></div>
        </div>
      </div>
    }>
      <ControlsBarDirect {...props} />
    </Suspense>
  );
} 