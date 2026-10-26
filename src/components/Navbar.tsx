import React from 'react';
import { Scissors, UserPlus, RefreshCw, Calendar, WifiOff, CloudOff, ShieldAlert } from 'lucide-react';
import type { ConnectionStatus } from '../services/api';

interface NavbarProps {
  barbershopName: string;
  onNewVisit: () => void;
  onNewClient: () => void;
  onNewAppointment: () => void;
  status: ConnectionStatus;
  pendingCount: number;
  isSyncing: boolean;
  onSync: () => void;
  lastSyncTime: Date;
}

const STATUS_UI: Record<
  ConnectionStatus,
  { label: string; short: string; cls: string; dot: string }
> = {
  remote: {
    label: 'Google Sheets conectado',
    short: 'Sheets',
    cls: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/40',
    dot: 'bg-emerald-400 animate-pulse'
  },
  local: {
    label: 'Modo local (sin enlazar Sheets)',
    short: 'Local',
    cls: 'text-amber-400/90 bg-amber-950/40 border-amber-800/40',
    dot: 'bg-amber-400'
  },
  offline: {
    label: 'Sin conexión con Sheets',
    short: 'Sin red',
    cls: 'text-orange-300 bg-orange-950/40 border-orange-800/40',
    dot: 'bg-orange-400'
  },
  unauthorized: {
    label: 'Clave de API incorrecta',
    short: 'Clave',
    cls: 'text-red-300 bg-red-950/40 border-red-800/40',
    dot: 'bg-red-400'
  }
};

export const Navbar: React.FC<NavbarProps> = ({
  barbershopName,
  onNewVisit,
  onNewClient,
  onNewAppointment,
  status,
  pendingCount,
  isSyncing,
  onSync,
  lastSyncTime
}) => {
  const ui = STATUS_UI[status];
  const StatusIcon = status === 'offline' ? WifiOff : status === 'unauthorized' ? ShieldAlert : null;

  return (
    <header className="safe-top bg-[#111317]/95 backdrop-blur-md border-b border-[#20242b] z-10 shrink-0">
      <div className="h-14 sm:h-16 px-3 sm:px-6 flex items-center justify-between gap-2">
        {/* Izquierda: marca (móvil) / estado de conexión */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <div className="md:hidden flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-600 to-amber-900 flex items-center justify-center border border-amber-500/30 shrink-0">
              <Scissors className="w-4 h-4 text-amber-200 -rotate-45" />
            </div>
            <span className="font-semibold text-sm text-white truncate font-display">
              {barbershopName || 'BARBER CRM'}
            </span>
          </div>

          <span
            className={`hidden md:flex items-center gap-1.5 text-xs border px-2.5 py-1 rounded-md shrink-0 ${ui.cls}`}
            title={ui.label}
          >
            {StatusIcon ? <StatusIcon className="w-3.5 h-3.5" /> : <span className={`w-2 h-2 rounded-full shrink-0 ${ui.dot}`} />}
            <span>{ui.label}</span>
          </span>

          {pendingCount > 0 && (
            <span
              className="hidden md:flex items-center gap-1.5 text-xs text-orange-300 bg-orange-950/40 border border-orange-800/40 px-2.5 py-1 rounded-md shrink-0"
              title="Cambios guardados en este dispositivo que aún no llegaron a Google Sheets"
            >
              <CloudOff className="w-3.5 h-3.5" />
              {pendingCount} pendiente{pendingCount === 1 ? '' : 's'} de enviar
            </span>
          )}

          <span className="text-xs text-slate-400 hidden lg:inline truncate">
            Sinc: {lastSyncTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Derecha */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Móvil: estado compacto */}
          <span
            className={`md:hidden flex items-center gap-1.5 text-[10px] font-semibold border px-2 py-1 rounded-md ${ui.cls}`}
            title={ui.label}
          >
            <span className={`w-2 h-2 rounded-full ${ui.dot}`} />
            {pendingCount > 0 ? `${pendingCount} ↑` : ui.short}
          </span>

          <button
            onClick={onSync}
            disabled={isSyncing}
            aria-label="Sincronizar datos"
            className="p-2 sm:px-2.5 sm:py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-[#181a20] hover:bg-[#20242c] border border-[#2a2f3a] rounded-lg transition-colors disabled:opacity-50 shrink-0 flex items-center"
            title="Sincronizar datos"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-amber-400' : ''}`} />
            <span className="hidden lg:inline ml-1.5">Sincronizar</span>
          </button>

          {/* Escritorio: acciones rápidas (en móvil están en el botón flotante +) */}
          <button
            onClick={onNewAppointment}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-300 bg-amber-950/30 hover:bg-amber-900/40 border border-amber-500/30 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>Agendar Cita</span>
          </button>

          <button
            onClick={onNewClient}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#1e222b] hover:bg-[#272d38] border border-[#2d3442] hover:border-slate-500 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5 text-slate-300" />
            <span className="hidden lg:inline">Nuevo Cliente</span>
          </button>

          <button
            onClick={onNewVisit}
            className="hidden md:flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded-lg transition-all shadow-md shadow-amber-950/40 cursor-pointer active:scale-95 shrink-0"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Registrar Visita</span>
          </button>
        </div>
      </div>
    </header>
  );
};
