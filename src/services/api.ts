import {
  Client,
  Visit,
  FollowUpRecord,
  LoyaltyReward,
  CRMSettings,
  ApiResponse,
  PublicCardData,
  Appointment,
  AppointmentStatus,
  BarberService,
  BookingRequest,
  RewardTier
} from '../types';
import { LocalStore, INITIAL_SERVICES, buildDemoData } from './storage';
import { generateId, getEnvScriptUrl, todayYMD } from '../utils/formatters';
import { claimTier, getClaimedTiers, getTiers, getFinalTier } from '../utils/loyalty';
import { appointmentsToBusy, getCapacity, isSlotFree, isWorkingDate } from '../utils/scheduling';

export type ConnectionStatus = 'local' | 'remote' | 'offline' | 'unauthorized';

export type NoticeKind = 'info' | 'success' | 'error';
export interface ApiNotice {
  kind: NoticeKind;
  message: string;
}

interface PostResult extends ApiResponse {
  networkError?: boolean;
  unauthorized?: boolean;
}

/** Acciones que no necesitan la clave de administrador (tarjeta pública del cliente). */
const PUBLIC_ACTIONS = new Set(['ping', 'getClientCard', 'bookAppointment']);

/** Ajustes que son propios de cada dispositivo y nunca viajan a Google Sheets. */
const LOCAL_ONLY_SETTINGS = ['googleAppsScriptUrl', 'apiKey'];

const REQUEST_TIMEOUT_MS = 25000;

const byDateTimeDesc = <T extends { date: string; time?: string }>(a: T, b: T) =>
  `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`);

function sanitizeSettingsForRemote(settings: CRMSettings): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...settings };
  for (const k of LOCAL_ONLY_SETTINGS) delete clean[k];
  return clean;
}

type Listener<T> = (value: T) => void;

class ApiService {
  private noticeListeners: Listener<ApiNotice>[] = [];
  private pendingListeners: Listener<number>[] = [];
  private flushing: Promise<void> | null = null;

  // ---------------------------------------------------------------------
  // Eventos (la interfaz se suscribe para mostrar avisos y cambios pendientes)
  // ---------------------------------------------------------------------
  onNotice(fn: Listener<ApiNotice>) {
    this.noticeListeners.push(fn);
    return () => {
      this.noticeListeners = this.noticeListeners.filter(l => l !== fn);
    };
  }

  onPendingChange(fn: Listener<number>) {
    this.pendingListeners.push(fn);
    return () => {
      this.pendingListeners = this.pendingListeners.filter(l => l !== fn);
    };
  }

  private notify(kind: NoticeKind, message: string) {
    this.noticeListeners.forEach(l => l({ kind, message }));
  }

  getPendingCount(): number {
    return LocalStore.getOutbox().length;
  }

  private emitPending() {
    const n = this.getPendingCount();
    this.pendingListeners.forEach(l => l(n));
  }

  // ---------------------------------------------------------------------
  // Conexión
  // ---------------------------------------------------------------------
  getScriptUrl(override?: string): string {
    const fromOverride = (override || '').trim();
    if (fromOverride) return fromOverride;
    const fromSettings = (LocalStore.getSettings().googleAppsScriptUrl || '').trim();
    return fromSettings || getEnvScriptUrl();
  }

  isRemoteEnabled(): boolean {
    return this.getScriptUrl().startsWith('https://script.google.com/');
  }

  private async post(payload: Record<string, any>, urlOverride?: string, keyOverride?: string): Promise<PostResult> {
    const url = this.getScriptUrl(urlOverride);
    if (!url.startsWith('https://script.google.com/')) {
      return { success: false, networkError: true, error: 'No hay URL de Google Apps Script configurada.' };
    }

    const body: Record<string, any> = { ...payload };
    if (!PUBLIC_ACTIONS.has(String(payload.action))) {
      body.apiKey = keyOverride !== undefined ? keyOverride : LocalStore.getSettings().apiKey || '';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // text/plain evita el "preflight" CORS que Apps Script no soporta
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        return { success: false, networkError: true, error: `El servidor respondió HTTP ${response.status}` };
      }
      let json: PostResult;
      try {
        json = await response.json();
      } catch {
        return {
          success: false,
          networkError: true,
          error: 'La URL no devolvió datos del CRM. Revisa que la implementación sea "Cualquier persona" y termine en /exec.'
        };
      }
      if (json && json.code === 'UNAUTHORIZED') json.unauthorized = true;
      return json;
    } catch (err: any) {
      return {
        success: false,
        networkError: true,
        error: err?.name === 'AbortError' ? 'Tiempo de espera agotado' : err?.message || 'Sin conexión'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Envía un cambio a Google Sheets garantizando el ORDEN y sin perder datos:
   *  - Si no hay conexión, el cambio queda en una cola y se reintenta solo.
   *  - Si el servidor lo rechaza (ej. teléfono duplicado), se avisa.
   */
  private async syncWrite(payload: Record<string, any>): Promise<{ ok: boolean; rejected?: boolean; queued?: boolean }> {
    if (!this.isRemoteEnabled()) return { ok: true };

    const outbox = LocalStore.getOutbox();
    if (outbox.length > 0) {
      LocalStore.setOutbox([...outbox, payload]);
      this.emitPending();
      await this.flushOutbox();
      return { ok: false, queued: this.getPendingCount() > 0 };
    }

    const res = await this.post(payload);
    if (res.networkError) {
      LocalStore.setOutbox([payload]);
      this.emitPending();
      this.notify('info', 'Sin conexión: el cambio se guardó en este dispositivo y se enviará a Google Sheets cuando haya internet.');
      return { ok: false, queued: true };
    }
    if (res.unauthorized) {
      this.notify('error', 'La clave de API no coincide con la del script. Revisa Configuración > Clave de API.');
      return { ok: false, rejected: true };
    }
    if (!res.success) {
      this.notify('error', `Google Sheets rechazó el cambio: ${res.error || 'error desconocido'}`);
      return { ok: false, rejected: true };
    }
    return { ok: true };
  }

  /** Reintenta la cola de cambios pendientes. Devuelve cuántos quedan. */
  async flushOutbox(): Promise<number> {
    if (this.flushing) {
      await this.flushing;
      return this.getPendingCount();
    }
    this.flushing = (async () => {
      let queue = LocalStore.getOutbox();
      while (queue.length > 0) {
        const res = await this.post(queue[0]);
        if (res.networkError || res.unauthorized) break; // lo intentamos más tarde
        if (!res.success) {
          console.warn('Cambio pendiente rechazado por el servidor, se descarta:', queue[0].action, res.error);
          this.notify('error', `Un cambio pendiente fue rechazado por Google Sheets: ${res.error || ''}`);
        }
        queue = queue.slice(1);
        LocalStore.setOutbox(queue);
      }
      this.emitPending();
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
    return this.getPendingCount();
  }

  /** Prueba la conexión y devuelve un resumen de lo que hay en la hoja. */
  async pingUrl(
    url: string,
    apiKey?: string
  ): Promise<{
    success: boolean;
    message: string;
    durationMs: number;
    secured?: boolean;
    authorized?: boolean;
    counts?: { clients: number; visits: number; appointments: number; services: number };
  }> {
    if (!url || !url.startsWith('https://script.google.com/')) {
      return { success: false, message: 'La URL debe comenzar con https://script.google.com/.../exec', durationMs: 0 };
    }
    const start = performance.now();
    const res = await this.post({ action: 'ping' }, url);
    const durationMs = Math.round(performance.now() - start);

    if (!res.success) {
      return { success: false, message: res.error || 'No se pudo conectar con el script', durationMs };
    }
    const probe = await this.post({ action: 'getAllData' }, url, apiKey || '');
    if (probe.unauthorized) {
      return {
        success: false,
        message: 'Conexión correcta, pero la clave de API es incorrecta o está vacía.',
        durationMs,
        secured: true,
        authorized: false
      };
    }
    const d = probe.data || {};
    return {
      success: true,
      message: res.secured
        ? 'Conexión verificada con Google Sheets (acceso protegido con clave).'
        : 'Conexión verificada. ⚠ Tu script no tiene clave de API: cualquiera con la URL podría leer tus datos.',
      durationMs,
      secured: !!res.secured,
      authorized: true,
      counts: {
        clients: (d.clients || []).length,
        visits: (d.visits || []).length,
        appointments: (d.appointments || []).length,
        services: (d.services || []).length
      }
    };
  }

  // ---------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------
  readLocal() {
    return {
      clients: LocalStore.getClients(),
      visits: [...LocalStore.getVisits()].sort(byDateTimeDesc),
      followUps: [...LocalStore.getFollowUps()].sort((a, b) => b.date.localeCompare(a.date)),
      rewards: [...LocalStore.getRewards()].sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt)),
      appointments: LocalStore.getAppointments(),
      services: LocalStore.getServices()
    };
  }

  /**
   * Trae todos los datos. Con Google Sheets conectado, la hoja es la FUENTE DE
   * VERDAD (también cuando está vacía, así un borrado se refleja en todos los
   * dispositivos). Excepción: si la hoja está vacía pero este dispositivo tiene
   * datos, se conservan y se ofrece subirlos (`needsInitialUpload`).
   */
  async getAllData(): Promise<
    ReturnType<ApiService['readLocal']> & {
      status: ConnectionStatus;
      needsInitialUpload: boolean;
      pendingCount: number;
    }
  > {
    if (!this.isRemoteEnabled()) {
      return { ...this.readLocal(), status: 'local', needsInitialUpload: false, pendingCount: 0 };
    }

    const pending = await this.flushOutbox();
    if (pending > 0) {
      // No sobrescribimos lo local mientras haya cambios sin enviar
      return { ...this.readLocal(), status: 'offline', needsInitialUpload: false, pendingCount: pending };
    }

    const res = await this.post({ action: 'getAllData' });
    if (res.unauthorized) {
      this.notify('error', 'La clave de API no coincide con la del script. Revisa Configuración > Clave de API.');
      return { ...this.readLocal(), status: 'unauthorized', needsInitialUpload: false, pendingCount: 0 };
    }
    if (!res.success || !res.data) {
      return { ...this.readLocal(), status: 'offline', needsInitialUpload: false, pendingCount: 0 };
    }

    const d = res.data;
    const remoteIsEmpty =
      !(d.clients || []).length &&
      !(d.visits || []).length &&
      !(d.appointments || []).length &&
      !(d.rewards || []).length &&
      !(d.followUps || []).length;

    if (remoteIsEmpty && LocalStore.hasBusinessData()) {
      return { ...this.readLocal(), status: 'remote', needsInitialUpload: true, pendingCount: 0 };
    }

    LocalStore.setClients(d.clients || []);
    LocalStore.setVisits(d.visits || []);
    LocalStore.setFollowUps(d.followUps || []);
    LocalStore.setRewards(d.rewards || []);
    LocalStore.setAppointments(d.appointments || []);
    if (Array.isArray(d.services) && d.services.length > 0) LocalStore.setServices(d.services);

    // Los ajustes del negocio (niveles de premio, horarios...) viajan por Sheets
    if (d.settings && Object.keys(d.settings).length > 0) {
      const merged: CRMSettings = { ...LocalStore.getSettings(), ...d.settings };
      for (const k of LOCAL_ONLY_SETTINGS) {
        (merged as any)[k] = (LocalStore.getSettings() as any)[k];
      }
      LocalStore.setSettings(merged);
    }

    return { ...this.readLocal(), status: 'remote', needsInitialUpload: false, pendingCount: 0 };
  }

  /** Sube los datos de este dispositivo a una hoja vacía (primera conexión). */
  async uploadLocalToRemote(): Promise<{ success: boolean; error?: string }> {
    const local = this.readLocal();
    const res = await this.post({
      action: 'syncAll',
      data: {
        clients: local.clients,
        visits: local.visits,
        followUps: local.followUps,
        rewards: local.rewards,
        appointments: local.appointments,
        services: local.services,
        settings: sanitizeSettingsForRemote(LocalStore.getSettings())
      }
    });
    if (!res.success) return { success: false, error: res.error || 'No se pudo subir' };
    return { success: true };
  }

  // ---------------------------------------------------------------------
  // Tarjeta pública del cliente + reserva online
  // ---------------------------------------------------------------------
  /**
   * Datos de la tarjeta pública. `urlOverride` permite abrir el enlace en el
   * móvil de un cliente (que no tiene la configuración del administrador).
   */
  async fetchPublicCard(
    loyaltyCode: string,
    urlOverride?: string
  ): Promise<{ data?: PublicCardData; error?: string; notFound?: boolean; networkError?: boolean }> {
    if (!loyaltyCode) return { notFound: true, error: 'Código vacío' };

    const url = this.getScriptUrl(urlOverride);
    if (url.startsWith('https://script.google.com/')) {
      const res = await this.post({ action: 'getClientCard', code: loyaltyCode }, url);
      if (res.success && res.data) return { data: res.data as PublicCardData };
      if (res.networkError) return { networkError: true, error: res.error };
      return { notFound: true, error: res.error };
    }

    // Modo local (solo para probar con "Ver como cliente" en este mismo navegador)
    const settings = LocalStore.getSettings();
    const client = LocalStore.getClients().find(
      c => c.loyaltyCode && c.loyaltyCode.toUpperCase() === loyaltyCode.toUpperCase()
    );
    if (!client || client.status === 'archived') {
      return { notFound: true, error: 'No encontramos una tarjeta activa con este código.' };
    }

    const appts = LocalStore.getAppointments();
    const today = todayYMD();
    const tiers = getTiers(settings);
    const cycleVisits = client.cycleVisits || 0;
    const target = getFinalTier(settings).visits;

    return {
      data: {
        loyaltyCode: client.loyaltyCode,
        clientName: client.name,
        cycleVisits,
        totalVisits: client.totalVisits || 0,
        targetVisits: target,
        rewardBenefit: settings.rewardBenefit,
        rewardTiers: tiers,
        claimedTiers: getClaimedTiers(client),
        barbershopName: settings.barbershopName,
        barbershopPhone: settings.barbershopPhone,
        currency: settings.currency,
        cardStyle: client.cardStyle || settings.cardStyle || 'obsidian',
        lastVisitAt: client.lastVisitAt,
        cardIssuedAt: client.cardIssuedAt,
        isRewardUnlocked: cycleVisits >= target,
        services: LocalStore.getServices()
          .filter(s => s.isActive)
          .map(s => ({
            id: s.id,
            name: s.name,
            price: s.price,
            durationMinutes: s.durationMinutes,
            description: s.description
          })),
        busy: appointmentsToBusy(appts.filter(a => a.date >= today)),
        capacity: getCapacity(settings),
        openTime: settings.openTime,
        closeTime: settings.closeTime,
        slotMinutes: settings.slotMinutes,
        workingDays: settings.workingDays,
        upcoming: appts
          .filter(a => a.clientId === client.id && a.date >= today && a.status !== 'cancelada' && a.status !== 'completada')
          .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
          .slice(0, 3)
          .map(a => ({ id: a.id, date: a.date, time: a.time, service: a.service, status: a.status }))
      }
    };
  }

  /** Reserva una cita desde la tarjeta del cliente (valida todo en el servidor). */
  async bookPublicAppointment(
    req: BookingRequest,
    urlOverride?: string
  ): Promise<{ success: boolean; error?: string; slotTaken?: boolean; appointment?: { id: string; date: string; time: string; service: string; status: AppointmentStatus } }> {
    const url = this.getScriptUrl(urlOverride);
    if (url.startsWith('https://script.google.com/')) {
      const res = await this.post({ action: 'bookAppointment', ...req }, url);
      if (res.success && res.appointment) return { success: true, appointment: res.appointment };
      return { success: false, error: res.error || 'No se pudo reservar', slotTaken: res.code === 'SLOT_TAKEN' };
    }

    // Modo local: mismas reglas que el servidor
    const settings = LocalStore.getSettings();
    const client = LocalStore.getClients().find(c => c.loyaltyCode?.toUpperCase() === req.code.toUpperCase());
    const service = LocalStore.getServices().find(s => s.id === req.serviceId && s.isActive);
    if (!client || !service) return { success: false, error: 'Datos de reserva inválidos' };
    if (!isWorkingDate(req.date, settings)) return { success: false, error: 'La barbería no atiende ese día.' };
    const appts = LocalStore.getAppointments();
    if (!isSlotFree(req.date, req.time, service.durationMinutes, appointmentsToBusy(appts), getCapacity(settings))) {
      return { success: false, slotTaken: true, error: 'Ese horario acaba de ocuparse. Elige otro.' };
    }
    const apt: Appointment = {
      id: generateId('APT'),
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      date: req.date,
      time: req.time,
      service: service.name,
      durationMinutes: service.durationMinutes,
      amount: service.price,
      status: 'pendiente',
      barberName: 'Por asignar',
      notes: `Reserva online.${req.notes ? ' ' + req.notes : ''}`,
      createdAt: new Date().toISOString()
    };
    LocalStore.setAppointments([apt, ...appts]);
    return { success: true, appointment: { id: apt.id, date: apt.date, time: apt.time, service: apt.service, status: apt.status } };
  }

  // ---------------------------------------------------------------------
  // Clientes
  // (Todas las mutaciones actualizan lo LOCAL de forma síncrona y después
  //  esperan a Google Sheets, así la pantalla responde al instante.)
  // ---------------------------------------------------------------------
  async saveClient(client: Client): Promise<{ success: boolean; client: Client; error?: string }> {
    const clients = LocalStore.getClients();
    const cleanPhone = client.phone.replace(/\D/g, '');

    const existingIndex = clients.findIndex(c => c.id === client.id);
    const duplicatePhone = clients.find(c => c.id !== client.id && c.phone.replace(/\D/g, '') === cleanPhone);
    if (duplicatePhone) {
      return {
        success: false,
        client,
        error: `El teléfono ${client.phone} ya pertenece a otro cliente (${duplicatePhone.name})`
      };
    }

    const savedClient: Client = { ...client };
    if (!savedClient.id) savedClient.id = generateId('CLI');
    if (!savedClient.createdAt) savedClient.createdAt = todayYMD();

    if (existingIndex >= 0) {
      const updated = [...clients];
      updated[existingIndex] = savedClient;
      LocalStore.setClients(updated);
    } else {
      LocalStore.setClients([savedClient, ...clients]);
    }

    const sync = await this.syncWrite({ action: 'saveClient', client: savedClient });
    if (sync.rejected) {
      return { success: false, client: savedClient, error: 'Google Sheets no aceptó al cliente (¿teléfono o código repetido?).' };
    }
    return { success: true, client: savedClient };
  }

  async archiveClient(clientId: string): Promise<boolean> {
    const clients = LocalStore.getClients();
    LocalStore.setClients(clients.map(c => (c.id === clientId ? { ...c, status: 'archived' as const } : c)));
    await this.syncWrite({ action: 'archiveClient', clientId });
    return true;
  }

  // ---------------------------------------------------------------------
  // Visitas
  // ---------------------------------------------------------------------
  async registerVisit(
    visit: Omit<Visit, 'id'> & { id?: string }
  ): Promise<{ success: boolean; visit: Visit; error?: string; before?: number; after?: number }> {
    const visits = LocalStore.getVisits();

    const id = visit.id || generateId('VIS');
    const idempotencyKey = visit.idempotencyKey || `idem-${id}`;

    const existing = visits.find(v => v.idempotencyKey === idempotencyKey || v.id === id);
    if (existing) return { success: true, visit: existing };

    const newVisit: Visit = {
      ...visit,
      id,
      idempotencyKey,
      createdAt: visit.createdAt || new Date().toISOString()
    };

    LocalStore.setVisits([newVisit, ...visits]);

    const clients = LocalStore.getClients();
    const clientIdx = clients.findIndex(c => c.id === newVisit.clientId);
    let before = 0;
    let after = 0;
    if (clientIdx >= 0) {
      const c = clients[clientIdx];
      before = c.cycleVisits || 0;
      after = before + 1;
      const lastVisitAt = !c.lastVisitAt || newVisit.date > c.lastVisitAt ? newVisit.date : c.lastVisitAt;
      const updatedClients = [...clients];
      updatedClients[clientIdx] = {
        ...c,
        totalVisits: (c.totalVisits || 0) + 1,
        cycleVisits: after,
        totalSpent: (c.totalSpent || 0) + (Number(newVisit.amount) || 0),
        lastVisitAt,
        status: 'active'
      };
      LocalStore.setClients(updatedClients);
    }

    await this.syncWrite({ action: 'registerVisit', visit: newVisit });
    return { success: true, visit: newVisit, before, after };
  }

  private latestVisitDate(clientId: string): string | null {
    const dates = LocalStore.getVisits()
      .filter(v => v.clientId === clientId)
      .map(v => v.date)
      .sort();
    return dates.length > 0 ? dates[dates.length - 1] : null;
  }

  async updateVisit(updatedVisit: Visit): Promise<boolean> {
    const visits = LocalStore.getVisits();
    const idx = visits.findIndex(v => v.id === updatedVisit.id);
    if (idx < 0) return false;

    const oldVisit = visits[idx];
    // El cliente de una visita no se cambia (descuadraría los sellos)
    const fixed: Visit = {
      ...updatedVisit,
      clientId: oldVisit.clientId,
      clientName: oldVisit.clientName,
      clientPhone: oldVisit.clientPhone
    };
    const amountDiff = (Number(fixed.amount) || 0) - (Number(oldVisit.amount) || 0);

    const updatedList = [...visits];
    updatedList[idx] = fixed;
    LocalStore.setVisits(updatedList);

    const clients = LocalStore.getClients();
    const cIdx = clients.findIndex(c => c.id === fixed.clientId);
    if (cIdx >= 0) {
      const updatedClients = [...clients];
      updatedClients[cIdx] = {
        ...clients[cIdx],
        totalSpent: Math.max(0, (clients[cIdx].totalSpent || 0) + amountDiff),
        lastVisitAt: this.latestVisitDate(fixed.clientId)
      };
      LocalStore.setClients(updatedClients);
    }

    await this.syncWrite({ action: 'updateVisit', visit: fixed });
    return true;
  }

  async deleteVisit(visitId: string): Promise<boolean> {
    const visits = LocalStore.getVisits();
    const target = visits.find(v => v.id === visitId);
    if (!target) return false;

    LocalStore.setVisits(visits.filter(v => v.id !== visitId));

    const clients = LocalStore.getClients();
    const cIdx = clients.findIndex(c => c.id === target.clientId);
    if (cIdx >= 0) {
      const c = clients[cIdx];
      const updatedClients = [...clients];
      updatedClients[cIdx] = {
        ...c,
        totalVisits: Math.max(0, (c.totalVisits || 0) - 1),
        cycleVisits: Math.max(0, (c.cycleVisits || 0) - 1),
        totalSpent: Math.max(0, (c.totalSpent || 0) - (Number(target.amount) || 0)),
        lastVisitAt: this.latestVisitDate(target.clientId)
      };
      LocalStore.setClients(updatedClients);
    }

    await this.syncWrite({ action: 'deleteVisit', visitId });
    return true;
  }

  // ---------------------------------------------------------------------
  // Recompensas por niveles
  // ---------------------------------------------------------------------
  /**
   * Canjea un nivel de la tarjeta (ej. 5 visitas → descuento, 10 → gratis).
   * Nivel intermedio: se marca canjeado y el ciclo continúa.
   * Último nivel: el ciclo vuelve a 0 (las visitas históricas se conservan).
   */
  async redeemReward(client: Client, tier: RewardTier, notes?: string): Promise<LoyaltyReward> {
    const settings = LocalStore.getSettings();
    const newReward: LoyaltyReward = {
      id: generateId('REW'),
      clientId: client.id,
      clientName: client.name,
      redeemedAt: new Date().toISOString(),
      benefitName: tier.title,
      visitsConsumed: tier.visits,
      tierVisits: tier.visits,
      notes: notes || undefined
    };

    LocalStore.setRewards([newReward, ...LocalStore.getRewards()]);

    const clients = LocalStore.getClients();
    const cIdx = clients.findIndex(c => c.id === client.id);
    let patch: { cycleVisits: number; claimedTiers: string } = { cycleVisits: 0, claimedTiers: '' };
    if (cIdx >= 0) {
      const updated = claimTier(clients[cIdx], tier, settings);
      patch = { cycleVisits: updated.cycleVisits, claimedTiers: updated.claimedTiers || '' };
      const list = [...clients];
      list[cIdx] = updated;
      LocalStore.setClients(list);
    }

    await this.syncWrite({ action: 'redeemReward', reward: newReward, clientPatch: patch });
    return newReward;
  }

  // ---------------------------------------------------------------------
  // Seguimiento
  // ---------------------------------------------------------------------
  async logFollowUp(followUp: Omit<FollowUpRecord, 'id'>): Promise<FollowUpRecord> {
    const newRecord: FollowUpRecord = {
      ...followUp,
      id: generateId('FOL'),
      date: followUp.date || new Date().toISOString()
    };
    LocalStore.setFollowUps([newRecord, ...LocalStore.getFollowUps()]);
    await this.syncWrite({ action: 'logFollowUp', followUp: newRecord });
    return newRecord;
  }

  // ---------------------------------------------------------------------
  // Configuración
  // ---------------------------------------------------------------------
  async saveSettings(settings: CRMSettings): Promise<boolean> {
    LocalStore.setSettings(settings);
    const saved = LocalStore.getSettings();
    await this.syncWrite({ action: 'saveSettings', settings: sanitizeSettingsForRemote(saved) });
    return true;
  }

  // ---------------------------------------------------------------------
  // Citas
  // ---------------------------------------------------------------------
  async saveAppointment(appointment: Appointment): Promise<Appointment> {
    const appointments = LocalStore.getAppointments();
    const savedApt = { ...appointment };
    if (!savedApt.id) savedApt.id = generateId('APT');
    if (!savedApt.createdAt) savedApt.createdAt = new Date().toISOString();

    const idx = appointments.findIndex(a => a.id === savedApt.id);
    if (idx >= 0) {
      const list = [...appointments];
      list[idx] = savedApt;
      LocalStore.setAppointments(list);
    } else {
      LocalStore.setAppointments([savedApt, ...appointments]);
    }

    await this.syncWrite({ action: 'saveAppointment', appointment: savedApt });
    return savedApt;
  }

  async updateAppointmentStatus(appointmentId: string, status: AppointmentStatus): Promise<boolean> {
    const appointments = LocalStore.getAppointments();
    LocalStore.setAppointments(appointments.map(a => (a.id === appointmentId ? { ...a, status } : a)));
    await this.syncWrite({ action: 'updateAppointmentStatus', appointmentId, status });
    return true;
  }

  async deleteAppointment(appointmentId: string): Promise<boolean> {
    LocalStore.setAppointments(LocalStore.getAppointments().filter(a => a.id !== appointmentId));
    await this.syncWrite({ action: 'deleteAppointment', appointmentId });
    return true;
  }

  // ---------------------------------------------------------------------
  // Servicios
  // ---------------------------------------------------------------------
  async saveService(service: BarberService): Promise<BarberService> {
    const services = LocalStore.getServices();
    const savedService = { ...service };
    if (!savedService.id) savedService.id = generateId('SRV');
    if (savedService.order === undefined) savedService.order = services.length + 1;

    const idx = services.findIndex(s => s.id === savedService.id);
    if (idx >= 0) {
      const list = [...services];
      list[idx] = savedService;
      LocalStore.setServices(list);
    } else {
      LocalStore.setServices([...services, savedService]);
    }

    await this.syncWrite({ action: 'saveService', service: savedService });
    return savedService;
  }

  async deleteService(serviceId: string): Promise<boolean> {
    LocalStore.setServices(LocalStore.getServices().filter(s => s.id !== serviceId));
    await this.syncWrite({ action: 'deleteService', serviceId });
    return true;
  }

  async toggleServiceActive(serviceId: string): Promise<boolean> {
    const services = LocalStore.getServices();
    LocalStore.setServices(services.map(s => (s.id === serviceId ? { ...s, isActive: !s.isActive } : s)));
    await this.syncWrite({ action: 'toggleServiceActive', serviceId });
    return true;
  }

  async resetDefaultServices(): Promise<BarberService[]> {
    LocalStore.setServices(INITIAL_SERVICES);
    await this.syncWrite({ action: 'resetServices', services: INITIAL_SERVICES });
    return INITIAL_SERVICES;
  }

  // ---------------------------------------------------------------------
  // Demo / mantenimiento (solo modo local)
  // ---------------------------------------------------------------------
  loadDemoData() {
    const demo = buildDemoData();
    LocalStore.setClients(demo.clients);
    LocalStore.setVisits(demo.visits);
    LocalStore.setFollowUps(demo.followUps);
    LocalStore.setRewards(demo.rewards);
    LocalStore.setAppointments(demo.appointments);
  }

  clearLocalBusinessData() {
    LocalStore.setClients([]);
    LocalStore.setVisits([]);
    LocalStore.setFollowUps([]);
    LocalStore.setRewards([]);
    LocalStore.setAppointments([]);
    LocalStore.setOutbox([]);
    this.emitPending();
  }
}

export const api = new ApiService();
