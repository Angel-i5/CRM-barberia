import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Scissors,
  Gift,
  RefreshCw,
  MessageCircle,
  Download,
  Share2,
  Sparkles,
  Calendar,
  ChevronRight,
  ArrowLeft,
  Smartphone,
  Check,
  Clock,
  WifiOff
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { PublicCardData, Client, CRMSettings, PublicService } from '../types';
import { api } from '../services/api';
import { DEFAULT_SETTINGS } from '../services/storage';
import { renderLoyaltyCard, downloadCardAsPng } from '../utils/cardGenerator';
import {
  formatDate,
  formatDayShort,
  formatDaysAbsent,
  formatCurrency,
  getDaysSinceDate,
  openExternalUrl,
  todayYMD,
  addDaysYMD
} from '../utils/formatters';
import { getAvailableSlots, isWorkingDate } from '../utils/scheduling';
import { describeTier, tierShortLabel } from '../utils/loyalty';

interface PublicCardPageProps {
  loyaltyCode: string;
  /** URL del script de Apps Script (cuando el enlace trae `s=` y el sitio no lo tiene compilado). */
  scriptUrl?: string;
  onBackToCRM?: () => void;
}

const BOOKING_DAYS = 21;

export const PublicCardPage: React.FC<PublicCardPageProps> = ({ loyaltyCode, scriptUrl, onBackToCRM }) => {
  const [card, setCard] = useState<PublicCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ message: string; network: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Reserva
  const [bookingOpen, setBookingOpen] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookedInfo, setBookedInfo] = useState<{ date: string; time: string; service: string } | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setRefreshing(true);
      const res = await api.fetchPublicCard(loyaltyCode, scriptUrl);
      if (res.data) {
        setCard(res.data);
        setError(null);
      } else if (!quiet || !card) {
        setError({
          network: !!res.networkError,
          message: res.networkError
            ? 'No pudimos conectar con el servidor. Revisa tu internet e inténtalo de nuevo.'
            : res.error || 'No encontramos una tarjeta activa con este código. Consulta con tu barbero.'
        });
      }
      setLoading(false);
      setRefreshing(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loyaltyCode, scriptUrl]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Se actualiza sola al volver a la pestaña (por si hubo una visita nueva)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const claimedSet = useMemo(() => new Set(card?.claimedTiers || []), [card]);
  const unlocked = useMemo(
    () => (card ? card.rewardTiers.filter(t => card.cycleVisits >= t.visits && !claimedSet.has(t.visits)) : []),
    [card, claimedSet]
  );
  const nextTier = useMemo(
    () => (card ? card.rewardTiers.find(t => t.visits > card.cycleVisits && !claimedSet.has(t.visits)) || null : null),
    [card, claimedSet]
  );

  // Dibujo de la tarjeta en canvas
  const draw = useCallback(() => {
    if (!canvasRef.current || !card) return;
    const client: Client = {
      id: 'PUB',
      name: card.clientName,
      phone: card.barbershopPhone,
      createdAt: card.cardIssuedAt || todayYMD(),
      lastVisitAt: card.lastVisitAt,
      cutPreferences: '',
      notes: '',
      totalVisits: card.totalVisits,
      cycleVisits: card.cycleVisits,
      totalSpent: 0,
      status: 'active',
      marketingConsent: true,
      loyaltyCode: card.loyaltyCode,
      cardIssuedAt: card.cardIssuedAt,
      cardStyle: card.cardStyle,
      claimedTiers: (card.claimedTiers || []).join(',')
    };
    const settings: CRMSettings = {
      ...DEFAULT_SETTINGS,
      barbershopName: card.barbershopName,
      barbershopPhone: card.barbershopPhone,
      currency: card.currency,
      rewardTiers: card.rewardTiers,
      loyaltyTargetVisits: card.targetVisits,
      rewardBenefit: card.rewardBenefit,
      cardStyle: card.cardStyle,
      googleAppsScriptUrl: scriptUrl || api.getScriptUrl()
    };
    renderLoyaltyCard(canvasRef.current, { client, settings, style: card.cardStyle });
  }, [card, scriptUrl]);

  useEffect(() => {
    draw();
    const fonts = (document as any).fonts;
    if (fonts?.ready) fonts.ready.then(draw).catch(() => undefined);
  }, [draw]);

  const download = () => {
    if (!canvasRef.current || !card) return;
    draw();
    downloadCardAsPng(canvasRef.current, card.clientName);
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: card?.barbershopName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* el usuario canceló */
    }
  };

  // ---------------------------------------------------------------- reserva
  const services: PublicService[] = card?.services || [];
  const service = services.find(s => s.id === serviceId) || null;

  const bookingSettings = useMemo(
    () =>
      card
        ? {
            openTime: card.openTime,
            closeTime: card.closeTime,
            slotMinutes: card.slotMinutes,
            workingDays: card.workingDays,
            barbers: [] as string[]
          }
        : null,
    [card]
  );

  const days = useMemo(() => {
    if (!card || !bookingSettings) return [];
    const start = todayYMD();
    return Array.from({ length: BOOKING_DAYS }, (_, i) => addDaysYMD(start, i)).map(d => ({
      date: d,
      open: isWorkingDate(d, bookingSettings)
    }));
  }, [card, bookingSettings]);

  const slots = useMemo(() => {
    if (!card || !bookingSettings || !service || !date) return [];
    return getAvailableSlots({
      date,
      durationMinutes: service.durationMinutes,
      settings: bookingSettings,
      busy: card.busy,
      capacity: card.capacity
    });
  }, [card, bookingSettings, service, date]);

  const openBooking = () => {
    setBookedInfo(null);
    setBookingError(null);
    setTime('');
    setNotes('');
    setServiceId(services[0]?.id || '');
    const firstOpen = days.find(d => d.open);
    setDate(firstOpen ? firstOpen.date : '');
    setBookingOpen(true);
  };

  const submitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card || !service || !date || !time) {
      setBookingError('Elige servicio, día y hora.');
      return;
    }
    setBooking(true);
    setBookingError(null);
    const res = await api.bookPublicAppointment(
      { code: card.loyaltyCode, date, time, serviceId: service.id, notes: notes.trim() },
      scriptUrl
    );
    setBooking(false);
    if (res.success && res.appointment) {
      setBookedInfo({ date: res.appointment.date, time: res.appointment.time, service: res.appointment.service });
      load(true);
    } else {
      setBookingError(res.error || 'No se pudo reservar. Inténtalo de nuevo.');
      if (res.slotTaken) {
        setTime('');
        load(true);
      }
    }
  };

  const whatsappToShop = (text: string) => {
    if (!card?.barbershopPhone) return;
    const phone = card.barbershopPhone.replace(/\D/g, '');
    openExternalUrl(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
  };

  // ---------------------------------------------------------------- estados
  if (loading) {
    return (
      <div className="min-h-dvh bg-[#090a0d] text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-300">Cargando tu tarjeta…</p>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="min-h-dvh bg-[#090a0d] text-slate-100 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4">
          {error?.network ? <WifiOff className="w-8 h-8" /> : <Scissors className="w-8 h-8" />}
        </div>
        <h2 className="text-xl font-bold font-display text-white">
          {error?.network ? 'Sin conexión' : 'Tarjeta no disponible'}
        </h2>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          {error?.message || 'El código no corresponde a ninguna tarjeta activa.'}
        </p>
        <div className="mt-6 flex flex-col gap-2 w-full">
          <button
            onClick={() => load()}
            className="w-full py-3 px-4 bg-[#181b22] border border-[#2b3140] rounded-xl text-sm font-semibold text-slate-200"
          >
            Reintentar
          </button>
          {onBackToCRM && (
            <button onClick={onBackToCRM} className="w-full py-3 px-4 text-sm text-slate-400">
              Volver al panel
            </button>
          )}
        </div>
      </div>
    );
  }

  const daysAbsent = getDaysSinceDate(card.lastVisitAt);
  const canBook = services.length > 0;
  const firstName = card.clientName.split(' ')[0];

  return (
    <div className="min-h-dvh bg-[#0a0b0e] text-slate-100 antialiased font-sans selection:bg-amber-600/30 flex flex-col items-center pb-[max(3rem,env(safe-area-inset-bottom))]">
      <header className="safe-top w-full max-w-xl border-b border-[#1c1f28] bg-[#0f1116]/90 backdrop-blur-md sticky top-0 z-20">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-600/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <Scissors className="w-4 h-4 -rotate-45" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-xs uppercase tracking-wider text-white font-display truncate">
                {card.barbershopName}
              </h1>
              <p className="text-[10px] text-amber-500 font-mono">CLUB DE FIDELIDAD</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              aria-label="Actualizar"
              className="p-2.5 bg-[#181a22] border border-[#262b38] rounded-lg text-slate-300 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 text-amber-400 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {onBackToCRM && (
              <button onClick={onBackToCRM} aria-label="Volver al panel" className="p-2.5 text-slate-400 rounded-lg">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="w-full max-w-xl px-4 pt-5 space-y-5">
        {/* Premio listo / progreso */}
        {unlocked.length > 0 ? (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/80 via-[#0d2218] to-[#12141a] border border-emerald-500/60 shadow-xl shadow-emerald-950/40 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                <Gift className="w-5 h-5" />
              </div>
              <p className="font-bold text-sm text-emerald-200">¡Felicidades, {firstName}! Tienes un premio</p>
            </div>
            {unlocked.map(t => (
              <div key={t.visits} className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-700/40 text-sm text-slate-100">
                <span className="text-emerald-400 font-bold">{tierShortLabel(t)} · </span>
                {t.title}
              </div>
            ))}
            <p className="text-xs text-emerald-300/80">Muestra esta pantalla a tu barbero para canjearlo en tu próxima visita.</p>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-[#13151c] border border-[#222633] flex items-center justify-between gap-3">
            <p className="text-sm text-slate-300">
              Llevas <span className="font-bold text-amber-400">{card.cycleVisits}</span> de{' '}
              <span className="font-bold text-white">{card.targetVisits}</span> visitas
            </p>
            {nextTier && (
              <span className="text-[11px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/40 px-2 py-1 rounded-md shrink-0">
                {nextTier.visits - card.cycleVisits} para {tierShortLabel(nextTier)}
              </span>
            )}
          </div>
        )}

        {/* Próximas citas */}
        {card.upcoming.length > 0 && (
          <div className="p-4 rounded-2xl bg-[#13151c] border border-amber-500/25 space-y-2.5">
            <p className="text-xs font-semibold text-white uppercase tracking-wider font-display flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" /> Tus próximas citas
            </p>
            {card.upcoming.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-2 text-sm p-3 rounded-lg bg-[#0e1014] border border-[#20242e]">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100 truncate">{a.service}</p>
                  <p className="text-xs text-slate-400">
                    {formatDayShort(a.date)} · {a.time}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-1 rounded shrink-0 ${
                    a.status === 'pendiente'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800/50'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                  }`}
                >
                  {a.status === 'pendiente' ? 'Por confirmar' : 'Confirmada'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Tarjeta */}
        <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-amber-500/25 bg-[#090a0d] p-1.5">
          <canvas
            ref={canvasRef}
            className="w-full h-auto rounded-xl block"
            onClick={download}
            title="Toca para guardar la tarjeta como imagen"
          />
          <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-md text-[10px] text-slate-300 border border-white/10 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>En vivo</span>
          </div>
        </div>

        {/* Sellos y premios */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#13151c] border border-[#222633] space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-xs text-white uppercase tracking-wider font-display">Tus sellos</p>
            <span className="font-mono text-xs font-bold text-amber-400">
              {card.cycleVisits} / {card.targetVisits}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: Math.min(card.targetVisits, 30) }).map((_, idx) => {
              const n = idx + 1;
              const stamped = n <= card.cycleVisits;
              const tier = card.rewardTiers.find(t => t.visits === n);
              return (
                <div key={n} className="flex flex-col items-center gap-1">
                  <div
                    className={`aspect-square w-full rounded-xl border flex items-center justify-center ${
                      stamped
                        ? 'bg-gradient-to-br from-amber-600 to-amber-900 border-amber-400/80 text-amber-100'
                        : tier
                        ? 'bg-[#181b24] border-amber-600/60 text-amber-500'
                        : 'bg-[#181b24] border-[#252a38] text-slate-600'
                    }`}
                  >
                    {stamped ? (
                      <Scissors className="w-4 h-4 -rotate-45 text-amber-200" />
                    ) : (
                      <span className="text-xs font-semibold">{n}</span>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold h-3 ${claimedSet.has(n) ? 'text-slate-500' : 'text-amber-400'}`}>
                    {tier ? tierShortLabel(tier) : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <ul className="pt-3 border-t border-[#1e222d] space-y-2">
            {card.rewardTiers.map(t => {
              const done = claimedSet.has(t.visits);
              const ready = card.cycleVisits >= t.visits && !done;
              return (
                <li key={t.visits} className="flex items-start gap-2.5 text-xs">
                  <Gift className={`w-4 h-4 shrink-0 mt-0.5 ${done ? 'text-slate-600' : ready ? 'text-emerald-400' : 'text-amber-400'}`} />
                  <span className={done ? 'text-slate-500 line-through' : ready ? 'text-emerald-300 font-semibold' : 'text-slate-300'}>
                    {describeTier(t)}
                    {done && ' · canjeado'}
                    {ready && ' · ¡disponible!'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-[#13151c] border border-[#222633] min-w-0">
            <p className="text-[10px] text-slate-500 uppercase font-mono">Titular</p>
            <p className="font-bold text-white mt-1 truncate">{card.clientName}</p>
            <p className="text-[10px] font-mono text-amber-500 mt-0.5">{card.loyaltyCode}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-[#13151c] border border-[#222633]">
            <p className="text-[10px] text-slate-500 uppercase font-mono">Última visita</p>
            <p className="font-bold text-slate-200 mt-1">{formatDaysAbsent(daysAbsent)}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(card.lastVisitAt)}</p>
          </div>
        </div>

        {/* Acciones */}
        <div className="space-y-2.5 pt-1">
          {canBook && (
            <button
              onClick={openBooking}
              className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 active:from-amber-400 flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40"
            >
              <Calendar className="w-5 h-5" />
              <span>Reservar mi próxima cita</span>
            </button>
          )}

          {card.barbershopPhone && (
            <button
              onClick={() =>
                whatsappToShop(`¡Hola ${card.barbershopName}! Soy ${card.clientName} (código ${card.loyaltyCode}). Quisiera consultar un turno. 💈`)
              }
              className="w-full py-3 px-4 rounded-xl text-sm font-medium text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Escribir por WhatsApp</span>
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={download}
              className="py-3 px-3 rounded-xl bg-[#181a22] border border-[#262c3a] text-xs font-medium text-slate-200 flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4 text-slate-400" />
              <span>Guardar imagen</span>
            </button>
            <button
              onClick={share}
              className="py-3 px-3 rounded-xl bg-[#181a22] border border-[#262c3a] text-xs font-medium text-slate-200 flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4 text-slate-400" />
              <span>{copied ? 'Enlace copiado ✓' : 'Compartir'}</span>
            </button>
          </div>

          <button
            onClick={() => setShowTip(v => !v)}
            className="w-full py-3 px-3 rounded-xl bg-[#12141a] border border-[#1e232e] text-[12px] text-slate-400 flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-amber-500" /> Guardar esta tarjeta como app en tu móvil
            </span>
            <ChevronRight className={`w-4 h-4 transition-transform ${showTip ? 'rotate-90' : ''}`} />
          </button>
          {showTip && (
            <div className="p-4 rounded-xl bg-[#151720] border border-[#252a38] text-xs text-slate-300 space-y-2">
              <p>
                • <strong>iPhone (Safari):</strong> toca <em>Compartir</em> y elige <em>“Agregar a pantalla de inicio”</em>.
              </p>
              <p>
                • <strong>Android (Chrome):</strong> abre el menú ⋮ y elige <em>“Añadir a la pantalla de inicio”</em>.
              </p>
            </div>
          )}
        </div>

        <p className="text-center pt-4 text-[11px] text-slate-500">
          © {card.barbershopName} · Tus sellos se actualizan solos con cada servicio.
        </p>
      </main>

      {/* Reserva online */}
      {bookingOpen && (
        <Modal
          isOpen
          onClose={() => setBookingOpen(false)}
          title={bookedInfo ? '¡Cita solicitada!' : 'Reservar cita'}
          subtitle={bookedInfo ? undefined : 'Elige servicio, día y hora libre'}
          maxWidth="lg"
        >
          {bookedInfo ? (
            <div className="space-y-4 text-sm text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 flex items-center justify-center mx-auto">
                <Check className="w-7 h-7" />
              </div>
              <div>
                <p className="font-bold text-white text-base">{bookedInfo.service}</p>
                <p className="text-amber-400 font-mono mt-1">
                  {formatDate(bookedInfo.date)} · {bookedInfo.time}
                </p>
              </div>
              <p className="text-xs text-slate-400">
                Tu cita queda <strong className="text-amber-300">por confirmar</strong>. La barbería la confirmará pronto; la verás en “Tus próximas citas”.
              </p>
              <div className="flex flex-col gap-2 pt-2">
                {card.barbershopPhone && (
                  <button
                    onClick={() =>
                      whatsappToShop(
                        `¡Hola ${card.barbershopName}! Soy ${card.clientName} (código ${card.loyaltyCode}). Acabo de reservar ${bookedInfo.service} el ${formatDate(bookedInfo.date)} a las ${bookedInfo.time}. ¿Me la confirman? 💈`
                      )
                    }
                    className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2"
                  >
                    <MessageCircle className="w-4 h-4" /> Avisar por WhatsApp
                  </button>
                )}
                <button onClick={() => setBookingOpen(false)} className="w-full py-3 rounded-xl bg-[#181a20] border border-[#2a2f3a] text-slate-200 font-medium">
                  Listo
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submitBooking} className="space-y-5 text-xs">
              {bookingError && (
                <div className="p-3 bg-red-950/50 border border-red-800/60 rounded-xl text-red-200 text-sm">{bookingError}</div>
              )}

              <div>
                <p className="text-slate-300 font-semibold mb-2">1. Servicio</p>
                <div className="grid grid-cols-1 gap-2">
                  {services.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setServiceId(s.id);
                        setTime('');
                      }}
                      className={`p-3 rounded-xl border text-left flex items-center justify-between gap-3 ${
                        serviceId === s.id
                          ? 'bg-amber-600/20 border-amber-500/70'
                          : 'bg-[#181a20] border-[#252934]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-white truncate">{s.name}</p>
                        <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" /> {s.durationMinutes} min
                        </p>
                      </div>
                      <span className="font-mono font-bold text-amber-400 text-sm shrink-0">
                        {formatCurrency(s.price, card.currency)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-slate-300 font-semibold mb-2">2. Día</p>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
                  {days.map(d => (
                    <button
                      key={d.date}
                      type="button"
                      disabled={!d.open}
                      onClick={() => {
                        setDate(d.date);
                        setTime('');
                      }}
                      className={`shrink-0 w-16 py-2.5 rounded-xl border text-center ${
                        date === d.date
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : d.open
                          ? 'bg-[#181a20] text-slate-200 border-[#252934]'
                          : 'bg-[#101217] text-slate-600 border-[#1a1d25] opacity-50'
                      }`}
                    >
                      <span className="block text-[10px] uppercase">
                        {formatDayShort(d.date).split(' ')[0].replace('.', '')}
                      </span>
                      <span className="block text-lg font-bold leading-tight">{Number(d.date.slice(8, 10))}</span>
                      <span className="block text-[10px]">{d.open ? 'abierto' : 'cerrado'}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-slate-300 font-semibold mb-2">3. Hora</p>
                {!service || !date ? (
                  <p className="text-slate-500">Elige primero un servicio y un día.</p>
                ) : slots.length === 0 ? (
                  <p className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-200 text-sm">
                    No quedan horarios libres ese día. Prueba con otro.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                    {slots.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTime(t)}
                        className={`py-3 rounded-lg border font-mono text-sm font-semibold ${
                          time === t
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-[#181a20] text-slate-200 border-[#252934]'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-slate-300 font-semibold mb-2">Comentario (opcional)</p>
                <input
                  type="text"
                  maxLength={140}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Ej. Voy con mi hijo"
                  className="w-full px-3.5 py-3 bg-[#0e1014] border border-[#282d3b] rounded-lg text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                type="submit"
                disabled={booking || !time}
                className="w-full py-3.5 rounded-xl font-semibold text-sm text-slate-950 bg-amber-500 disabled:opacity-40"
              >
                {booking ? 'Reservando…' : time ? `Reservar ${formatDayShort(date)} a las ${time}` : 'Elige una hora'}
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
