import React from 'react';
import {
  LayoutDashboard,
  Users,
  Scissors,
  MessageCircle,
  CreditCard,
  Settings,
  Sparkles,
  RefreshCw,
  Database,
  Calendar,
  X
} from 'lucide-react';
import type { ConnectionStatus } from '../services/api';

export type ActiveTab =
  | 'dashboard'
  | 'clients'
  | 'visits'
  | 'appointments'
  | 'services'
  | 'followup'
  | 'cards'
  | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  pendingContactsCount: number;
  rewardReadyCount: number;
  pendingAppointmentsCount: number;
  servicesCount?: number;
  status: ConnectionStatus;
  isSyncing: boolean;
  onSyncClick: () => void;
  barbershopName: string;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

const STATUS_TEXT: Record<ConnectionStatus, { title: string; sub: string; color: string }> = {
  remote: { title: 'Google Sheets', sub: 'Conectado en vivo', color: 'text-emerald-400' },
  local: { title: 'Almacenamiento local', sub: 'Sheets sin enlazar', color: 'text-amber-400' },
  offline: { title: 'Sin conexión', sub: 'Se enviará al volver', color: 'text-orange-400' },
  unauthorized: { title: 'Clave incorrecta', sub: 'Revisa Ajustes', color: 'text-red-400' }
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  pendingContactsCount,
  rewardReadyCount,
  pendingAppointmentsCount,
  servicesCount = 0,
  status,
  isSyncing,
  onSyncClick,
  barbershopName,
  isOpenMobile = false,
  onCloseMobile
}) => {
  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ElementType;
    badge: string | null;
    badgeColor?: string;
  }[] = [
    { id: 'dashboard', label: 'Panel', icon: LayoutDashboard, badge: null },
    {
      id: 'appointments',
      label: 'Agenda de Citas',
      icon: Calendar,
      badge: pendingAppointmentsCount > 0 ? `${pendingAppointmentsCount}` : null,
      badgeColor: 'bg-amber-950 text-amber-300 border border-amber-800/60'
    },
    {
      id: 'clients',
      label: 'Clientes',
      icon: Users,
      badge: rewardReadyCount > 0 ? `${rewardReadyCount} 🎁` : null,
      badgeColor: 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
    },
    { id: 'visits', label: 'Visitas', icon: Scissors, badge: null },
    {
      id: 'services',
      label: 'Servicios y Tarifas',
      icon: Sparkles,
      badge: servicesCount > 0 ? `${servicesCount}` : null,
      badgeColor: 'bg-sky-950 text-sky-300 border border-sky-800/60'
    },
    {
      id: 'followup',
      label: 'Seguimiento',
      icon: MessageCircle,
      badge: pendingContactsCount > 0 ? `${pendingContactsCount}` : null,
      badgeColor: 'bg-amber-950 text-amber-300 border border-amber-800/60'
    },
    { id: 'cards', label: 'Tarjetas Digitales', icon: CreditCard, badge: null },
    { id: 'settings', label: 'Ajustes y Sheets', icon: Settings, badge: null }
  ];

  const handleItemClick = (id: ActiveTab) => {
    onTabChange(id);
    onCloseMobile?.();
  };

  const st = STATUS_TEXT[status];

  const renderContent = (isMobileView: boolean) => (
    <>
      <div className="min-h-0 flex-1 flex flex-col">
        <div className="safe-top shrink-0 border-b border-[#20242b]">
          <div className="p-4 sm:p-5 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-600 to-amber-900 flex items-center justify-center shadow-md shadow-amber-950/40 border border-amber-500/30 shrink-0">
                <Scissors className="w-5 h-5 text-amber-200 -rotate-45" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="font-semibold text-sm tracking-wide text-white truncate font-display">
                  {barbershopName || 'BARBER CRM'}
                </h1>
                <p className="text-[11px] text-amber-500/80 tracking-widest font-mono uppercase">
                  Fidelización VIP
                </p>
              </div>
            </div>

            {isMobileView && onCloseMobile && (
              <button
                onClick={onCloseMobile}
                className="p-2 text-slate-400 hover:text-white hover:bg-[#1f232d] rounded-lg transition-colors ml-2"
                aria-label="Cerrar menú"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        <nav className="p-3 space-y-1 overflow-y-auto flex-1" aria-label="Navegación principal">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3.5 py-3 md:py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-600/15 text-amber-300 border border-amber-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#181a20] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-sm ${
                      item.badgeColor || 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-3 border-t border-[#20242b] bg-[#0c0d10] shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#15181f] border border-[#232731]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Database className={`w-3.5 h-3.5 shrink-0 ${st.color}`} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-200 truncate">{st.title}</p>
              <p className="text-[10px] text-slate-500 truncate">{st.sub}</p>
            </div>
          </div>
          <button
            onClick={onSyncClick}
            disabled={isSyncing}
            aria-label="Recargar datos"
            className="p-2 text-slate-400 hover:text-amber-300 hover:bg-[#20242e] rounded-md transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Escritorio: barra lateral fija */}
      <aside className="hidden md:flex w-64 bg-[#111317] border-r border-[#20242b] flex-col shrink-0 select-none">
        {renderContent(false)}
      </aside>

      {/* Móvil: cajón lateral con fondo oscuro (menú "Más") */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="fixed inset-0 bg-black/75 animate-fade-in" onClick={onCloseMobile} />
          <div className="relative w-72 max-w-[85vw] bg-[#111317] border-r border-[#20242b] flex flex-col z-10 shadow-2xl h-full animate-slide-in-left">
            {renderContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
