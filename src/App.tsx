/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { QuickActions } from './components/QuickActions';
import { VisitModal } from './components/VisitModal';
import { Modal } from './components/Modal';
import { DashboardPage } from './pages/DashboardPage';
import { ClientsPage } from './pages/ClientsPage';
import { VisitsPage } from './pages/VisitsPage';
import { FollowUpPage } from './pages/FollowUpPage';
import { CardsPage } from './pages/CardsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PublicCardPage } from './pages/PublicCardPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { ServicesPage } from './pages/ServicesPage';
import { useCRM } from './hooks/useCRM';
import { Client, RewardTier } from './types';
import { Gift, Scissors, Calendar, LayoutDashboard, Users, MoreHorizontal, X, CheckCircle2, AlertTriangle, Info, CloudUpload } from 'lucide-react';
import { normalizePhone, generateLoyaltyCode, generateId, todayYMD, scriptIdToUrl } from './utils/formatters';
import { describeTier } from './utils/loyalty';

interface PublicTarget {
  code: string;
  scriptUrl?: string;
}

function detectPublicCard(): PublicTarget | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('card') || params.get('c');
  const s = params.get('s');
  const scriptUrl = s ? scriptIdToUrl(s) : undefined;
  if (code) return { code, scriptUrl };
  const hash = window.location.hash;
  if (hash.startsWith('#/card/')) return { code: hash.replace('#/card/', '').trim(), scriptUrl };
  return null;
}

const TOAST_STYLE = {
  success: { cls: 'bg-emerald-950/95 border-emerald-700/60 text-emerald-100', Icon: CheckCircle2 },
  error: { cls: 'bg-red-950/95 border-red-700/60 text-red-100', Icon: AlertTriangle },
  info: { cls: 'bg-[#1a1f2b]/95 border-[#33405a] text-slate-100', Icon: Info }
} as const;

export default function App() {
  const crm = useCRM();
  const {
    clients,
    visits,
    followUps,
    appointments,
    services,
    settings,
    loading,
    isSyncing,
    status,
    pendingCount,
    needsInitialUpload,
    lastSyncTime,
    stats,
    toasts,
    dismissToast,
    reloadAll,
    saveClient,
    archiveClient,
    registerVisit,
    updateVisit,
    deleteVisit,
    redeemReward,
    logFollowUp,
    updateSettings,
    saveAppointment,
    updateAppointmentStatus,
    deleteAppointment,
    completeAppointmentAndRegisterVisit,
    saveService,
    deleteService,
    toggleServiceActive,
    resetDefaultServices,
    uploadInitialData,
    loadDemoData,
    clearBusinessData
  } = crm;

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedClientForCard, setSelectedClientForCard] = useState<Client | null>(null);
  const [aptRequest, setAptRequest] = useState<{ clientId?: string; nonce: number } | undefined>(undefined);
  const [followRequest, setFollowRequest] = useState<{ clientId: string; nonce: number } | undefined>(undefined);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [publicTarget, setPublicTarget] = useState<PublicTarget | null>(detectPublicCard);

  const [quickVisitOpen, setQuickVisitOpen] = useState(false);
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [qcName, setQcName] = useState('');
  const [qcPhone, setQcPhone] = useState('+58');
  const [qcCut, setQcCut] = useState('');
  const [qcError, setQcError] = useState<string | null>(null);
  const [qcSaving, setQcSaving] = useState(false);

  const [rewardTarget, setRewardTarget] = useState<{ client: Client; tier: RewardTier } | null>(null);
  const [rewardNotes, setRewardNotes] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);

  const hasBusinessData = useMemo(
    () => clients.length > 0 || visits.length > 0 || appointments.length > 0,
    [clients.length, visits.length, appointments.length]
  );

  const goTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsMenuOpen(false);
  };

  const scheduleFor = (clientId?: string) => {
    setAptRequest({ clientId, nonce: Date.now() });
    goTab('appointments');
  };

  const openFollowUp = (client: Client) => {
    setFollowRequest({ clientId: client.id, nonce: Date.now() });
    goTab('followup');
  };

  const openCardStudio = (client: Client) => {
    setSelectedClientForCard(client);
    goTab('cards');
  };

  const handleQuickClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setQcError(null);
    if (!qcName.trim()) return setQcError('El nombre es obligatorio.');
    if (!normalizePhone(qcPhone).isValid) return setQcError('Ingresa un teléfono con código de país (ej: +584121234567).');

    setQcSaving(true);
    const res = await saveClient({
      id: generateId('CLI'),
      name: qcName.trim(),
      phone: qcPhone.trim(),
      createdAt: todayYMD(),
      lastVisitAt: null,
      cutPreferences: qcCut.trim(),
      notes: '',
      totalVisits: 0,
      cycleVisits: 0,
      totalSpent: 0,
      status: 'active',
      marketingConsent: true,
      loyaltyCode: generateLoyaltyCode(),
      cardIssuedAt: todayYMD(),
      cardStyle: settings.cardStyle || 'obsidian',
      claimedTiers: ''
    });
    setQcSaving(false);

    if (!res.success) {
      setQcError(res.error || 'Error al guardar el cliente.');
    } else {
      setQuickClientOpen(false);
      setQcName('');
      setQcPhone('+58');
      setQcCut('');
    }
  };

  const confirmRedeem = async () => {
    if (!rewardTarget) return;
    setIsRedeeming(true);
    await redeemReward(rewardTarget.client, rewardTarget.tier, rewardNotes.trim() || undefined);
    setIsRedeeming(false);
    setRewardTarget(null);
    setRewardNotes('');
  };

  // Vista pública de la tarjeta (enlace que recibe el cliente por WhatsApp)
  if (publicTarget) {
    return (
      <PublicCardPage
        loyaltyCode={publicTarget.code}
        scriptUrl={publicTarget.scriptUrl}
        onBackToCRM={() => {
          setPublicTarget(null);
          window.history.replaceState({}, '', window.location.pathname);
        }}
      />
    );
  }

  const bottomItem = (tab: ActiveTab, label: string, Icon: React.ElementType, dot?: string) => (
    <button
      key={tab}
      onClick={() => goTab(tab)}
      aria-current={activeTab === tab ? 'page' : undefined}
      className={`relative flex-1 flex flex-col items-center justify-center py-2 rounded-lg text-[10px] font-medium ${
        activeTab === tab ? 'text-amber-400 font-bold' : 'text-slate-400'
      }`}
    >
      <Icon className="w-5 h-5 mb-0.5" />
      <span>{label}</span>
      {dot && <span className={`absolute top-1 right-[28%] w-2 h-2 rounded-full ${dot} animate-pulse`} />}
    </button>
  );

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-[#0c0d10] text-slate-100 font-sans selection:bg-amber-600/30 selection:text-amber-200">
      <Sidebar
        activeTab={activeTab}
        onTabChange={goTab}
        pendingContactsCount={stats.pendingContacts}
        rewardReadyCount={stats.clientsWithRewardReady}
        pendingAppointmentsCount={stats.pendingAppointmentsCount || 0}
        servicesCount={stats.activeServicesCount}
        status={status}
        isSyncing={isSyncing}
        onSyncClick={() => reloadAll()}
        barbershopName={settings.barbershopName}
        isOpenMobile={isMenuOpen}
        onCloseMobile={() => setIsMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#0b0c0e]">
        <Navbar
          barbershopName={settings.barbershopName}
          onNewVisit={() => setQuickVisitOpen(true)}
          onNewClient={() => {
            setQcError(null);
            setQuickClientOpen(true);
          }}
          onNewAppointment={() => scheduleFor(undefined)}
          status={status}
          pendingCount={pendingCount}
          isSyncing={isSyncing}
          onSync={() => reloadAll()}
          lastSyncTime={lastSyncTime}
        />

        <main className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-6 lg:p-8 pb-28 md:pb-8">
          {needsInitialUpload && activeTab !== 'settings' && (
            <button
              onClick={() => goTab('settings')}
              className="w-full mb-4 p-3.5 rounded-xl bg-amber-950/40 border border-amber-700/50 text-left flex items-center gap-3"
            >
              <CloudUpload className="w-5 h-5 text-amber-400 shrink-0" />
              <span className="text-xs text-amber-100">
                <strong>Tu hoja de Google está vacía.</strong> Toca aquí para subir los datos de este dispositivo.
              </span>
            </button>
          )}

          {loading && clients.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
              <p className="text-xs text-slate-400">Cargando datos…</p>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <DashboardPage
                  stats={stats}
                  clients={clients}
                  visits={visits}
                  appointments={appointments}
                  settings={settings}
                  onNavigateTab={tab => goTab(tab as ActiveTab)}
                  onSelectClientForCard={openCardStudio}
                  onSelectClientForWhatsApp={openFollowUp}
                  onScheduleAppointment={client => scheduleFor(client?.id)}
                  onRedeemReward={(client, tier) => setRewardTarget({ client, tier })}
                />
              )}

              {activeTab === 'appointments' && (
                <AppointmentsPage
                  appointments={appointments}
                  clients={clients}
                  settings={settings}
                  services={services}
                  onSaveAppointment={saveAppointment}
                  onUpdateStatus={updateAppointmentStatus}
                  onDeleteAppointment={deleteAppointment}
                  onCompleteAndRegisterVisit={completeAppointmentAndRegisterVisit}
                  request={aptRequest}
                />
              )}

              {activeTab === 'clients' && (
                <ClientsPage
                  clients={clients}
                  visits={visits}
                  settings={settings}
                  onSaveClient={saveClient}
                  onArchiveClient={archiveClient}
                  onRedeemReward={(client, tier) => setRewardTarget({ client, tier })}
                  onOpenCardStudio={openCardStudio}
                  onOpenWhatsApp={openFollowUp}
                  onScheduleAppointment={client => scheduleFor(client.id)}
                />
              )}

              {activeTab === 'visits' && (
                <VisitsPage
                  visits={visits}
                  clients={clients}
                  settings={settings}
                  services={services}
                  onRegisterVisit={registerVisit}
                  onUpdateVisit={updateVisit}
                  onDeleteVisit={deleteVisit}
                />
              )}

              {activeTab === 'services' && (
                <ServicesPage
                  services={services}
                  settings={settings}
                  onSaveService={saveService}
                  onDeleteService={deleteService}
                  onToggleActive={toggleServiceActive}
                  onResetDefaults={resetDefaultServices}
                />
              )}

              {activeTab === 'followup' && (
                <FollowUpPage
                  clients={clients}
                  followUps={followUps}
                  settings={settings}
                  onLogFollowUp={logFollowUp}
                  onOpenCardStudio={openCardStudio}
                  onScheduleAppointment={client => scheduleFor(client.id)}
                  request={followRequest}
                />
              )}

              {activeTab === 'cards' && (
                <CardsPage
                  clients={clients}
                  settings={settings}
                  selectedClient={selectedClientForCard}
                  onSelectClient={setSelectedClientForCard}
                  onLogFollowUp={logFollowUp}
                  onOpenPublicCardView={code => setPublicTarget({ code })}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsPage
                  settings={settings}
                  onUpdateSettings={updateSettings}
                  status={status}
                  pendingCount={pendingCount}
                  needsInitialUpload={needsInitialUpload}
                  onUploadInitialData={uploadInitialData}
                  onLoadDemoData={loadDemoData}
                  onClearBusinessData={clearBusinessData}
                  hasBusinessData={hasBusinessData}
                  onNavigateTab={tab => goTab(tab as ActiveTab)}
                  servicesCount={stats.activeServicesCount}
                />
              )}
            </>
          )}
        </main>

        {/* Menú inferior (móvil) */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-[#111317]/95 backdrop-blur-lg border-t border-[#20242b] px-1 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] flex items-stretch select-none">
          {bottomItem('dashboard', 'Panel', LayoutDashboard)}
          {bottomItem('appointments', 'Citas', Calendar, (stats.pendingAppointmentsCount || 0) > 0 ? 'bg-amber-500' : undefined)}
          {bottomItem('clients', 'Clientes', Users, stats.clientsWithRewardReady > 0 ? 'bg-emerald-400' : undefined)}
          {bottomItem('visits', 'Visitas', Scissors)}
          <button
            onClick={() => setIsMenuOpen(true)}
            className={`relative flex-1 flex flex-col items-center justify-center py-2 rounded-lg text-[10px] font-medium ${
              ['followup', 'cards', 'settings', 'services'].includes(activeTab) ? 'text-amber-400 font-bold' : 'text-slate-400'
            }`}
          >
            <MoreHorizontal className="w-5 h-5 mb-0.5" />
            <span>Más</span>
            {stats.pendingContacts > 0 && (
              <span className="absolute top-1 right-[28%] w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
        </nav>

        {activeTab !== 'settings' && (
        <QuickActions
          onNewVisit={() => setQuickVisitOpen(true)}
          onNewClient={() => {
            setQcError(null);
            setQuickClientOpen(true);
          }}
          onNewAppointment={() => scheduleFor(undefined)}
        />
        )}
      </div>

      {/* Avisos */}
      <div className="fixed z-50 left-3 right-3 top-3 md:left-auto md:right-4 md:w-96 space-y-2 pointer-events-none">
        {toasts.map(t => {
          const { cls, Icon } = TOAST_STYLE[t.kind as keyof typeof TOAST_STYLE] || TOAST_STYLE.info;
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl border shadow-2xl text-xs animate-slide-up ${cls}`}
            >
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismissToast(t.id)} aria-label="Cerrar aviso" className="p-1 opacity-70" data-compact>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <VisitModal
        isOpen={quickVisitOpen}
        onClose={() => setQuickVisitOpen(false)}
        clients={clients}
        services={services}
        settings={settings}
        onRegisterVisit={registerVisit}
        onUpdateVisit={updateVisit}
      />

      {quickClientOpen && (
        <Modal isOpen onClose={() => setQuickClientOpen(false)} title="Nuevo cliente" subtitle="Alta rápida en segundos" maxWidth="sm">
          <form onSubmit={handleQuickClient} className="space-y-3.5 text-xs">
            {qcError && <div className="p-2.5 bg-red-950/50 border border-red-800/60 rounded-lg text-red-200">{qcError}</div>}
            <div>
              <label className="block text-slate-300 font-medium mb-1">Nombre completo *</label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Ej. Martín Soler"
                value={qcName}
                onChange={e => setQcName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">Teléfono con código de país *</label>
              <input
                type="tel"
                inputMode="tel"
                required
                placeholder="+584121234567"
                value={qcPhone}
                onChange={e => setQcPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white font-mono text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">Corte habitual</label>
              <input
                type="text"
                placeholder="Ej. Fade medio con textura"
                value={qcCut}
                onChange={e => setQcCut(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white text-sm focus:outline-none"
              />
            </div>
            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button type="button" onClick={() => setQuickClientOpen(false)} className="px-3 py-2.5 text-slate-400">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={qcSaving}
                className="px-5 py-2.5 font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg disabled:opacity-50"
              >
                {qcSaving ? 'Guardando…' : 'Crear cliente'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {rewardTarget && (
        <Modal isOpen onClose={() => setRewardTarget(null)} title="Canjear premio" maxWidth="sm">
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-center space-y-2">
              <Gift className="w-8 h-8 text-amber-400 mx-auto" />
              <p className="font-bold text-white text-sm">{rewardTarget.client.name}</p>
              <p className="text-amber-300 font-medium">{rewardTarget.tier.title}</p>
              <p className="text-[11px] text-slate-400">{describeTier(rewardTarget.tier)}</p>
            </div>
            <p className="text-slate-400 text-[11px]">
              Queda registrado el canje. Si es el último nivel de la tarjeta, el ciclo vuelve a 0 y el historial total de visitas se conserva.
            </p>
            <div>
              <label className="block text-slate-400 font-medium mb-1">Notas del canje (opcional)</label>
              <input
                type="text"
                placeholder="Ej. Aplicado en la cita de hoy"
                value={rewardNotes}
                onChange={e => setRewardNotes(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] rounded-lg text-white text-sm focus:outline-none"
              />
            </div>
            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button type="button" onClick={() => setRewardTarget(null)} className="px-3 py-2.5 text-slate-400">
                Cancelar
              </button>
              <button
                type="button"
                disabled={isRedeeming}
                onClick={confirmRedeem}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg disabled:opacity-50"
              >
                {isRedeeming ? 'Procesando…' : 'Confirmar canje ✓'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
