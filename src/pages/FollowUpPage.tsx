import React, { useState, useMemo, useEffect } from 'react';
import {
  MessageCircle,
  Calendar,
  UserCheck,
  Send,
  Check,
  Phone,
  AlertTriangle
} from 'lucide-react';
import { Client, FollowUpRecord, FollowUpResult, CRMSettings } from '../types';
import {
  getDaysSinceDate,
  formatDaysAbsent,
  formatDate,
  formatDateTime,
  buildWhatsAppLink,
  compileTemplate,
  getClientCardUrl,
  openExternalUrl
} from '../utils/formatters';
import { Modal } from '../components/Modal';

interface FollowUpPageProps {
  clients: Client[];
  followUps: FollowUpRecord[];
  settings: CRMSettings;
  onLogFollowUp: (record: Omit<FollowUpRecord, 'id'>) => Promise<FollowUpRecord>;
  onOpenCardStudio: (client: Client) => void;
  onScheduleAppointment?: (client: Client) => void;
  /** Si llega un cliente (desde Clientes o el Panel) se abre directamente su mensaje. */
  request?: { clientId: string; nonce: number } | null;
}

type FollowUpTab = 'recent' | 'days7' | 'days14' | 'days21' | 'days30plus' | 'no_visits' | 'pending' | 'history';

const RESULT_LABEL: Record<FollowUpResult, string> = {
  pendiente: 'Pendiente',
  contactado: 'Contactado',
  respondio: 'Respondió',
  reservo: 'Reservó cita',
  no_interesado: 'No interesado'
};

const RESULT_CLS: Record<FollowUpResult, string> = {
  reservo: 'bg-emerald-950 text-emerald-300 border border-emerald-800/60',
  respondio: 'bg-blue-950 text-blue-300 border border-blue-800/60',
  contactado: 'bg-amber-950 text-amber-300 border border-amber-800/60',
  no_interesado: 'bg-red-950 text-red-300 border border-red-800/60',
  pendiente: 'bg-slate-800 text-slate-400'
};

export const FollowUpPage: React.FC<FollowUpPageProps> = ({
  clients,
  followUps,
  settings,
  onLogFollowUp,
  onOpenCardStudio: _onOpenCardStudio,
  onScheduleAppointment,
  request
}) => {
  const [activeTab, setActiveTab] = useState<FollowUpTab>('pending');

  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [templateName, setTemplateName] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [result, setResult] = useState<FollowUpResult>('contactado');
  const [notes, setNotes] = useState<string>('');
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seguimientos ordenados del más reciente al más antiguo (no se asume el orden de la hoja)
  const sortedFollowUps = useMemo(() => [...followUps].sort((a, b) => b.date.localeCompare(a.date)), [followUps]);

  const lastFollowUpByClient = useMemo(() => {
    const map = new Map<string, FollowUpRecord>();
    sortedFollowUps.forEach(f => {
      if (!map.has(f.clientId)) map.set(f.clientId, f);
    });
    return map;
  }, [sortedFollowUps]);

  const grouped = useMemo(() => {
    const active = clients.filter(c => c.status !== 'archived');
    const g = {
      recent: [] as Client[],
      days7: [] as Client[],
      days14: [] as Client[],
      days21: [] as Client[],
      days30plus: [] as Client[],
      no_visits: [] as Client[],
      pending: [] as Client[]
    };

    active.forEach(c => {
      const days = getDaysSinceDate(c.lastVisitAt);
      if (days === null) g.no_visits.push(c);
      else if (days <= 6) g.recent.push(c);
      else if (days < 14) g.days7.push(c);
      else if (days < 21) g.days14.push(c);
      else if (days < 30) g.days21.push(c);
      else g.days30plus.push(c);

      // Pendiente = ausente (o nunca vino) y sin contacto en los últimos 14 días
      if (days === null || days >= 14) {
        const last = lastFollowUpByClient.get(c.id);
        const since = last ? getDaysSinceDate(last.date) : null;
        if (!last || since === null || since >= 14) g.pending.push(c);
      }
    });

    // Los más ausentes primero
    const byAbsence = (a: Client, b: Client) =>
      (getDaysSinceDate(b.lastVisitAt) ?? 9999) - (getDaysSinceDate(a.lastVisitAt) ?? 9999);
    (Object.keys(g) as (keyof typeof g)[]).forEach(k => g[k].sort(byAbsence));
    return g;
  }, [clients, lastFollowUpByClient]);

  const counts: Record<FollowUpTab, number> = {
    pending: grouped.pending.length,
    days7: grouped.days7.length,
    days14: grouped.days14.length,
    days21: grouped.days21.length,
    days30plus: grouped.days30plus.length,
    no_visits: grouped.no_visits.length,
    recent: grouped.recent.length,
    history: sortedFollowUps.length
  };

  const currentList = activeTab === 'history' ? [] : grouped[activeTab];

  const buildMessage = (client: Client, text: string) =>
    compileTemplate(text, {
      nombre: client.name,
      barberia: settings.barbershopName,
      visitas: client.cycleVisits || 0,
      recompensa: settings.rewardBenefit,
      dias_ausente: getDaysSinceDate(client.lastVisitAt) ?? 0,
      enlace_tarjeta: getClientCardUrl(client.loyaltyCode, settings.googleAppsScriptUrl)
    });

  const openContact = (client: Client) => {
    const days = getDaysSinceDate(client.lastVisitAt);
    let tpl = settings.reminderTemplate;
    let name = 'Recordatorio General';
    if (days === null) {
      tpl = settings.welcomeTemplate;
      name = 'Bienvenida';
    } else if (days >= 7 && days < 14) {
      tpl = settings.reactivation7dTemplate;
      name = 'Reactivación 7 días';
    } else if (days >= 14 && days < 21) {
      tpl = settings.reactivation14dTemplate;
      name = 'Reactivación 14 días';
    } else if (days >= 21 && days < 30) {
      tpl = settings.reactivation21dTemplate;
      name = 'Reactivación 21 días';
    } else if (days >= 30) {
      tpl = settings.reactivation30dTemplate;
      name = 'Reactivación +30 días';
    }
    setActiveClient(client);
    setTemplateName(name);
    setMessage(buildMessage(client, tpl));
    setResult('contactado');
    setNotes('');
    setOpened(false);
  };

  // Apertura desde otra pantalla
  useEffect(() => {
    if (!request) return;
    const c = clients.find(x => x.id === request.clientId);
    if (c) openContact(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  const launchWhatsApp = () => {
    if (!activeClient) return;
    openExternalUrl(buildWhatsAppLink(activeClient.phone, message));
    setOpened(true);
  };

  const saveLog = async (): Promise<boolean> => {
    if (!activeClient) return false;
    setSaving(true);
    try {
      await onLogFollowUp({
        clientId: activeClient.id,
        clientName: activeClient.name,
        clientPhone: activeClient.phone,
        date: new Date().toISOString(),
        templateUsed: templateName,
        result,
        notes: notes.trim() || undefined
      });
      return true;
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: FollowUpTab; label: string; color: string }[] = [
    { id: 'pending', label: 'Pendientes', color: 'text-amber-400' },
    { id: 'days7', label: '7 días', color: 'text-amber-300' },
    { id: 'days14', label: '14 días', color: 'text-amber-400' },
    { id: 'days21', label: '21 días', color: 'text-orange-400' },
    { id: 'days30plus', label: '+30 días', color: 'text-red-400' },
    { id: 'no_visits', label: 'Sin visitas', color: 'text-slate-400' },
    { id: 'recent', label: 'Recientes', color: 'text-emerald-400' },
    { id: 'history', label: 'Bitácora', color: 'text-slate-300' }
  ];

  const absenceCls = (days: number | null) =>
    days === null
      ? 'bg-slate-800 text-slate-400 border-slate-700/40'
      : days >= 21
      ? 'bg-red-950/60 text-red-300 border-red-800/40'
      : days >= 14
      ? 'bg-amber-950/60 text-amber-300 border-amber-800/40'
      : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/40';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-[#14171d] p-4 sm:p-5 rounded-2xl border border-[#222631]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide font-display">Seguimiento de clientes</h2>
            <p className="text-xs text-slate-400 mt-1">
              Escríbeles por WhatsApp con mensajes listos para reactivar a quienes dejaron de venir.
            </p>
          </div>
          <div className="px-3 py-2 bg-[#0e1014] border border-[#222632] rounded-lg text-xs text-slate-400 self-start">
            <span className="text-amber-400 font-bold">{counts.pending}</span> por contactar
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mt-4 border-t border-[#1e222c] pt-4 -mx-1 px-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-600/40'
                  : 'text-slate-400 hover:text-white bg-[#101217] border border-transparent'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] font-mono px-1.5 rounded bg-[#181a22] ${tab.color}`}>{counts[tab.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'history' ? (
        <div className="bg-[#14171d] rounded-2xl border border-[#222631] overflow-hidden">
          <div className="p-4 border-b border-[#222631]">
            <h3 className="text-sm font-semibold text-white tracking-wide uppercase font-mono">Bitácora de contactos</h3>
            <p className="text-xs text-slate-400 mt-0.5">Cada mensaje registrado, del más reciente al más antiguo.</p>
          </div>

          {sortedFollowUps.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">Todavía no hay contactos registrados.</div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101217] text-slate-400 border-b border-[#222631] font-mono text-[11px] uppercase">
                      <th className="py-3 px-4">Fecha</th>
                      <th className="py-3 px-4">Cliente</th>
                      <th className="py-3 px-4">Plantilla</th>
                      <th className="py-3 px-4">Resultado</th>
                      <th className="py-3 px-4">Notas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e222c]">
                    {sortedFollowUps.map(r => (
                      <tr key={r.id} className="hover:bg-[#181b24]">
                        <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">{formatDateTime(r.date)}</td>
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-100">{r.clientName}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{r.clientPhone}</p>
                        </td>
                        <td className="py-3 px-4 text-amber-400/90 font-medium">{r.templateUsed}</td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${RESULT_CLS[r.result] || ''}`}>
                            {RESULT_LABEL[r.result] || r.result}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400 max-w-xs truncate">{r.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-[#1e222c]">
                {sortedFollowUps.map(r => (
                  <div key={r.id} className="p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-100 text-sm truncate">{r.clientName}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${RESULT_CLS[r.result] || ''}`}>
                        {RESULT_LABEL[r.result] || r.result}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono">{formatDateTime(r.date)}</p>
                    <p className="text-[11px] text-amber-400/90">{r.templateUsed}</p>
                    {r.notes && <p className="text-[11px] text-slate-400 italic">“{r.notes}”</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="bg-[#14171d] rounded-2xl border border-[#222631] overflow-hidden">
          {currentList.length === 0 ? (
            <div className="py-16 text-center px-4">
              <UserCheck className="w-10 h-10 text-emerald-500/60 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-300">¡Al día! Nadie en esta categoría</p>
              <p className="text-xs text-slate-500 mt-1">Buen trabajo con la fidelización de tus clientes.</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101217] text-slate-400 border-b border-[#222631] font-mono text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">Cliente</th>
                      <th className="py-3 px-4">Ausencia</th>
                      <th className="py-3 px-4">Preferencias</th>
                      <th className="py-3 px-4">Sellos</th>
                      <th className="py-3 px-4">Último contacto</th>
                      <th className="py-3 px-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e222c]">
                    {currentList.map(client => {
                      const days = getDaysSinceDate(client.lastVisitAt);
                      const last = lastFollowUpByClient.get(client.id);
                      return (
                        <tr key={client.id} className="hover:bg-[#181b24]">
                          <td className="py-3.5 px-4">
                            <p className="font-semibold text-slate-100 text-sm">
                              {client.name}
                              {!client.marketingConsent && (
                                <span title="No dio consentimiento para recibir mensajes" className="ml-2 text-[10px] text-amber-400">
                                  ⚠ sin consentimiento
                                </span>
                              )}
                            </p>
                            <p className="font-mono text-slate-400 text-[11px]">{client.phone}</p>
                          </td>
                          <td className="py-3.5 px-4">
                            <p className={`font-semibold ${days === null ? 'text-slate-400' : days >= 21 ? 'text-red-400' : days >= 14 ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {formatDaysAbsent(days)}
                            </p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(client.lastVisitAt)}</p>
                          </td>
                          <td className="py-3.5 px-4 max-w-xs truncate text-slate-300">
                            {client.cutPreferences || 'Sin especificaciones'}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-amber-400">
                            {client.cycleVisits || 0}/{settings.loyaltyTargetVisits}
                          </td>
                          <td className="py-3.5 px-4">
                            {last ? (
                              <div>
                                <p className="text-slate-300">{formatDate(last.date)}</p>
                                <p className="text-[10px] text-amber-400/90">{RESULT_LABEL[last.result] || last.result}</p>
                              </div>
                            ) : (
                              <span className="text-slate-500 text-[11px]">Nunca contactado</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {onScheduleAppointment && (
                                <button
                                  onClick={() => onScheduleAppointment(client)}
                                  aria-label="Agendar cita"
                                  className="p-2 bg-[#181a20] hover:bg-[#222630] text-amber-400 border border-[#292e3c] rounded-lg"
                                  title="Agendar cita"
                                >
                                  <Calendar className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => openContact(client)}
                                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-600/40 rounded-lg text-xs font-semibold"
                              >
                                <MessageCircle className="w-4 h-4" />
                                <span>Escribir</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-[#1e222c]">
                {currentList.map(client => {
                  const days = getDaysSinceDate(client.lastVisitAt);
                  const last = lastFollowUpByClient.get(client.id);
                  return (
                    <div key={client.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="font-bold text-white text-sm truncate">{client.name}</h4>
                          <a
                            href={`tel:${client.phone}`}
                            className="inline-flex items-center gap-1.5 py-1 text-[12px] text-slate-400 font-mono"
                          >
                            <Phone className="w-3 h-3 text-slate-500" />
                            <span>{client.phone}</span>
                          </a>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${absenceCls(days)}`}>
                          {formatDaysAbsent(days)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] p-2.5 bg-[#0e1014] rounded-lg border border-[#20242e]">
                        <div className="min-w-0">
                          <p className="text-slate-500 text-[10px]">Corte habitual</p>
                          <p className="text-slate-300 truncate font-medium mt-0.5">{client.cutPreferences || 'Estándar'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-[10px]">Sellos</p>
                          <p className="font-mono font-bold text-amber-400 mt-0.5">
                            {client.cycleVisits || 0}/{settings.loyaltyTargetVisits}
                          </p>
                        </div>
                      </div>

                      {!client.marketingConsent && (
                        <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" /> Sin consentimiento para mensajes
                        </p>
                      )}
                      {last && (
                        <p className="text-[11px] text-slate-400">
                          Último contacto: {formatDate(last.date)} ·{' '}
                          <span className="text-amber-400/90">{RESULT_LABEL[last.result] || last.result}</span>
                        </p>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        {onScheduleAppointment && (
                          <button
                            onClick={() => onScheduleAppointment(client)}
                            className="px-3 py-2.5 bg-[#181a20] text-amber-400 border border-[#292e3c] rounded-lg text-xs font-medium flex items-center gap-1.5"
                          >
                            <Calendar className="w-4 h-4" />
                            <span>Agendar</span>
                          </button>
                        )}
                        <button
                          onClick={() => openContact(client)}
                          className="flex-1 py-2.5 px-3 bg-emerald-600/20 text-emerald-300 border border-emerald-600/40 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>Escribir por WhatsApp</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {activeClient && (
        <Modal
          isOpen
          onClose={() => setActiveClient(null)}
          title={`Contactar a ${activeClient.name}`}
          subtitle={`${activeClient.phone} · ${formatDaysAbsent(getDaysSinceDate(activeClient.lastVisitAt))}`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-xs">
            {!activeClient.marketingConsent && (
              <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Este cliente no aceptó recibir mensajes de promoción. Úsalo solo para avisos que él pidió (citas, premios).</span>
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-medium mb-1.5">Plantilla</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'Entrega de Tarjeta', text: settings.cardDeliveryTemplate },
                  { id: 'Reactivación 7 días', text: settings.reactivation7dTemplate },
                  { id: 'Reactivación 14 días', text: settings.reactivation14dTemplate },
                  { id: 'Reactivación 21 días', text: settings.reactivation21dTemplate },
                  { id: 'Reactivación +30 días', text: settings.reactivation30dTemplate },
                  { id: 'Recordatorio General', text: settings.reminderTemplate },
                  { id: 'Bienvenida', text: settings.welcomeTemplate }
                ].map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTemplateName(t.id);
                      setMessage(buildMessage(activeClient, t.text));
                    }}
                    className={`px-3 py-2 rounded-md text-[11px] transition-colors ${
                      templateName === t.id
                        ? 'bg-amber-600/25 text-amber-300 border border-amber-600/40 font-semibold'
                        : 'bg-[#181a20] text-slate-400 border border-[#232631]'
                    }`}
                  >
                    {t.id}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Mensaje (puedes editarlo)</label>
              <textarea
                rows={6}
                value={message}
                onChange={e => setMessage(e.target.value)}
                className="w-full p-3 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white text-sm leading-relaxed focus:outline-none"
              />
            </div>

            <div className="p-4 bg-[#111317] rounded-xl border border-[#222631] space-y-3">
              <p className="font-semibold text-slate-200">Paso 1 · Abrir WhatsApp con el texto listo</p>
              <button
                onClick={launchWhatsApp}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg"
              >
                <Send className="w-4 h-4" />
                <span>Abrir WhatsApp</span>
              </button>
              {opened && (
                <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/40 rounded-lg text-emerald-300 text-[11px] flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Listo. Ahora registra cómo fue el contacto.</span>
                </div>
              )}
            </div>

            <div className="p-4 bg-[#111317] rounded-xl border border-[#222631] space-y-3">
              <p className="font-semibold text-slate-200">Paso 2 · Registrar el resultado</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(Object.keys(RESULT_LABEL) as FollowUpResult[]).map(id => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setResult(id)}
                    className={`py-2.5 px-2 rounded-lg border text-center transition-colors ${
                      result === id
                        ? 'bg-amber-600/25 border-amber-500 text-amber-200 font-bold'
                        : 'bg-[#181a20] border-[#252834] text-slate-400'
                    }`}
                  >
                    {RESULT_LABEL[id]}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Notas (opcional). Ej: viene el sábado a las 11"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#0e1014] border border-[#282d3b] rounded-lg text-white text-sm focus:outline-none"
              />
            </div>

            <div className="pt-3 border-t border-[#222631] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
              <button type="button" onClick={() => setActiveClient(null)} className="py-2 text-slate-400 hover:text-white">
                Cerrar sin registrar
              </button>
              <div className="flex flex-col sm:flex-row gap-2">
                {result === 'reservo' && onScheduleAppointment && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      const c = activeClient;
                      if (await saveLog()) {
                        setActiveClient(null);
                        onScheduleAppointment(c);
                      }
                    }}
                    className="px-4 py-2.5 font-semibold text-amber-200 bg-amber-950/80 border border-amber-600/50 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Calendar className="w-4 h-4 text-amber-400" />
                    <span>Guardar y agendar</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    if (await saveLog()) setActiveClient(null);
                  }}
                  className="px-5 py-2.5 font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : 'Guardar en bitácora'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
