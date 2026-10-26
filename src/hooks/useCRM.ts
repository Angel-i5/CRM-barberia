import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Client,
  Visit,
  FollowUpRecord,
  LoyaltyReward,
  CRMSettings,
  Appointment,
  AppointmentStatus,
  BarberService,
  RewardTier
} from '../types';
import { api, ConnectionStatus, NoticeKind } from '../services/api';
import { LocalStore } from '../services/storage';
import { getDaysSinceDate, isInMonth, todayYMD, generateId } from '../utils/formatters';
import { hasRewardReady, tiersCrossed } from '../utils/loyalty';

export interface Toast {
  id: string;
  kind: NoticeKind;
  message: string;
}

const POLL_INTERVAL_MS = 60_000;

export function useCRM() {
  const initial = api.readLocal();
  const [clients, setClients] = useState<Client[]>(initial.clients);
  const [visits, setVisits] = useState<Visit[]>(initial.visits);
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>(initial.followUps);
  const [rewards, setRewards] = useState<LoyaltyReward[]>(initial.rewards);
  const [appointments, setAppointments] = useState<Appointment[]>(initial.appointments);
  const [services, setServices] = useState<BarberService[]>(initial.services);
  const [settings, setSettings] = useState<CRMSettings>(LocalStore.getSettings());
  const [loading, setLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [status, setStatus] = useState<ConnectionStatus>('local');
  const [pendingCount, setPendingCount] = useState<number>(api.getPendingCount());
  const [needsInitialUpload, setNeedsInitialUpload] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [toasts, setToasts] = useState<Toast[]>([]);

  const syncingRef = useRef(false);

  const pushToast = useCallback((kind: NoticeKind, message: string) => {
    const id = generateId('TST');
    setToasts(prev => [...prev.slice(-2), { id, kind, message }]);
    window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), kind === 'error' ? 8000 : 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  /** Relee todo desde el almacenamiento local (instantáneo, sin red). */
  const refreshLocal = useCallback(() => {
    const d = api.readLocal();
    setClients(d.clients);
    setVisits(d.visits);
    setFollowUps(d.followUps);
    setRewards(d.rewards);
    setAppointments(d.appointments);
    setServices(d.services);
    setSettings(LocalStore.getSettings());
    setPendingCount(api.getPendingCount());
  }, []);

  /** Sincroniza con Google Sheets (si está configurado) y refresca la pantalla. */
  const loadData = useCallback(async (quiet = false) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (!quiet) setLoading(true);
    setIsSyncing(true);
    try {
      const data = await api.getAllData();
      setClients(data.clients);
      setVisits(data.visits);
      setFollowUps(data.followUps);
      setRewards(data.rewards);
      setAppointments(data.appointments);
      setServices(data.services);
      setSettings(LocalStore.getSettings());
      setStatus(data.status);
      setNeedsInitialUpload(data.needsInitialUpload);
      setPendingCount(data.pendingCount);
      setLastSyncTime(new Date());
    } catch (e) {
      console.error('Error loading CRM data:', e);
    } finally {
      syncingRef.current = false;
      setLoading(false);
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Avisos del servicio de datos (sin conexión, rechazos, etc.)
  useEffect(() => {
    const offNotice = api.onNotice(n => pushToast(n.kind, n.message));
    const offPending = api.onPendingChange(setPendingCount);
    return () => {
      offNotice();
      offPending();
    };
  }, [pushToast]);

  // Actualización automática: al volver a la app, al recuperar internet y cada minuto.
  // (Así las reservas que hacen los clientes desde su tarjeta aparecen solas.)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && api.isRemoteEnabled()) loadData(true);
    };
    const onOnline = () => {
      if (api.isRemoteEnabled()) loadData(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && api.isRemoteEnabled()) loadData(true);
    }, POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [loadData]);

  // ---------------------------------------------------------------------
  // Estadísticas derivadas
  // ---------------------------------------------------------------------
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const activeClients = clients.filter(c => c.status !== 'archived');
    const totalClients = activeClients.length;

    const newClientsThisMonth = activeClients.filter(c => isInMonth(c.createdAt, currentYear, currentMonth)).length;

    let inactive7d = 0;
    let inactive14d = 0;
    let inactive21d = 0;
    let inactive30dPlus = 0;
    let noVisitsCount = 0;
    let recentVisitors = 0;

    activeClients.forEach(c => {
      const days = getDaysSinceDate(c.lastVisitAt);
      if (days === null) noVisitsCount++;
      else if (days <= 6) recentVisitors++;
      else if (days < 14) inactive7d++;
      else if (days < 21) inactive14d++;
      else if (days < 30) inactive21d++;
      else inactive30dPlus++;
    });

    const frequentClients = activeClients.filter(c => (c.totalVisits || 0) >= 4).length;

    const clientsWithRewardReady = activeClients.filter(c => hasRewardReady(c, settings)).length;

    const visitsThisMonth = visits.filter(v => isInMonth(v.date, currentYear, currentMonth));
    const totalRevenueThisMonth = visitsThisMonth.reduce((sum, v) => sum + (Number(v.amount) || 0), 0);

    // Último seguimiento de cada cliente (por fecha, no por posición)
    const lastFollowUpByClient = new Map<string, FollowUpRecord>();
    followUps.forEach(f => {
      const prev = lastFollowUpByClient.get(f.clientId);
      if (!prev || f.date > prev.date) lastFollowUpByClient.set(f.clientId, f);
    });

    const pendingContacts = activeClients.filter(c => {
      const days = getDaysSinceDate(c.lastVisitAt);
      const isAbsent = days === null || days >= 14;
      if (!isAbsent) return false;
      const last = lastFollowUpByClient.get(c.id);
      if (!last) return true;
      const sinceContact = getDaysSinceDate(last.date);
      return sinceContact === null || sinceContact >= 14;
    }).length;

    const todayStr = todayYMD();
    const todayAppointments = appointments.filter(a => a.date === todayStr && a.status !== 'cancelada');
    const pendingAppointments = appointments.filter(a => a.status === 'pendiente' && a.date >= todayStr);
    const confirmedTodayCount = todayAppointments.filter(a => a.status === 'confirmada' || a.status === 'en_curso').length;

    return {
      totalClients,
      newClientsThisMonth,
      recentVisitors,
      frequentClients,
      inactive7d,
      inactive14d,
      inactive21d,
      inactive30dPlus,
      noVisitsCount,
      visitsThisMonthCount: visitsThisMonth.length,
      totalRevenueThisMonth,
      clientsWithRewardReady,
      pendingContacts,
      pendingAppointmentsCount: pendingAppointments.length,
      todayAppointmentsCount: todayAppointments.length,
      confirmedTodayCount,
      totalServices: services.length,
      activeServicesCount: services.filter(s => s.isActive).length
    };
  }, [clients, visits, followUps, appointments, services, settings]);

  // ---------------------------------------------------------------------
  // Acciones
  // Patrón: se aplica el cambio local al instante, se pinta la pantalla y
  // después se espera la confirmación de Google Sheets.
  // ---------------------------------------------------------------------
  const run = useCallback(
    async <T,>(op: () => Promise<T>): Promise<T> => {
      const promise = op(); // la parte local se ejecuta de forma síncrona
      refreshLocal();
      const result = await promise;
      setPendingCount(api.getPendingCount());
      return result;
    },
    [refreshLocal]
  );

  const saveClient = (clientData: Client) =>
    run(async () => {
      const res = await api.saveClient(clientData);
      if (!res.success && api.isRemoteEnabled()) loadData(true);
      return res;
    });

  const archiveClient = (clientId: string) => run(() => api.archiveClient(clientId));

  const redeemReward = (client: Client, tier: RewardTier, notes?: string) =>
    run(async () => {
      const reward = await api.redeemReward(client, tier, notes);
      pushToast('success', `Canje registrado: ${tier.title} para ${client.name}`);
      return reward;
    });

  const registerVisit = (visitData: Omit<Visit, 'id'>, redeemTier?: RewardTier) =>
    run(async () => {
      const res = await api.registerVisit(visitData);
      if (res.success && res.after !== undefined && res.after > (res.before ?? 0)) {
        const crossed = tiersCrossed(res.before ?? 0, res.after, LocalStore.getSettings());
        if (crossed.length > 0) {
          pushToast('success', `🎁 ¡${res.visit.clientName} desbloqueó: ${crossed[crossed.length - 1].title}!`);
        }
      }
      if (res.success && redeemTier) {
        const fresh = LocalStore.getClients().find(c => c.id === visitData.clientId);
        if (fresh) {
          await api.redeemReward(
            fresh,
            redeemTier,
            `Aplicado en la visita del ${visitData.date} (${visitData.service}).`
          );
          refreshLocal();
          pushToast('success', `Premio aplicado: ${redeemTier.title}`);
        }
      }
      return res;
    });

  const updateVisit = (updatedVisit: Visit) => run(() => api.updateVisit(updatedVisit));

  const deleteVisit = (visitId: string) => run(() => api.deleteVisit(visitId));

  const logFollowUp = (followUpData: Omit<FollowUpRecord, 'id'>) => run(() => api.logFollowUp(followUpData));

  const updateSettings = async (newSettings: CRMSettings) => {
    const urlChanged = newSettings.googleAppsScriptUrl !== LocalStore.getSettings().googleAppsScriptUrl;
    await run(() => api.saveSettings(newSettings));
    if (urlChanged || api.isRemoteEnabled()) await loadData(true);
  };

  const saveAppointment = (appointment: Appointment) => run(() => api.saveAppointment(appointment));

  const updateAppointmentStatus = (appointmentId: string, status: AppointmentStatus) =>
    run(() => api.updateAppointmentStatus(appointmentId, status));

  const deleteAppointment = (appointmentId: string) => run(() => api.deleteAppointment(appointmentId));

  const completeAppointmentAndRegisterVisit = async (appointment: Appointment, redeemTier?: RewardTier) => {
    await run(() => api.updateAppointmentStatus(appointment.id, 'completada'));
    await registerVisit(
      {
        idempotencyKey: `idem-apt-${appointment.id}`,
        clientId: appointment.clientId,
        clientName: appointment.clientName,
        clientPhone: appointment.clientPhone,
        date: appointment.date,
        time: appointment.time,
        service: appointment.service,
        amount: appointment.amount,
        notes: `Cita completada.${appointment.barberName ? ' Barbero: ' + appointment.barberName + '.' : ''}${
          appointment.notes ? ' ' + appointment.notes : ''
        }`,
        createdAt: new Date().toISOString()
      },
      redeemTier
    );
  };

  const saveService = (serviceData: BarberService) => run(() => api.saveService(serviceData));
  const deleteService = (serviceId: string) => run(() => api.deleteService(serviceId));
  const toggleServiceActive = (serviceId: string) => run(() => api.toggleServiceActive(serviceId));
  const resetDefaultServices = async () => {
    await run(() => api.resetDefaultServices());
  };

  /** Primera conexión: sube a la hoja vacía los datos que ya había en este dispositivo. */
  const uploadInitialData = async () => {
    const res = await api.uploadLocalToRemote();
    if (res.success) {
      pushToast('success', 'Datos subidos a Google Sheets.');
      setNeedsInitialUpload(false);
      await loadData(true);
    } else {
      pushToast('error', `No se pudo subir: ${res.error}`);
    }
    return res;
  };

  const loadDemoData = () => {
    api.loadDemoData();
    refreshLocal();
    pushToast('info', 'Datos de demostración cargados.');
  };

  const clearBusinessData = () => {
    api.clearLocalBusinessData();
    refreshLocal();
  };

  return {
    clients,
    visits,
    followUps,
    rewards,
    appointments,
    services,
    settings,
    loading,
    isSyncing,
    status,
    isRemote: status === 'remote',
    pendingCount,
    needsInitialUpload,
    lastSyncTime,
    stats,
    toasts,
    dismissToast,
    pushToast,
    reloadAll: loadData,
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
  };
}
