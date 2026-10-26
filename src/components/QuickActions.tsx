import React, { useState } from 'react';
import { Plus, Scissors, UserPlus, Calendar, X } from 'lucide-react';

interface QuickActionsProps {
  onNewVisit: () => void;
  onNewClient: () => void;
  onNewAppointment: () => void;
}

/**
 * Botón flotante (+) solo para móvil. Concentra las 3 acciones más usadas
 * a un toque del pulgar, sobre la barra de navegación inferior.
 */
export const QuickActions: React.FC<QuickActionsProps> = ({ onNewVisit, onNewClient, onNewAppointment }) => {
  const [open, setOpen] = useState(false);

  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const items = [
    { label: 'Registrar visita', icon: Scissors, onClick: act(onNewVisit), cls: 'bg-amber-500 text-slate-950' },
    { label: 'Agendar cita', icon: Calendar, onClick: act(onNewAppointment), cls: 'bg-[#1e222b] text-amber-300 border border-amber-500/40' },
    { label: 'Nuevo cliente', icon: UserPlus, onClick: act(onNewClient), cls: 'bg-[#1e222b] text-slate-100 border border-[#2d3442]' }
  ];

  return (
    <div className="md:hidden">
      {open && <div className="fixed inset-0 z-30 bg-black/60 animate-fade-in" onClick={() => setOpen(false)} />}

      <div className="fixed right-4 z-40 flex flex-col items-end gap-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))]">
        {open &&
          items.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={item.onClick}
                className={`flex items-center gap-2.5 pl-4 pr-5 py-3 rounded-full shadow-xl text-sm font-semibold animate-slide-up ${item.cls}`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}

        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Cerrar acciones rápidas' : 'Acciones rápidas'}
          aria-expanded={open}
          className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-xl shadow-black/50 flex items-center justify-center active:scale-95 transition-transform"
        >
          {open ? <X className="w-6 h-6" /> : <Plus className="w-7 h-7" />}
        </button>
      </div>
    </div>
  );
};
