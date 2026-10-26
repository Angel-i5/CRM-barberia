import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Scissors,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  MessageCircle,
  Edit2,
  Trash2,
  AlertTriangle,
  PlayCircle,
  Check,
  Gift
} from 'lucide-react';
import { Appointment, AppointmentStatus, BarberService, Client, CRMSettings, RewardTier } from '../types';
import {
  formatCurrency,
  formatDate,
  buildWhatsAppLink,
  compileTemplate,
  generateId,
  todayYMD,
  addDaysYMD,
  openExternalUrl
} from '../utils/formatters';
import { Modal } from '../components/Modal';
import { INITIAL_SERVICES } from '../services/storage';
import {
  appointmentsToBusy,
  countConcurrent,
  getAvailableSlots,
  getCapacity,
  isWorkingDate,
  timeToMinutes,
  WEEKDAY_LABELS
} from '../utils/scheduling';
import { applyTierToAmount, getUnlockedTiers, tierShortLabel } from '../utils/loyalty';
import { parseLocalDate } from '../utils/formatters';

interface AppointmentsPageProps {
  appointments: Appointment[];
  clients: Client[];
  settings: CRMSettings;
  services?: BarberService[];
  onSaveAppointment: (appointment: Appointment) => Promise<Appointment>;
  onUpdateStatus: (appointmentId: string, status: AppointmentStatus) => Promise<boolean>;
  onDeleteAppointment: (appointmentId: string) => Promise<boolean>;
  onCompleteAndRegisterVisit: (appointment: Appointment, redeemTier?: RewardTier) => Promise<void>;
  /** Cada cambio de `nonce` abre el formulario de nueva cita (con cliente opcional). */
  request?: { clientId?: string; nonce: number } | null;
}

const inputCls =
  'w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white text-sm focus:outline-none';

const chip = (active: boolean) =>
  `shrink-0 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
    active
      ? 'bg-amber-600/25 text-amber-300 border border-amber-600/40'
      : 'text-slate-400 hover:text-white bg-[#171a21] border border-transparent'
  }`;

const STATUS_BADGE: Record<AppointmentStatus, { label: string; cls: string; icon: React.ElementType }> = {
  confirmada: { label: 'Confirmada', cls: 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40', icon: CheckCircle2 },
  pendiente: { label: 'Pendiente', cls: 'bg-amber-950/60 text-amber-300 border border-amber-800/40', icon: Clock },
  en_curso: { label: 'En sillón', cls: 'bg-blue-950/60 text-blue-300 border border-blue-800/40', icon: PlayCircle },
  completada: { label: 'Completada', cls: 'bg-slate-800/60 text-slate-300 border border-slate-700/40', icon: Check },
  cancelada: { label: 'Cancelada', cls: 'bg-red-950/40 text-red-400 border border-red-800/40', icon: XCircle }
};

const UNASSIGNED = 'Por asignar';

export const AppointmentsPage: React.FC<AppointmentsPageProps> = ({
  appointments,
  clients,
  settings,
  services = [],
  onSaveAppointment,
  onUpdateStatus,
  onDeleteAppointment,
  onCompleteAndRegisterVisit,
  request
}) => {
  const [dateFilter, setDateFilter] = useState<'today' | 'tomorrow' | 'week' | 'all'>('today');
  const [statusFilter, setStatusFilter] = useState<'all' | AppointmentStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const catalog = useMemo(() => {
    const active = services.filter(s => s.isActive);
    return active.length > 0 ? active : INITIAL_SERVICES.filter(s => s.isActive);
  }, [services]);

  const activeClients = useMemo(
    () => clients.filter(c => c.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name)),
    [clients]
  );

  const barbers = useMemo(() => {
    const list = (settings.barbers || []).map(b => b.trim()).filter(Boolean);
    return [UNASSIGNED, ...list];
  }, [settings.barbers]);

  // Modal de cita
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [completeTarget, setCompleteTarget] = useState<{ apt: Appointment; tiers: RewardTier[] } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState({
    clientId: '',
    date: todayYMD(),
    time: '',
    service: '',
    durationMinutes: 30,
    amount: 0,
    status: 'confirmada' as AppointmentStatus,
    barberName: UNASSIGNED,
    notes: ''
  });

  const openCreate = (clientId?: string) => {
    const first = catalog[0];
    setEditing(null);
    setForm({
      clientId: clientId || '',
      date: todayYMD(),
      time: '',
      service: first ? first.name : '',
      durationMinutes: first ? first.durationMinutes : 30,
      amount: first ? first.price : 0,
      status: 'confirmada',
      barberName: UNASSIGNED,
      notes: ''
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  // Abrir desde fuera ("Agendar" en un cliente, botón +, etc.)
  useEffect(() => {
    if (request) openCreate(request.clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  const openEdit = (apt: Appointment) => {
    setEditing(apt);
    setForm({
      clientId: apt.clientId,
      date: apt.date,
      time: apt.time,
      service: apt.service,
      durationMinutes: apt.durationMinutes || 30,
      amount: apt.amount,
      status: apt.status,
      barberName: apt.barberName || UNASSIGNED,
      notes: apt.notes || ''
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  // Disponibilidad del día elegido (excluye la propia cita al editar)
  const busy = useMemo(() => appointmentsToBusy(appointments, editing?.id), [appointments, editing?.id]);
  const capacity = getCapacity(settings);
  const slots = useMemo(
    () =>
      getAvailableSlots({
        date: form.date,
        durationMinutes: form.durationMinutes,
        settings,
        busy,
        capacity,
        allowPast: !!editing
      }),
    [form.date, form.durationMinutes, settings, busy, capacity, editing]
  );
  const dayIsWorking = isWorkingDate(form.date, settings);
  const conflict =
    !!form.time &&
    form.status !== 'cancelada' &&
    countConcurrent(form.date, timeToMinutes(form.time), form.durationMinutes, busy) >= capacity;
  const outsideHours =
    !!form.time &&
    (timeToMinutes(form.time) < timeToMinutes(settings.openTime) ||
      timeToMinutes(form.time) + form.durationMinutes > timeToMinutes(settings.closeTime));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const client = clients.find(c => c.id === form.clientId);
    if (!client) return setFormError('Selecciona un cliente.');
    if (!form.service.trim()) return setFormError('Indica el servicio.');
    if (!form.date) return setFormError('Indica la fecha.');
    if (!form.time) return setFormError('Elige una hora.');

    setIsSubmitting(true);
    const apt: Appointment = {
      id: editing ? editing.id : generateId('APT'),
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      date: form.date,
      time: form.time,
      service: form.service.trim(),
      durationMinutes: Number(form.durationMinutes) || 30,
      amount: Number(form.amount) || 0,
      status: form.status,
      barberName: form.barberName,
      notes: form.notes.trim() || undefined,
      createdAt: editing ? editing.createdAt : new Date().toISOString()
    };
    try {
      await onSaveAppointment(apt);
      setIsModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Lista filtrada
  const filtered = useMemo(() => {
    const today = todayYMD();
    const tomorrow = addDaysYMD(today, 1);
    const weekEnd = addDaysYMD(today, 7);
    const q = searchQuery.toLowerCase().trim();

    return appointments
      .filter(apt => {
        if (q && !(apt.clientName.toLowerCase().includes(q) || apt.clientPhone.includes(q) || apt.service.toLowerCase().includes(q))) {
          return false;
        }
        if (statusFilter !== 'all' && apt.status !== statusFilter) return false;
        if (dateFilter === 'today') return apt.date === today;
        if (dateFilter === 'tomorrow') return apt.date === tomorrow;
        if (dateFilter === 'week') return apt.date >= today && apt.date <= weekEnd;
        return true;
      })
      .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)));
  }, [appointments, dateFilter, statusFilter, searchQuery]);

  const pendingBadge = appointments.filter(a => a.status === 'pendiente' && a.date >= todayYMD()).length;

  const sendWhatsApp = (apt: Appointment, kind: 'confirm' | 'reminder') => {
    const tpl = kind === 'confirm' ? settings.appointmentConfirmationTemplate : settings.appointmentReminderTemplate;
    const text = compileTemplate(tpl, {
      nombre: apt.clientName,
      barberia: settings.barbershopName,
      servicio: apt.service,
      fecha: formatDate(apt.date),
      hora: apt.time,
      barbero: apt.barberName && apt.barberName !== UNASSIGNED ? apt.barberName : 'nuestro equipo'
    });
    openExternalUrl(buildWhatsAppLink(apt.clientPhone, text));
  };

  const startComplete = (apt: Appointment) => {
    const client = clients.find(c => c.id === apt.clientId);
    const tiers = client ? getUnlockedTiers(client, settings) : [];
    if (tiers.length === 0) {
      void onCompleteAndRegisterVisit(apt);
    } else {
      setCompleteTarget({ apt, tiers });
    }
  };

  const confirmComplete = async (tier?: RewardTier) => {
    if (!completeTarget) return;
    const { apt } = completeTarget;
    setCompleteTarget(null);
    await onCompleteAndRegisterVisit(
      tier ? { ...apt, amount: applyTierToAmount(apt.amount, tier), notes: `${apt.notes || ''} Premio aplicado: ${tier.title}.`.trim() } : apt,
      tier
    );
  };

  const slotDayLabel = (() => {
    const d = parseLocalDate(form.date);
    return d ? WEEKDAY_LABELS[d.getDay()] : '';
  })();

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#14171d] p-4 sm:p-5 rounded-2xl border border-[#222631]">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide font-display">Agenda de citas</h2>
          <p className="text-xs text-slate-400 mt-1">
            {pendingBadge > 0
              ? `${pendingBadge} cita${pendingBadge === 1 ? '' : 's'} por confirmar (incluye reservas online).`
              : 'Turnos, recordatorios por WhatsApp y sellos automáticos al completar.'}
          </p>
        </div>
        <button
          onClick={() => openCreate()}
          className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded-lg shadow-md shadow-amber-950/40"
        >
          <Plus className="w-4 h-4" />
          <span>Agendar cita</span>
        </button>
      </div>

      <div className="bg-[#14171d] p-3 sm:p-4 rounded-xl border border-[#222631] space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            placeholder="Cliente, teléfono o servicio…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {(
            [
              ['today', 'Hoy'],
              ['tomorrow', 'Mañana'],
              ['week', '7 días'],
              ['all', 'Todas']
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setDateFilter(id)} className={chip(dateFilter === id)}>
              {label}
            </button>
          ))}
          <span className="w-px h-5 bg-[#262b38] shrink-0 mx-1" />
          {(
            [
              ['all', 'Todas'],
              ['pendiente', 'Pendientes'],
              ['confirmada', 'Confirmadas'],
              ['en_curso', 'En sillón'],
              ['completada', 'Completadas'],
              ['cancelada', 'Canceladas']
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setStatusFilter(id)} className={chip(statusFilter === id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center bg-[#14171d] rounded-2xl border border-[#222631] px-4">
          <CalendarIcon className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-300">No hay citas en este periodo</p>
          <p className="text-xs text-slate-500 mt-1">Cambia el filtro o agenda una nueva cita.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filtered.map(apt => {
            const badge = STATUS_BADGE[apt.status];
            const BadgeIcon = badge.icon;
            const isFinal = apt.status === 'completada' || apt.status === 'cancelada';
            return (
              <div
                key={apt.id}
                className={`p-4 bg-[#14171d] rounded-xl border border-[#222631] flex flex-col space-y-3 ${
                  apt.status === 'cancelada' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="px-2.5 py-1 rounded-lg bg-[#0e1014] border border-[#252a36] text-amber-400 font-mono font-bold text-sm flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                      <span>{apt.time}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">{apt.durationMinutes} min</span>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-md flex items-center gap-1 shrink-0 ${badge.cls}`}>
                    <BadgeIcon className="w-3 h-3" /> {badge.label}
                  </span>
                </div>

                <p className="text-[11px] text-slate-500 font-mono -mt-1.5">{formatDate(apt.date)}</p>

                <div className="space-y-1.5 pt-2 border-t border-[#1e222c]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-white text-sm truncate">{apt.clientName}</p>
                    <span className="font-mono text-amber-400 font-bold text-xs shrink-0">
                      {formatCurrency(apt.amount, settings.currency)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
                    <span className="truncate">{apt.service}</span>
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <a href={`tel:${apt.clientPhone}`} className="py-1">
                      {apt.clientPhone}
                    </a>
                    <span className="text-slate-500">{apt.barberName || UNASSIGNED}</span>
                  </div>
                  {apt.notes && (
                    <p className="text-[11px] text-slate-400 italic bg-[#0f1116] p-2 rounded-md border border-[#1e222d]">
                      “{apt.notes}”
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-[#1e222c] space-y-2 mt-auto">
                  {apt.status === 'pendiente' && (
                    <button
                      onClick={() => onUpdateStatus(apt.id, 'confirmada')}
                      className="w-full py-2.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 border border-amber-600/50 rounded-lg text-xs font-semibold"
                    >
                      Confirmar cita
                    </button>
                  )}
                  {apt.status === 'confirmada' && (
                    <button
                      onClick={() => onUpdateStatus(apt.id, 'en_curso')}
                      className="w-full py-2.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 border border-blue-600/50 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <PlayCircle className="w-4 h-4" /> Pasar al sillón
                    </button>
                  )}
                  {!isFinal && (
                    <button
                      onClick={() => startComplete(apt)}
                      className="w-full py-2.5 bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-600/50 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                      title="Marca la cita como completada y suma el sello"
                    >
                      <Scissors className="w-4 h-4 text-emerald-400" />
                      <span>Completar y sellar</span>
                    </button>
                  )}

                  <div className="flex items-center justify-between gap-1 text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => sendWhatsApp(apt, 'confirm')}
                        aria-label="Confirmar por WhatsApp"
                        title="Confirmar por WhatsApp"
                        className="p-2 bg-[#181a22] text-emerald-400 rounded-md border border-[#282d3b]"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                      {!isFinal && (
                        <button
                          onClick={() => sendWhatsApp(apt, 'reminder')}
                          className="px-3 py-2 bg-[#181a22] text-slate-300 text-[11px] rounded-md border border-[#282d3b]"
                        >
                          Recordar
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!isFinal && (
                        <button
                          onClick={() => onUpdateStatus(apt.id, 'cancelada')}
                          className="px-3 py-2 text-[11px] text-red-300 rounded-md bg-red-950/30 border border-red-900/40"
                        >
                          Cancelar
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(apt)}
                        aria-label="Editar cita"
                        className="p-2 text-slate-400 hover:text-white rounded-md hover:bg-[#1f232e]"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTargetId(apt.id)}
                        aria-label="Eliminar cita"
                        className="p-2 text-red-400/80 hover:text-red-300 rounded-md hover:bg-red-950/40"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Crear / editar */}
      {isModalOpen && (
        <Modal
          isOpen
          onClose={() => setIsModalOpen(false)}
          title={editing ? 'Modificar cita' : 'Agendar cita'}
          subtitle="Los horarios libres tienen en cuenta las demás citas y los sillones disponibles"
          maxWidth="lg"
        >
          <form onSubmit={submit} className="space-y-4 text-xs">
            {formError && (
              <div className="p-3 bg-red-950/50 border border-red-800/60 rounded-xl text-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-medium mb-1">Cliente *</label>
              <select
                required
                value={form.clientId}
                onChange={e => setForm({ ...form, clientId: e.target.value })}
                className={inputCls}
              >
                <option value="">— Selecciona un cliente —</option>
                {activeClients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.cycleVisits}/{settings.loyaltyTargetVisits} sellos
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1.5">Servicio</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {catalog.slice(0, 9).map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setForm(prev => ({ ...prev, service: s.name, durationMinutes: s.durationMinutes, amount: s.price, time: '' }))
                    }
                    className={`p-2.5 rounded-lg text-left border transition-colors ${
                      form.service === s.name
                        ? 'bg-amber-600/20 border-amber-500/60 text-amber-200'
                        : 'bg-[#181a20] border-[#252934] text-slate-300'
                    }`}
                  >
                    <p className="font-semibold text-[11px] truncate">{s.name}</p>
                    <p className="text-[10px] text-amber-400 font-mono mt-0.5">
                      {s.durationMinutes}m · {formatCurrency(s.price, settings.currency)}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-slate-300 font-medium mb-1">Servicio *</label>
                <input
                  type="text"
                  required
                  value={form.service}
                  onChange={e => setForm({ ...form, service: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Importe ({settings.currency})</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                  className={`${inputCls} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Fecha *</label>
                <input
                  type="date"
                  required
                  min={editing ? undefined : todayYMD()}
                  value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value, time: '' })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Duración</label>
                <select
                  value={form.durationMinutes}
                  onChange={e => setForm({ ...form, durationMinutes: parseInt(e.target.value) || 30, time: '' })}
                  className={inputCls}
                >
                  {[15, 20, 30, 40, 45, 60, 75, 90, 120].map(m => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                  {![15, 20, 30, 40, 45, 60, 75, 90, 120].includes(form.durationMinutes) && (
                    <option value={form.durationMinutes}>{form.durationMinutes} min</option>
                  )}
                </select>
              </div>
            </div>

            {/* Horarios libres */}
            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                Hora * <span className="text-slate-500 font-normal">({slotDayLabel} · {capacity} sillón{capacity === 1 ? '' : 'es'})</span>
              </label>
              {!dayIsWorking ? (
                <p className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-200">
                  La barbería no abre ese día. Puedes elegir otra fecha o escribir la hora manualmente abajo.
                </p>
              ) : slots.length === 0 ? (
                <p className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-200">
                  No quedan horarios libres para esa fecha y duración.
                </p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-40 overflow-y-auto">
                  {slots.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, time: t })}
                      className={`py-2.5 rounded-lg border font-mono text-xs font-semibold transition-colors ${
                        form.time === t
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-[#181a20] text-slate-200 border-[#252934]'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-slate-500 text-[11px] shrink-0">O escribe la hora:</span>
                <input
                  type="time"
                  value={form.time}
                  onChange={e => setForm({ ...form, time: e.target.value })}
                  className={`${inputCls} max-w-[9rem]`}
                />
              </div>
              {conflict && (
                <p className="mt-2 p-2.5 rounded-lg bg-red-950/40 border border-red-800/50 text-red-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Esa hora ya está completa. Si guardas, quedará una cita encimada con otra.</span>
                </p>
              )}
              {!conflict && outsideHours && (
                <p className="mt-2 p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Fuera del horario ({settings.openTime}–{settings.closeTime}). Se puede guardar igualmente.
                  </span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Barbero</label>
                <select
                  value={form.barberName}
                  onChange={e => setForm({ ...form, barberName: e.target.value })}
                  className={inputCls}
                >
                  {barbers.map(b => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                  {!barbers.includes(form.barberName) && <option value={form.barberName}>{form.barberName}</option>}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Estado</label>
                <select
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value as AppointmentStatus })}
                  className={inputCls}
                >
                  <option value="confirmada">Confirmada</option>
                  <option value="pendiente">Pendiente de confirmar</option>
                  <option value="en_curso">En sillón</option>
                  <option value="completada">Completada</option>
                  <option value="cancelada">Cancelada</option>
                </select>
                {form.status === 'completada' && !editing && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Para sumar el sello usa el botón “Completar y sellar” de la cita.
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Notas (opcional)</label>
              <textarea
                rows={2}
                placeholder="Ej. Llega con su hijo, repaso de barba con navaja…"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className={`${inputCls} resize-none`}
              />
            </div>

            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg disabled:opacity-50"
              >
                {isSubmitting ? 'Guardando…' : editing ? 'Actualizar cita' : 'Guardar cita'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Completar con premio */}
      {completeTarget && (
        <Modal isOpen onClose={() => setCompleteTarget(null)} title="Completar cita" maxWidth="sm">
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-700/40 space-y-1">
              <p className="flex items-center gap-1.5 font-semibold text-emerald-300">
                <Gift className="w-4 h-4" /> {completeTarget.apt.clientName} tiene un premio disponible
              </p>
              <p className="text-slate-300">
                {completeTarget.apt.service} · {formatCurrency(completeTarget.apt.amount, settings.currency)}
              </p>
            </div>
            <div className="space-y-2">
              {completeTarget.tiers.map(t => (
                <button
                  key={t.visits}
                  onClick={() => confirmComplete(t)}
                  className="w-full p-3 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/50 text-left"
                >
                  <p className="font-bold text-emerald-200">
                    Aplicar {tierShortLabel(t)} · {t.title}
                  </p>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Cobrar {formatCurrency(applyTierToAmount(completeTarget.apt.amount, t), settings.currency)}
                  </p>
                </button>
              ))}
              <button
                onClick={() => confirmComplete()}
                className="w-full p-3 rounded-lg bg-[#181a20] border border-[#2a2f3a] text-slate-200 font-semibold"
              >
                Completar sin aplicar premio
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Eliminar */}
      {deleteTargetId && (
        <Modal isOpen onClose={() => setDeleteTargetId(null)} title="Eliminar cita" maxWidth="sm">
          <div className="space-y-4 text-xs">
            <p className="text-slate-300">¿Eliminar este turno de la agenda? Si solo se canceló, es mejor usar “Cancelar”.</p>
            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button onClick={() => setDeleteTargetId(null)} className="px-3 py-2 text-slate-400 hover:text-white">
                Volver
              </button>
              <button
                onClick={async () => {
                  const id = deleteTargetId;
                  setDeleteTargetId(null);
                  if (id) await onDeleteAppointment(id);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg"
              >
                Eliminar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
