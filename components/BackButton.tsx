'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  href?: string;
  label?: string;
  className?: string;
  onClick?: () => void;
}

export default function BackButton({ 
  href = '/', 
  label = 'Back', 
  className = '',
  onClick 
}: BackButtonProps) {
  const baseClasses = "flex items-center gap-2 text-gray-400 hover:text-white transition-all duration-200 p-2 rounded-lg hover:bg-white/5 active:scale-95";
  const combinedClasses = `${baseClasses} ${className}`;

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={combinedClasses}
      >
        <ArrowLeft className="h-5 w-5" />
        <span className="text-sm font-medium">{label}</span>
      </button>
    );
  }

  return (
    <Link 
      href={href} 
      className={combinedClasses}
    >
      <ArrowLeft className="h-5 w-5" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}