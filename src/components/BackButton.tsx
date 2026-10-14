import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function BackButton({
  className = '',
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();

  return (
    <button
      onClick={onClick || (() => navigate(-1))}
      className={`group absolute top-4 left-4 z-50 flex items-center gap-2 h-10 px-4 rounded-full bg-surface-container-lowest/90 backdrop-blur-md text-on-surface-variant hover:text-on-surface shadow-card border border-[var(--elevated-border)] transition-all active:scale-95 ${className}`}
      aria-label="Go back"
    >
      <ArrowLeft className="w-4 h-4 icon-slide-back" />
      <span className="text-sm font-semibold">Back</span>
    </button>
  );
}
