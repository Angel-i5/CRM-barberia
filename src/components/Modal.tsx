import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
}

// Contador global: con varios modales abiertos a la vez (ficha -> archivar)
// el scroll de la página solo se libera al cerrar el último.
let openModals = 0;

/**
 * En móvil se muestra como "hoja inferior" (bottom sheet) a pantalla casi completa,
 * fácil de alcanzar con el pulgar; en pantallas grandes, como diálogo centrado.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'lg'
}) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    openModals++;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl',
    '2xl': 'sm:max-w-2xl',
    '4xl': 'sm:max-w-4xl'
  }[maxWidth];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        className={`relative w-full ${maxWidthClasses} bg-[#14171d] border border-[#2a2f3d] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[92dvh] sm:max-h-[90vh] animate-slide-up`}
        onClick={e => e.stopPropagation()}
      >
        {/* Asa visual de la hoja inferior (solo móvil) */}
        <div className="sm:hidden flex justify-center pt-2 bg-[#111317]">
          <span className="w-10 h-1 rounded-full bg-slate-600" />
        </div>

        <div className="px-4 py-3 sm:p-5 border-b border-[#222631] flex items-start justify-between gap-3 bg-[#111317] shrink-0">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-white tracking-wide font-display leading-snug">
              {title}
            </h3>
            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
          </div>

          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 -mr-1 text-slate-400 hover:text-white hover:bg-[#1f232d] rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
};
