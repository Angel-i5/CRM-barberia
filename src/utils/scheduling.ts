import { Appointment, BusySlot, CRMSettings } from '../types';
import { nowHM, parseLocalDate, todayYMD } from './formatters';

/**
 * Lógica de disponibilidad de la agenda.
 * Se usa en el panel del administrador y en la reserva online del cliente.
 * (El backend de Apps Script replica esta misma regla para validar de verdad.)
 */

export const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function timeToMinutes(hm: string): number {
  const [h, m] = String(hm || '0:0').split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Cantidad de sillones/barberos que pueden atender a la vez. */
export function getCapacity(settings: Pick<CRMSettings, 'barbers'>): number {
  return Math.max(1, (settings.barbers || []).filter(b => b && b.trim()).length);
}

/** ¿El negocio abre ese día de la semana? */
export function isWorkingDate(date: string, settings: Pick<CRMSettings, 'workingDays'>): boolean {
  const d = parseLocalDate(date);
  if (!d) return false;
  const days = settings.workingDays && settings.workingDays.length > 0 ? settings.workingDays : [1, 2, 3, 4, 5, 6];
  return days.includes(d.getDay());
}

/** Convierte citas del admin en huecos ocupados (ignora las canceladas). */
export function appointmentsToBusy(appointments: Appointment[], excludeId?: string): BusySlot[] {
  return appointments
    .filter(a => a.status !== 'cancelada' && a.id !== excludeId)
    .map(a => ({ date: a.date, time: a.time, durationMinutes: a.durationMinutes || 30 }));
}

/** Cuántas citas ya ocupan el intervalo [start, start+duration) ese día. */
export function countConcurrent(date: string, startMin: number, duration: number, busy: BusySlot[]): number {
  const end = startMin + duration;
  let count = 0;
  for (const b of busy) {
    if (b.date !== date) continue;
    const bs = timeToMinutes(b.time);
    const be = bs + (b.durationMinutes || 30);
    if (startMin < be && bs < end) count++;
  }
  return count;
}

/** ¿Se puede reservar a esa hora? */
export function isSlotFree(
  date: string,
  time: string,
  duration: number,
  busy: BusySlot[],
  capacity: number
): boolean {
  return countConcurrent(date, timeToMinutes(time), duration, busy) < capacity;
}

/**
 * Horarios libres de un día.
 * - Respeta días laborables, horario de apertura/cierre e intervalo.
 * - No ofrece horas pasadas si el día es hoy (salvo `allowPast`).
 */
export function getAvailableSlots(opts: {
  date: string;
  durationMinutes: number;
  settings: Pick<CRMSettings, 'openTime' | 'closeTime' | 'slotMinutes' | 'workingDays' | 'barbers'>;
  busy: BusySlot[];
  capacity?: number;
  allowPast?: boolean;
}): string[] {
  const { date, durationMinutes, settings, busy, allowPast } = opts;
  if (!date || !isWorkingDate(date, settings)) return [];

  const capacity = opts.capacity ?? getCapacity(settings);
  const open = timeToMinutes(settings.openTime || '09:00');
  const close = timeToMinutes(settings.closeTime || '20:00');
  const step = Math.max(5, settings.slotMinutes || 30);
  const duration = Math.max(5, durationMinutes || 30);

  const isToday = date === todayYMD();
  const nowMin = timeToMinutes(nowHM());

  const slots: string[] = [];
  for (let start = open; start + duration <= close; start += step) {
    if (!allowPast && isToday && start <= nowMin) continue;
    if (!allowPast && date < todayYMD()) continue;
    if (countConcurrent(date, start, duration, busy) < capacity) {
      slots.push(minutesToTime(start));
    }
  }
  return slots;
}
