import React, { useMemo, useState } from 'react';
import {
  Users,
  Scissors,
  Gift,
  Calendar,
  Clock,
  UserCheck,
  ArrowRight,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Wallet,
  Receipt
} from 'lucide-react';
import { StatCard } from '../components/StatCard';
import { Client, Visit, CRMSettings, Appointment, RewardTier } from '../types';
import {
  formatCurrency,
  formatDate,
  getDaysSinceDate,
  formatDaysAbsent,
  todayYMD,
  addDaysYMD,
  isInMonth,
  formatDayShort
} from '../utils/formatters';
import { getUnlockedTiers, tierShortLabel } from '../utils/loyalty';

interface DashboardPageProps {
  stats: {
    totalClients: number;
    newClientsThisMonth: number;
    recentVisitors: number;
    frequentClients: number;
    inactive7d: number;
    inactive14d: number;
    inactive21d: number;
    inactive30dPlus: number;
    noVisitsCount: number;
    visitsThisMonthCount: number;
    totalRevenueThisMonth: number;
    clientsWithRewardReady: number;
    pendingContacts: number;
    pendingAppointmentsCount?: number;
    todayAppointmentsCount?: number;
    confirmedTodayCount?: number;
  };
  clients: Client[];
  visits: Visit[];
  appointments?: Appointment[];
  settings: CRMSettings;
  onNavigateTab: (tab: any) => void;
  onSelectClientForCard: (client: Client) => void;
  onSelectClientForWhatsApp: (client: Client) => void;
  onScheduleAppointment?: (client?: Client) => void;
  onRedeemReward?: (client: Client, tier: RewardTier) => void;
}

const STATUS_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  en_curso: 'En sillón',
  completada: 'Completada',
  cancelada: 'Cancelada'
};

const STATUS_CLS: Record<string, string> = {
  pendiente: 'bg-amber-950 text-amber-300 border border-amber-800/50',
  confirmada: 'bg-emerald-950 text-emerald-300 border border-emerald-800/50',
  en_curso: 'bg-blue-950 text-blue-300 border border-blue-800/50',
  completada: 'bg-slate-800 text-slate-400',
  cancelada: 'bg-red-950 text-red-300 border border-red-900/50'
};

function sumAmount(list: Visit[]): number {
  return list.reduce((s, v) => s + (Number(v.amount) || 0), 0);
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  stats,
  clients,
  visits,
  appointments = [],
  settings,
  onNavigateTab,
  onSelectClientForCard,
  onSelectClientForWhatsApp,
  onScheduleAppointment,
  onRedeemReward
}) => {
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  const todayStr = todayYMD();

  const todayAppointments = useMemo(
    () => appointments.filter(a => a.date === todayStr).sort((a, b) => a.time.localeCompare(b.time)),
    [appointments, todayStr]
  );

  // ---------------------------------------------------------------------
  // Rendimiento del negocio
  // ---------------------------------------------------------------------
  const perf = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const prevY = m === 0 ? y - 1 : y;
    const prevM = m === 0 ? 11 : m - 1;

    const inPeriod = period === 'month' ? visits.filter(v => isInMonth(v.date, y, m)) : visits;
    const prevMonth = visits.filter(v => isInMonth(v.date, prevY, prevM));

    const revenue = sumAmount(inPeriod);
    const count = inPeriod.length;
    const ticket = count > 0 ? revenue / count : 0;
    const uniqueClients = new Set(inPeriod.map(v => v.clientId)).size;

    const prevRevenue = sumAmount(prevMonth);
    const delta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;

    // Servicios más vendidos
    const byService = new Map<string, { count: number; revenue: number }>();
    inPeriod.forEach(v => {
      const key = (v.service || 'Sin servicio').trim();
      const cur = byService.get(key) || { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += Number(v.amount) || 0;
      byService.set(key, cur);
    });
    const topServices = Array.from(byService.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .slice(0, 5);

    // Ingresos de los últimos 14 días
    const days: { date: string; revenue: number; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const date = addDaysYMD(todayStr, -i);
      const list = visits.filter(v => v.date === date);
      days.push({ date, revenue: sumAmount(list), count: list.length });
    }
    const maxDay = Math.max(1, ...days.map(d => d.revenue));

    return { revenue, count, ticket, uniqueClients, prevRevenue, delta, topServices, days, maxDay };
  }, [visits, period, todayStr]);

  const recentVisits = [...visits]
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    .slice(0, 6);

  const rewardReady = useMemo(
    () =>
      clients
        .filter(c => c.status !== 'archived')
        .map(c => ({ client: c, tiers: getUnlockedTiers(c, settings) }))
        .filter(x => x.tiers.length > 0),
    [clients, settings]
  );

  const latestClients = [...clients]
    .filter(c => c.status !== 'archived')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 5);

  const periodLabel = period === 'month' ? 'este mes' : 'histórico';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Cabecera + periodo */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#14171d] p-4 sm:p-6 rounded-2xl border border-[#222631]">
        <div className="min-w-0">
          <span className="text-[11px] uppercase tracking-widest text-amber-500 font-semibold font-mono">
            Panel de control
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-display mt-1 truncate">
            {settings.barbershopName}
          </h2>
          <p className="text-xs text-slate-400 mt-1">Clientes, ingresos y fidelización de un vistazo.</p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#101217] rounded-lg border border-[#20242d] self-stretch md:self-auto">
          {(['month', 'all'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`flex-1 md:flex-none px-4 py-2 text-xs font-medium rounded-md transition-colors ${
                period === p
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-600/40'
                  : 'text-slate-400 hover:text-white border border-transparent'
              }`}
            >
              {p === 'month' ? 'Este mes' : 'Histórico'}
            </button>
          ))}
        </div>
      </div>

      {/* Premios listos */}
      {rewardReady.length > 0 && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-amber-950/60 via-[#1e1b15] to-[#14171d] border border-amber-600/40 space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-200">
                {rewardReady.length} {rewardReady.length === 1 ? 'cliente tiene' : 'clientes tienen'} premio por canjear
              </p>
              <p className="text-xs text-amber-400/80">Se aplican al cobrar la próxima visita.</p>
            </div>
            <button
              onClick={() => onNavigateTab('clients')}
              className="px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors shrink-0"
            >
              Ver
            </button>
          </div>
          <div className="space-y-1.5">
            {rewardReady.slice(0, 4).map(({ client, tiers }) => (
              <div
                key={client.id}
                className="flex items-center justify-between gap-2 bg-black/20 rounded-lg px-3 py-2 text-xs"
              >
                <span className="font-medium text-slate-100 truncate">{client.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {tiers.map(t => (
                    <button
                      key={t.visits}
                      onClick={() => (onRedeemReward ? onRedeemReward(client, t) : onNavigateTab('clients'))}
                      className="px-2.5 py-1.5 rounded-md bg-emerald-600/20 text-emerald-300 border border-emerald-600/40 font-semibold hover:bg-emerald-600/30"
                    >
                      {tierShortLabel(t)} · Canjear
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {rewardReady.length > 4 && (
              <p className="text-[11px] text-amber-400/70 px-1">y {rewardReady.length - 4} más…</p>
            )}
          </div>
        </div>
      )}

      {/* Métricas clave */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard
          title="Turnos hoy"
          value={stats.todayAppointmentsCount ?? 0}
          subtitle={`${stats.confirmedTodayCount ?? 0} confirmados · ${stats.pendingAppointmentsCount ?? 0} pend.`}
          icon={Calendar}
          accent="amber"
          onClick={() => onNavigateTab('appointments')}
        />
        <StatCard
          title="Clientes"
          value={stats.totalClients}
          subtitle={`+${stats.newClientsThisMonth} este mes`}
          icon={Users}
          accent="copper"
          onClick={() => onNavigateTab('clients')}
        />
        <StatCard
          title="Visitas del mes"
          value={stats.visitsThisMonthCount}
          subtitle={formatCurrency(stats.totalRevenueThisMonth, settings.currency)}
          icon={Scissors}
          accent="copper"
          onClick={() => onNavigateTab('visits')}
        />
        <StatCard
          title="Frecuentes"
          value={stats.frequentClients}
          subtitle="4 o más visitas"
          icon={UserCheck}
          accent="emerald"
          onClick={() => onNavigateTab('clients')}
        />
        <StatCard
          title="Por contactar"
          value={stats.pendingContacts}
          subtitle="Ausentes ≥14 días"
          icon={MessageSquare}
          accent="slate"
          onClick={() => onNavigateTab('followup')}
        />
      </div>

      {/* Rendimiento del negocio */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#14171d] border border-[#222631] space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white font-display">Rendimiento del negocio</h3>
            <p className="text-xs text-slate-400">Periodo: {periodLabel}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-[#181b23] border border-[#232733]">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-emerald-400" /> Ingresos
            </p>
            <p className="text-xl font-bold text-white mt-1 font-mono">
              {formatCurrency(perf.revenue, settings.currency)}
            </p>
            {period === 'month' && perf.delta !== null && (
              <p
                className={`text-[11px] mt-0.5 flex items-center gap-1 ${
                  perf.delta >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {perf.delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {perf.delta >= 0 ? '+' : ''}
                {perf.delta.toFixed(0)}% vs mes anterior
              </p>
            )}
            {period === 'month' && perf.delta === null && (
              <p className="text-[11px] text-slate-500 mt-0.5">Sin mes anterior para comparar</p>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-[#181b23] border border-[#232733]">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-amber-400" /> Servicios realizados
            </p>
            <p className="text-xl font-bold text-white mt-1">{perf.count}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{perf.uniqueClients} clientes distintos</p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#181b23] border border-[#232733]">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-sky-400" /> Ticket promedio
            </p>
            <p className="text-xl font-bold text-white mt-1 font-mono">
              {formatCurrency(perf.ticket, settings.currency)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Por servicio</p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#181b23] border border-[#232733]">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-copper" /> Visitas / cliente
            </p>
            <p className="text-xl font-bold text-white mt-1">
              {perf.uniqueClients > 0 ? (perf.count / perf.uniqueClients).toFixed(1) : '0'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Frecuencia en el periodo</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Barras 14 días */}
          <div className="p-3.5 rounded-xl bg-[#101217] border border-[#1e222c]">
            <p className="text-xs font-semibold text-slate-300 mb-3">Ingresos de los últimos 14 días</p>
            <div className="flex items-end gap-1 h-28" role="img" aria-label="Gráfico de ingresos de los últimos 14 días">
              {perf.days.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${formatDayShort(d.date)}: ${formatCurrency(d.revenue, settings.currency)} (${d.count})`}>
                  <div
                    className={`w-full rounded-t ${d.date === todayStr ? 'bg-amber-400' : 'bg-amber-600/60'}`}
                    style={{ height: `${Math.max(d.revenue > 0 ? 6 : 2, (d.revenue / perf.maxDay) * 100)}%`, opacity: d.revenue > 0 ? 1 : 0.25 }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1.5">
              <span>{formatDayShort(perf.days[0].date)}</span>
              <span>hoy</span>
            </div>
          </div>

          {/* Top servicios */}
          <div className="p-3.5 rounded-xl bg-[#101217] border border-[#1e222c]">
            <p className="text-xs font-semibold text-slate-300 mb-3">Servicios más vendidos</p>
            {perf.topServices.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">Aún no hay servicios en este periodo.</p>
            ) : (
              <div className="space-y-2.5">
                {perf.topServices.map(s => {
                  const pct = (s.count / perf.topServices[0].count) * 100;
                  return (
                    <div key={s.name}>
                      <div className="flex items-center justify-between text-[11px] gap-2">
                        <span className="text-slate-200 truncate">{s.name}</span>
                        <span className="text-slate-400 font-mono shrink-0">
                          {s.count}× · {formatCurrency(s.revenue, settings.currency)}
                        </span>
                      </div>
                      <div className="h-1.5 mt-1 rounded bg-[#1c2029] overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-600 to-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Turnos de hoy */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#14171d] border border-[#222631]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white font-display">
                Turnos de hoy ({todayAppointments.length})
              </h3>
              <p className="text-xs text-slate-400">{formatDate(todayStr)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (onScheduleAppointment ? onScheduleAppointment() : onNavigateTab('appointments'))}
              className="flex-1 sm:flex-none px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-semibold"
            >
              + Agendar turno
            </button>
            <button
              onClick={() => onNavigateTab('appointments')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#1a1d24] hover:bg-[#232732] text-amber-300 border border-amber-600/30 rounded-lg text-xs font-medium"
            >
              <span>Agenda</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {todayAppointments.length === 0 ? (
          <div className="py-6 px-4 rounded-xl bg-[#101217] border border-[#1e222c] text-center text-xs text-slate-400">
            No hay turnos para hoy.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {todayAppointments.map(apt => (
              <button
                key={apt.id}
                onClick={() => onNavigateTab('appointments')}
                className={`text-left p-3.5 rounded-xl bg-[#181b23] border border-[#232733] hover:border-amber-500/40 transition-colors space-y-2.5 ${
                  apt.status === 'cancelada' ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-amber-400 text-sm bg-[#0e1014] px-2 py-0.5 rounded border border-[#282d3b]">
                    {apt.time}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${STATUS_CLS[apt.status]}`}>
                    {STATUS_LABEL[apt.status]}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-white text-sm truncate">{apt.clientName}</p>
                  <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-0.5">
                    <Scissors className="w-3 h-3 text-amber-500 shrink-0" />
                    <span className="truncate">{apt.service}</span>
                  </p>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1.5 border-t border-[#20242f]">
                  <span>{apt.barberName || 'Por asignar'}</span>
                  <span className="text-amber-400 font-bold">{formatCurrency(apt.amount, settings.currency)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Retención */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#14171d] border border-[#222631]">
        <div className="flex items-start sm:items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white font-display">Retención de clientes</h3>
            <p className="text-xs text-slate-400">Según la fecha de su última visita.</p>
          </div>
          <button
            onClick={() => onNavigateTab('followup')}
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-medium shrink-0 py-1"
          >
            <span>Reactivar</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Recientes (<7d)', value: stats.recentVisitors, hint: 'Al día', cls: 'text-emerald-400', hover: 'hover:border-emerald-500/40' },
            { label: '7 días', value: stats.inactive7d, hint: 'Retoque de barba', cls: 'text-amber-400', hover: 'hover:border-amber-500/40' },
            { label: '14 días', value: stats.inactive14d, hint: 'Refrescar corte', cls: 'text-amber-400', hover: 'hover:border-amber-500/40' },
            { label: '21 días', value: stats.inactive21d, hint: 'Hora de volver', cls: 'text-orange-400', hover: 'hover:border-orange-500/40' },
            { label: '+30 días', value: stats.inactive30dPlus, hint: 'En riesgo de fuga', cls: 'text-red-400', hover: 'hover:border-red-500/40' },
            { label: 'Sin visitas', value: stats.noVisitsCount, hint: 'Nunca vinieron', cls: 'text-slate-400', hover: 'hover:border-slate-500/40' }
          ].map(b => (
            <button
              key={b.label}
              onClick={() => onNavigateTab('followup')}
              className={`text-left p-3.5 rounded-xl bg-[#181b23] border border-[#232733] transition-colors ${b.hover}`}
            >
              <p className={`text-[11px] font-medium uppercase tracking-wider ${b.cls}`}>{b.label}</p>
              <p className="text-xl font-bold text-white mt-1">{b.value}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{b.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Últimas visitas + últimos clientes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="p-4 sm:p-5 rounded-2xl bg-[#14171d] border border-[#222631]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Últimas visitas</h3>
            </div>
            <button onClick={() => onNavigateTab('visits')} className="text-xs text-amber-400 hover:text-amber-300 font-medium py-1">
              Ver todas ({visits.length})
            </button>
          </div>

          {recentVisits.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">Aún no hay visitas. Registra la primera con el botón +.</div>
          ) : (
            <div className="divide-y divide-[#20242e]">
              {recentVisits.map(v => (
                <div key={v.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-200 truncate">{v.clientName}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {v.service} · {formatDate(v.date)} {v.time}
                    </p>
                  </div>
                  <p className="font-semibold text-amber-400 shrink-0 font-mono">
                    {formatCurrency(v.amount, settings.currency)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-[#14171d] border border-[#222631]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Últimos clientes</h3>
            </div>
            <button onClick={() => onNavigateTab('clients')} className="text-xs text-amber-400 hover:text-amber-300 font-medium py-1">
              Directorio
            </button>
          </div>

          {latestClients.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">Todavía no hay clientes.</div>
          ) : (
            <div className="divide-y divide-[#20242e]">
              {latestClients.map(c => {
                const days = getDaysSinceDate(c.lastVisitAt);
                return (
                  <div key={c.id} className="py-3 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-200 truncate">{c.name}</p>
                        <span className="text-[10px] font-mono text-amber-500/90 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/30 shrink-0">
                          {c.loyaltyCode}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {formatDaysAbsent(days)} · {c.cycleVisits}/{settings.loyaltyTargetVisits} sellos
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onSelectClientForCard(c)}
                        className="px-2.5 py-1.5 text-[11px] font-medium bg-[#1d212b] hover:bg-[#252a36] text-slate-300 rounded border border-[#2c3242]"
                      >
                        Tarjeta
                      </button>
                      <button
                        onClick={() => onSelectClientForWhatsApp(c)}
                        aria-label={`Seguimiento de ${c.name}`}
                        className="p-1.5 text-emerald-400 hover:bg-emerald-950/40 rounded"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
