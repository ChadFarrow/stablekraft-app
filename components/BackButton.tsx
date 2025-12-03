'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  href?: string;
  label?: string;
  className?: string;
  onClick?: () => void;
  useHistory?: boolean; // Use browser back() instead of href
}

export default function BackButton({
  href = '/',
  label = 'Back',
  className = '',
  onClick,
  useHistory = true // Default to using browser history
}: BackButtonProps) {
  const router = useRouter();
  const baseClasses = "flex items-center gap-2 text-gray-400 hover:text-white transition-all duration-200 p-2 rounded-lg hover:bg-white/5 active:scale-95";
  const combinedClasses = `${baseClasses} ${className}`;

  // Check if user came from external source (share link)
  const isExternalEntry = () => {
    if (typeof window === 'undefined') return false;

    // No referrer means direct navigation or external link
    if (!document.referrer) return true;

    // Check if referrer is from a different domain
    try {
      const referrerUrl = new URL(document.referrer);
      const currentUrl = new URL(window.location.href);
      return referrerUrl.hostname !== currentUrl.hostname;
    } catch {
      return true;
    }
  };

  const handleBack = () => {
    if (isExternalEntry()) {
      router.push(href);
    } else {
      router.back();
    }
  };

  // Custom onClick handler takes priority
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

  // Use browser history by default, but go to home for external entries
  if (useHistory) {
    return (
      <button
        onClick={handleBack}
        className={combinedClasses}
      >
        <ArrowLeft className="h-5 w-5" />
        <span className="text-sm font-medium">{label}</span>
      </button>
    );
  }

  // Fallback to Link with specific href
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