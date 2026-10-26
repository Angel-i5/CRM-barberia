import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Plus,
  Phone,
  Calendar,
  Gift,
  CreditCard,
  MessageCircle,
  Edit2,
  History,
  Scissors,
  CheckCircle,
  FileText,
  AlertTriangle,
  X,
  Eye
} from 'lucide-react';
import { Client, Visit, CRMSettings, RewardTier } from '../types';
import {
  formatCurrency,
  formatDate,
  getDaysSinceDate,
  formatDaysAbsent,
  normalizePhone,
  generateLoyaltyCode,
  generateId,
  getClientCardUrl,
  todayYMD
} from '../utils/formatters';
import { getUnlockedTiers, tierShortLabel } from '../utils/loyalty';
import { Modal } from '../components/Modal';
import { TierProgress } from '../components/TierProgress';

interface ClientsPageProps {
  clients: Client[];
  visits: Visit[];
  settings: CRMSettings;
  onSaveClient: (client: Client) => Promise<{ success: boolean; client: Client; error?: string }>;
  onArchiveClient: (clientId: string) => Promise<boolean>;
  onRedeemReward: (client: Client, tier: RewardTier) => void;
  onOpenCardStudio: (client: Client) => void;
  onOpenWhatsApp: (client: Client) => void;
  onScheduleAppointment?: (client: Client) => void;
}

const inputCls =
  'w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white text-sm focus:outline-none';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: 'Activo', cls: 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40' },
  inactive: { label: 'Inactivo', cls: 'bg-amber-950/40 text-amber-400 border border-amber-800/30' },
  archived: { label: 'Archivado', cls: 'bg-slate-800 text-slate-400 border border-slate-700/40' }
};

const chip = (active: boolean) =>
  `shrink-0 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
    active
      ? 'bg-amber-600/25 text-amber-300 border border-amber-600/40'
      : 'text-slate-400 hover:text-white bg-[#171a21] border border-transparent'
  }`;

export const ClientsPage: React.FC<ClientsPageProps> = ({
  clients,
  visits,
  settings,
  onSaveClient,
  onArchiveClient,
  onRedeemReward,
  onOpenCardStudio,
  onOpenWhatsApp,
  onScheduleAppointment
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'archived'>('active');
  const [inactivityFilter, setInactivityFilter] = useState<string>('all');
  const [frequencyFilter, setFrequencyFilter] = useState<string>('all');
  const [onlyRewards, setOnlyRewards] = useState(false);

  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Client | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  // La ficha siempre muestra el dato más reciente del cliente (p. ej. tras canjear).
  const detail = detailId ? clients.find(c => c.id === detailId) || null : null;

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    birthday: '',
    cutPreferences: '',
    notes: '',
    marketingConsent: true,
    status: 'active' as 'active' | 'inactive' | 'archived',
    loyaltyCode: '',
    cardStyle: 'obsidian' as 'obsidian' | 'heritage'
  });

  const filteredClients = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return clients
      .filter(client => {
        const matchesSearch =
          !q ||
          client.name.toLowerCase().includes(q) ||
          client.phone.includes(q) ||
          (client.loyaltyCode && client.loyaltyCode.toLowerCase().includes(q));
        if (!matchesSearch) return false;

        if (statusFilter !== 'all' && client.status !== statusFilter) return false;
        if (frequencyFilter === 'frequent' && (client.totalVisits || 0) < 4) return false;
        if (frequencyFilter === 'new' && (client.totalVisits || 0) > 1) return false;
        if (onlyRewards && getUnlockedTiers(client, settings).length === 0) return false;

        const days = getDaysSinceDate(client.lastVisitAt);
        if (inactivityFilter === 'recent' && (days === null || days > 6)) return false;
        if (inactivityFilter === 'days7' && (days === null || days < 7 || days >= 14)) return false;
        if (inactivityFilter === 'days14' && (days === null || days < 14 || days >= 21)) return false;
        if (inactivityFilter === 'days21' && (days === null || days < 21 || days >= 30)) return false;
        if (inactivityFilter === 'days30plus' && (days === null || days < 30)) return false;
        if (inactivityFilter === 'no_visits' && days !== null) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, searchQuery, statusFilter, frequencyFilter, inactivityFilter, onlyRewards, settings]);

  const openCreate = () => {
    setEditingClient(null);
    setFormData({
      name: '',
      phone: '',
      birthday: '',
      cutPreferences: '',
      notes: '',
      marketingConsent: true,
      status: 'active',
      loyaltyCode: generateLoyaltyCode(),
      cardStyle: settings.cardStyle || 'obsidian'
    });
    setFormError(null);
    setIsClientModalOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    setFormData({
      name: client.name,
      phone: client.phone,
      birthday: client.birthday || '',
      cutPreferences: client.cutPreferences || '',
      notes: client.notes || '',
      marketingConsent: client.marketingConsent ?? true,
      status: client.status || 'active',
      loyaltyCode: client.loyaltyCode || generateLoyaltyCode(),
      cardStyle: client.cardStyle || 'obsidian'
    });
    setFormError(null);
    setIsClientModalOpen(true);
  };

  const handleSubmitClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) return setFormError('El nombre completo es obligatorio.');
    if (!normalizePhone(formData.phone).isValid) {
      return setFormError('Introduce un teléfono con prefijo internacional (ej: +584121234567).');
    }

    const code = (formData.loyaltyCode || generateLoyaltyCode()).trim().toUpperCase();
    const duplicate = clients.find(c => c.loyaltyCode?.toUpperCase() === code && c.id !== editingClient?.id);
    if (duplicate) return setFormError(`El código ${code} ya lo usa ${duplicate.name}. Elige otro.`);

    setIsSubmitting(true);
    const base: Client = editingClient || {
      id: generateId('CLI'),
      name: '',
      phone: '',
      createdAt: todayYMD(),
      lastVisitAt: null,
      cutPreferences: '',
      notes: '',
      totalVisits: 0,
      cycleVisits: 0,
      totalSpent: 0,
      status: 'active',
      marketingConsent: true,
      loyaltyCode: code,
      cardIssuedAt: todayYMD(),
      claimedTiers: ''
    };

    const toSave: Client = {
      ...base,
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      birthday: formData.birthday || undefined,
      cutPreferences: formData.cutPreferences.trim(),
      notes: formData.notes.trim(),
      status: formData.status,
      marketingConsent: formData.marketingConsent,
      loyaltyCode: code,
      cardIssuedAt: base.cardIssuedAt || todayYMD(),
      cardStyle: formData.cardStyle
    };

    const res = await onSaveClient(toSave);
    setIsSubmitting(false);
    if (!res.success) setFormError(res.error || 'Error al guardar el cliente.');
    else setIsClientModalOpen(false);
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    await onArchiveClient(archiveTarget.id);
    if (detailId === archiveTarget.id) setDetailId(null);
    setArchiveTarget(null);
  };

  const copyLink = async (client: Client) => {
    const url = getClientCardUrl(client.loyaltyCode, settings.googleAppsScriptUrl);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copia este enlace:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const renderRedeemButtons = (client: Client, size: "sm" | "md" = "sm") => {
    const tiers = getUnlockedTiers(client, settings);
    if (tiers.length === 0) return null;
    return (
      <>
        {tiers.map(t => (
          <button
            key={t.visits}
            onClick={e => {
              e.stopPropagation();
              onRedeemReward(client, t);
            }}
            title={`Canjear: ${t.title}`}
            className={`${
              size === 'md' ? 'px-3 py-2 text-xs' : 'px-2.5 py-1.5 text-[11px]'
            } font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors flex items-center gap-1`}
          >
            <Gift className="w-3.5 h-3.5" /> {tierShortLabel(t)}
          </button>
        ))}
      </>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#14171d] p-4 sm:p-5 rounded-2xl border border-[#222631]">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide font-display">Clientes</h2>
          <p className="text-xs text-slate-400 mt-1">
            {filteredClients.length} de {clients.length} · historial, notas y premios de fidelidad.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded-lg shadow-md shadow-amber-950/40"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo cliente</span>
        </button>
      </div>

      {/* Búsqueda y filtros */}
      <div className="bg-[#14171d] p-3 sm:p-4 rounded-xl border border-[#222631] space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            placeholder="Nombre, teléfono o código (BC-1001)…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500/60 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              aria-label="Borrar búsqueda"
              className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {(
            [
              ['active', 'Activos'],
              ['inactive', 'Inactivos'],
              ['all', 'Todos'],
              ['archived', 'Archivados']
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setStatusFilter(id)} className={chip(statusFilter === id)}>
              {label}
            </button>
          ))}
          <button onClick={() => setOnlyRewards(v => !v)} className={chip(onlyRewards)}>
            🎁 Con premio
          </button>
        </div>

        <div className="space-y-2 pt-2 border-t border-[#1d212b]">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            <span className="text-[11px] text-slate-500 font-medium shrink-0 mr-1">Ausencia:</span>
            {[
              { id: 'all', label: 'Todos' },
              { id: 'recent', label: '<7d' },
              { id: 'days7', label: '7 días' },
              { id: 'days14', label: '14 días' },
              { id: 'days21', label: '21 días' },
              { id: 'days30plus', label: '+30 días' },
              { id: 'no_visits', label: 'Sin visitas' }
            ].map(f => (
              <button key={f.id} onClick={() => setInactivityFilter(f.id)} className={chip(inactivityFilter === f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            <span className="text-[11px] text-slate-500 font-medium shrink-0 mr-1">Frecuencia:</span>
            {[
              { id: 'all', label: 'Todos' },
              { id: 'frequent', label: 'Frecuentes (≥4)' },
              { id: 'new', label: 'Nuevos (≤1)' }
            ].map(fr => (
              <button key={fr.id} onClick={() => setFrequencyFilter(fr.id)} className={chip(frequencyFilter === fr.id)}>
                {fr.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-[#14171d] rounded-2xl border border-[#222631] overflow-hidden">
        {filteredClients.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-300">No se encontraron clientes</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Cambia los filtros o agrega un nuevo cliente.
            </p>
          </div>
        ) : (
          <>
            {/* Tabla (escritorio) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#101217] text-slate-400 border-b border-[#222631] font-mono text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-4">Teléfono</th>
                    <th className="py-3 px-4">Última visita</th>
                    <th className="py-3 px-4 w-56">Fidelización</th>
                    <th className="py-3 px-4">Gasto</th>
                    <th className="py-3 px-4">Estado</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e222c]">
                  {filteredClients.map(client => {
                    const days = getDaysSinceDate(client.lastVisitAt);
                    const ready = getUnlockedTiers(client, settings).length > 0;
                    const st = STATUS_BADGE[client.status] || STATUS_BADGE.active;
                    return (
                      <tr
                        key={client.id}
                        className="hover:bg-[#181b24] transition-colors cursor-pointer"
                        onClick={() => setDetailId(client.id)}
                      >
                        <td className="py-3.5 px-4">
                          <p className="font-semibold text-slate-100 text-sm">{client.name}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            <span className="font-mono text-amber-500/90">{client.loyaltyCode}</span> · Alta{' '}
                            {formatDate(client.createdAt)}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">{client.phone}</td>
                        <td className="py-3.5 px-4">
                          <p className="text-slate-200">{formatDaysAbsent(days)}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(client.lastVisitAt)}</p>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`font-semibold ${ready ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {client.cycleVisits || 0} / {settings.loyaltyTargetVisits}
                            </span>
                            <span className="text-[10px] text-slate-500">{client.totalVisits || 0} históricas</span>
                          </div>
                          <TierProgress client={client} settings={settings} />
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-200">
                          {formatCurrency(client.totalSpent || 0, settings.currency)}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="py-3.5 px-4 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            {renderRedeemButtons(client)}
                            <button
                              onClick={() => onOpenCardStudio(client)}
                              className="p-2 text-slate-300 hover:text-amber-400 hover:bg-[#202532] rounded"
                              title="Tarjeta digital"
                              aria-label="Tarjeta digital"
                            >
                              <CreditCard className="w-4 h-4" />
                            </button>
                            {onScheduleAppointment && (
                              <button
                                onClick={() => onScheduleAppointment(client)}
                                className="p-2 text-amber-400 hover:text-amber-300 hover:bg-amber-950/40 rounded"
                                title="Agendar cita"
                                aria-label="Agendar cita"
                              >
                                <Calendar className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => onOpenWhatsApp(client)}
                              className="p-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 rounded"
                              title="Seguimiento / WhatsApp"
                              aria-label="Seguimiento"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openEdit(client)}
                              className="p-2 text-slate-400 hover:text-white hover:bg-[#202532] rounded"
                              title="Editar"
                              aria-label="Editar"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Tarjetas (móvil) */}
            <div className="md:hidden divide-y divide-[#1e222c]">
              {filteredClients.map(client => {
                const days = getDaysSinceDate(client.lastVisitAt);
                const ready = getUnlockedTiers(client, settings).length > 0;
                const st = STATUS_BADGE[client.status] || STATUS_BADGE.active;
                return (
                  <div
                    key={client.id}
                    onClick={() => setDetailId(client.id)}
                    className="p-4 active:bg-[#1c202a] transition-colors space-y-3 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-white text-sm truncate">{client.name}</h4>
                          <span className="font-mono text-[11px] text-amber-400 font-semibold px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/40 shrink-0">
                            {client.loyaltyCode}
                          </span>
                        </div>
                        <a
                          href={`tel:${client.phone}`}
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 mt-1 py-1 font-mono text-[12px] text-slate-300"
                        >
                          <Phone className="w-3 h-3 text-slate-500" />
                          {client.phone}
                        </a>
                      </div>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded shrink-0 ${st.cls}`}>{st.label}</span>
                    </div>

                    <div className="p-3 bg-[#0e1014] rounded-xl border border-[#222632]">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-400 text-[11px]">Sellos del ciclo</span>
                        <span className={`font-mono font-bold ${ready ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {client.cycleVisits || 0} / {settings.loyaltyTargetVisits}
                        </span>
                      </div>
                      <TierProgress client={client} settings={settings} />
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>Última: {formatDaysAbsent(days)}</span>
                        <span>Total: {formatCurrency(client.totalSpent || 0, settings.currency)}</span>
                      </div>
                    </div>

                    {ready && (
                      <div
                        onClick={e => e.stopPropagation()}
                        className="p-2.5 bg-emerald-950/70 border border-emerald-700/60 rounded-lg flex items-center justify-between gap-2"
                      >
                        <span className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5">
                          <Gift className="w-4 h-4 text-emerald-400" /> Premio disponible
                        </span>
                        <div className="flex items-center gap-1.5">
                          {renderRedeemButtons(client, "md")}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setDetailId(client.id)}
                        className="text-[12px] text-slate-400 flex items-center gap-1.5 py-1"
                      >
                        <Eye className="w-4 h-4" />
                        <span>Ficha</span>
                      </button>
                      <div className="flex items-center gap-1.5">
                        {onScheduleAppointment && (
                          <button
                            onClick={() => onScheduleAppointment(client)}
                            className="px-3 py-2 bg-[#171a22] text-amber-300 border border-amber-600/30 rounded-lg text-[12px] font-medium flex items-center gap-1.5"
                          >
                            <Calendar className="w-4 h-4 text-amber-400" />
                            <span>Cita</span>
                          </button>
                        )}
                        <button
                          onClick={() => onOpenCardStudio(client)}
                          aria-label="Tarjeta digital"
                          className="p-2 bg-[#171a22] text-slate-300 border border-[#262b38] rounded-lg"
                        >
                          <CreditCard className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onOpenWhatsApp(client)}
                          aria-label="Seguimiento"
                          className="p-2 bg-[#171a22] text-emerald-400 border border-emerald-900/40 rounded-lg"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEdit(client)}
                          aria-label="Editar"
                          className="p-2 bg-[#171a22] text-slate-400 border border-[#262b38] rounded-lg"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Ficha */}
      {detail && (
        <Modal
          isOpen
          onClose={() => setDetailId(null)}
          title={detail.name}
          subtitle={`Código ${detail.loyaltyCode} · Alta ${formatDate(detail.createdAt)}`}
          maxWidth="2xl"
        >
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-[#111317] rounded-xl border border-[#222631]">
                <p className="text-slate-400 uppercase text-[10px]">Ciclo</p>
                <p className="text-lg font-bold text-amber-400 mt-1">
                  {detail.cycleVisits || 0} / {settings.loyaltyTargetVisits}
                </p>
              </div>
              <div className="p-3 bg-[#111317] rounded-xl border border-[#222631]">
                <p className="text-slate-400 uppercase text-[10px]">Visitas totales</p>
                <p className="text-lg font-bold text-white mt-1">{detail.totalVisits || 0}</p>
              </div>
              <div className="p-3 bg-[#111317] rounded-xl border border-[#222631]">
                <p className="text-slate-400 uppercase text-[10px]">Gasto</p>
                <p className="text-lg font-bold text-white mt-1">
                  {formatCurrency(detail.totalSpent || 0, settings.currency)}
                </p>
              </div>
              <div className="p-3 bg-[#111317] rounded-xl border border-[#222631]">
                <p className="text-slate-400 uppercase text-[10px]">Última visita</p>
                <p className="text-lg font-bold text-white mt-1">
                  {getDaysSinceDate(detail.lastVisitAt) !== null ? `${getDaysSinceDate(detail.lastVisitAt)}d` : '—'}
                </p>
                <p className="text-[10px] text-slate-500">{formatDate(detail.lastVisitAt)}</p>
              </div>
            </div>

            <div className="p-4 bg-[#111317] rounded-xl border border-[#222631]">
              <p className="font-semibold text-slate-300 text-[11px] uppercase tracking-wider mb-2">Premios</p>
              <TierProgress client={detail} settings={settings} />
              {getUnlockedTiers(detail, settings).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {renderRedeemButtons(detail, "md")}
                </div>
              )}
            </div>

            <div className="p-4 bg-[#111317] rounded-xl border border-[#222631] space-y-3">
              <div>
                <p className="font-semibold text-amber-400 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5" /> Preferencias de corte
                </p>
                <p className="mt-1 text-slate-200 text-sm leading-relaxed">
                  {detail.cutPreferences || 'Sin especificaciones todavía.'}
                </p>
              </div>
              <div className="pt-3 border-t border-[#1d212b]">
                <p className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Notas internas
                </p>
                <p className="mt-1 text-slate-300">{detail.notes || 'Ninguna.'}</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-slate-200 text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-amber-400" /> Historial
              </h4>
              {(() => {
                const list = visits
                  .filter(v => v.clientId === detail.id)
                  .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
                if (list.length === 0) {
                  return (
                    <p className="p-3 bg-[#111317] rounded-lg text-slate-500 border border-[#222631]">
                      Aún no hay visitas para este cliente.
                    </p>
                  );
                }
                return (
                  <div className="max-h-48 overflow-y-auto divide-y divide-[#20242e] bg-[#111317] rounded-xl border border-[#222631]">
                    {list.map(v => (
                      <div key={v.id} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-200 truncate">{v.service}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {formatDate(v.date)} · {v.time}
                            {v.notes ? ` · ${v.notes}` : ''}
                          </p>
                        </div>
                        <p className="font-bold text-amber-400 shrink-0">{formatCurrency(v.amount, settings.currency)}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 pt-3 border-t border-[#222631]">
              {onScheduleAppointment && (
                <button
                  onClick={() => {
                    const c = detail;
                    setDetailId(null);
                    onScheduleAppointment(c);
                  }}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold rounded-lg"
                >
                  <Calendar className="w-4 h-4" /> Agendar
                </button>
              )}
              <button
                onClick={() => {
                  const c = detail;
                  setDetailId(null);
                  onOpenCardStudio(c);
                }}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-[#1f232d] text-slate-200 rounded-lg border border-[#2c3240]"
              >
                <CreditCard className="w-4 h-4 text-amber-400" /> Tarjeta
              </button>
              <button
                onClick={() => copyLink(detail)}
                className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border ${
                  copied
                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-semibold'
                    : 'bg-[#171a22] text-amber-300 border-amber-500/30'
                }`}
              >
                {copied ? (
                  <>
                    <CheckCircle className="w-4 h-4" /> Copiado
                  </>
                ) : (
                  'Copiar enlace'
                )}
              </button>
              <button
                onClick={() => {
                  const c = detail;
                  setDetailId(null);
                  onOpenWhatsApp(c);
                }}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-950/60 text-emerald-300 rounded-lg border border-emerald-800/40"
              >
                <MessageCircle className="w-4 h-4" /> Seguimiento
              </button>
              <button
                onClick={() => {
                  const c = detail;
                  setDetailId(null);
                  openEdit(c);
                }}
                className="px-3 py-2.5 bg-[#1f232d] text-slate-300 rounded-lg"
              >
                Editar
              </button>
              <button onClick={() => setArchiveTarget(detail)} className="px-3 py-2.5 text-red-400 hover:bg-red-950/40 rounded-lg">
                Archivar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Crear / editar */}
      {isClientModalOpen && (
        <Modal
          isOpen
          onClose={() => setIsClientModalOpen(false)}
          title={editingClient ? 'Editar cliente' : 'Nuevo cliente'}
          subtitle="Datos para el directorio y la tarjeta de fidelidad"
          maxWidth="lg"
        >
          <form onSubmit={handleSubmitClient} className="space-y-4 text-xs">
            {formError && (
              <div className="p-3 bg-red-950/50 border border-red-800/60 rounded-xl text-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-medium mb-1">Nombre completo *</label>
              <input
                type="text"
                required
                autoComplete="off"
                placeholder="Ej. Roberto Sánchez"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Teléfono con prefijo *</label>
                <input
                  type="tel"
                  inputMode="tel"
                  required
                  placeholder="+584121234567"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className={`${inputCls} font-mono`}
                />
                <p className="text-[10px] text-slate-500 mt-1">Ej: +58 Venezuela, +34 España, +52 México.</p>
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Cumpleaños (opcional)</label>
                <input
                  type="date"
                  value={formData.birthday}
                  onChange={e => setFormData({ ...formData, birthday: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Preferencias de corte y barba</label>
              <textarea
                rows={2}
                placeholder="Ej. Fade medio, tijera arriba, barba con navaja."
                value={formData.cutPreferences}
                onChange={e => setFormData({ ...formData, cutPreferences: e.target.value })}
                className={`${inputCls} resize-none`}
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Notas internas</label>
              <textarea
                rows={2}
                placeholder="Puntualidad, bebida favorita, alergias…"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className={`${inputCls} resize-none`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Código de tarjeta</label>
                <input
                  type="text"
                  autoCapitalize="characters"
                  value={formData.loyaltyCode}
                  onChange={e => setFormData({ ...formData, loyaltyCode: e.target.value })}
                  className={`${inputCls} text-amber-400 font-mono`}
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Estado</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value as any })}
                  className={inputCls}
                >
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                  <option value="archived">Archivado</option>
                </select>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer text-slate-300 py-1">
              <input
                type="checkbox"
                checked={formData.marketingConsent}
                onChange={e => setFormData({ ...formData, marketingConsent: e.target.checked })}
                className="mt-0.5 rounded border-slate-700 accent-amber-500 shrink-0"
              />
              <span>El cliente acepta recibir avisos de fidelidad y recordatorios por WhatsApp.</span>
            </label>

            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button type="button" onClick={() => setIsClientModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg disabled:opacity-50"
              >
                {isSubmitting ? 'Guardando…' : editingClient ? 'Guardar cambios' : 'Registrar cliente'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Archivar */}
      {archiveTarget && (
        <Modal isOpen onClose={() => setArchiveTarget(null)} title="Archivar cliente" maxWidth="sm">
          <div className="space-y-4 text-xs">
            <p className="text-slate-300">
              ¿Archivar a <strong className="text-white">{archiveTarget.name}</strong>?
            </p>
            <p className="text-slate-500">
              No se borra su historial; lo verás en el filtro “Archivados”. Su tarjeta pública dejará de funcionar.
            </p>
            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button onClick={() => setArchiveTarget(null)} className="px-3 py-2 text-slate-400 hover:text-white">
                Cancelar
              </button>
              <button onClick={handleConfirmArchive} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg">
                Sí, archivar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
