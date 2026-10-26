/**
 * Utilidades de formato y fechas.
 *
 * IMPORTANTE (zona horaria): las fechas del CRM se guardan como "YYYY-MM-DD"
 * (sin hora). `new Date('2026-10-10')` las interpreta como UTC y en países con
 * UTC negativo (Venezuela, México, Argentina...) mostraba el día anterior.
 * Por eso TODAS las fechas pasan por `parseLocalDate` y `toLocalYMD`.
 */

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Convierte "YYYY-MM-DD" (o ISO completo) en un Date a medianoche LOCAL. */
export function parseLocalDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const str = String(value).trim();
  const m = YMD_RE.exec(str);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/** Date -> "YYYY-MM-DD" usando la zona horaria LOCAL del dispositivo. */
export function toLocalYMD(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Fecha de hoy "YYYY-MM-DD" en hora local. */
export function todayYMD(): string {
  return toLocalYMD(new Date());
}

/** Hora actual "HH:mm" en hora local. */
export function nowHM(): string {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

/** Suma días a una fecha "YYYY-MM-DD" y devuelve "YYYY-MM-DD". */
export function addDaysYMD(ymd: string, days: number): string {
  const d = parseLocalDate(ymd) || new Date();
  d.setDate(d.getDate() + days);
  return toLocalYMD(d);
}

/** ¿La fecha (YYYY-MM-DD / ISO) cae en el mes y año indicados (hora local)? */
export function isInMonth(value: string | null | undefined, year: number, month: number): boolean {
  const d = parseLocalDate(value);
  return !!d && d.getFullYear() === year && d.getMonth() === month;
}

/**
 * Normalizes an international phone number.
 * Removes spaces, dashes, parentheses. Returns clean digits with country code.
 */
export function normalizePhone(phone: string): { raw: string; cleanDigits: string; isValid: boolean } {
  if (!phone) return { raw: '', cleanDigits: '', isValid: false };

  const trimmed = phone.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  // Un número internacional válido tiene entre 8 y 15 dígitos
  const isValid = digitsOnly.length >= 8 && digitsOnly.length <= 15;

  return {
    raw: trimmed,
    cleanDigits: digitsOnly,
    isValid
  };
}

/**
 * Creates a valid wa.me URL with prefilled URL-encoded text.
 */
export function buildWhatsAppLink(phone: string, text: string): string {
  const { cleanDigits } = normalizePhone(phone);
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${cleanDigits}?text=${encodedText}`;
}

/** URL del backend configurada al compilar (variable VITE_APPS_SCRIPT_URL). */
export function getEnvScriptUrl(): string {
  try {
    const env = (import.meta as any).env;
    return (env && env.VITE_APPS_SCRIPT_URL) || '';
  } catch {
    return '';
  }
}

const SCRIPT_URL_PREFIX = 'https://script.google.com/macros/s/';
const SCRIPT_URL_SUFFIX = '/exec';

/** Extrae el ID de implementación de la URL de Apps Script (versión corta para enlaces). */
export function scriptUrlToId(url: string): string {
  if (!url || !url.startsWith(SCRIPT_URL_PREFIX) || !url.endsWith(SCRIPT_URL_SUFFIX)) return '';
  return url.slice(SCRIPT_URL_PREFIX.length, url.length - SCRIPT_URL_SUFFIX.length);
}

/** Reconstruye la URL de Apps Script a partir del ID corto. */
export function scriptIdToUrl(id: string): string {
  if (!id || !/^[A-Za-z0-9_-]{20,}$/.test(id)) return '';
  return `${SCRIPT_URL_PREFIX}${id}${SCRIPT_URL_SUFFIX}`;
}

/**
 * Returns the public URL to view the digital loyalty card in the browser.
 * Si el sitio se compiló con VITE_APPS_SCRIPT_URL el enlace es corto; si no,
 * incluye el ID del backend (`s=`) para que funcione en el móvil del cliente,
 * que no tiene la configuración guardada del administrador.
 */
export function getClientCardUrl(loyaltyCode: string, scriptUrl?: string): string {
  const code = encodeURIComponent(loyaltyCode);
  let query = `?card=${code}`;
  if (!getEnvScriptUrl() && scriptUrl) {
    const id = scriptUrlToId(scriptUrl);
    if (id) query += `&s=${encodeURIComponent(id)}`;
  }
  if (typeof window === 'undefined') return query;
  return `${window.location.origin}${window.location.pathname}${query}`;
}

/**
 * Replaces template variables in a WhatsApp message
 */
export function compileTemplate(
  template: string,
  vars: {
    nombre?: string;
    barberia?: string;
    visitas?: number | string;
    recompensa?: string;
    dias_ausente?: number | string;
    enlace_tarjeta?: string;
    fecha?: string;
    hora?: string;
    servicio?: string;
    barbero?: string;
  }
): string {
  const cardUrl = vars.enlace_tarjeta || '';
  return (template || '')
    .replace(/\{\{nombre\}\}/g, vars.nombre || 'cliente')
    .replace(/\{\{barberia\}\}/g, vars.barberia || 'nuestra barbería')
    .replace(/\{\{visitas\}\}/g, String(vars.visitas ?? 0))
    .replace(/\{\{recompensa\}\}/g, vars.recompensa || 'tu recompensa')
    .replace(/\{\{dias_ausente\}\}/g, String(vars.dias_ausente ?? 0))
    .replace(/\{\{enlace_tarjeta\}\}/g, cardUrl)
    .replace(/\{\{fecha\}\}/g, vars.fecha || '')
    .replace(/\{\{hora\}\}/g, vars.hora || '')
    .replace(/\{\{servicio\}\}/g, vars.servicio || '')
    .replace(/\{\{barbero\}\}/g, vars.barbero || '');
}

/**
 * Días transcurridos desde una fecha (YYYY-MM-DD o ISO), en días calendario locales.
 */
export function getDaysSinceDate(dateStr: string | null | undefined): number | null {
  const target = parseLocalDate(dateStr);
  if (!target) return null;

  const now = new Date();
  const d1 = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Math.round absorbe los cambios de horario de verano (23h / 25h)
  const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Human readable label for days absent
 */
export function formatDaysAbsent(days: number | null): string {
  if (days === null) return 'Sin visitas previas';
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return `Hace ${days} días`;
}

/**
 * Formats a currency value
 */
export function formatCurrency(amount: number, symbol: string = '$'): string {
  const n = Number(amount) || 0;
  return `${symbol}${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Formats a date to readable Spanish string
 */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const d = parseLocalDate(dateStr);
  if (!d) return String(dateStr);
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Formats date and time
 */
export function formatDateTime(dateTimeStr?: string | null): string {
  if (!dateTimeStr) return '-';
  const d = parseLocalDate(dateTimeStr);
  if (!d) return String(dateTimeStr);
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Fecha larga para listas de agenda: "mar, 13 oct". */
export function formatDayShort(dateStr?: string | null): string {
  const d = parseLocalDate(dateStr);
  if (!d) return '-';
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' });
}

/**
 * Generates a unique loyalty code like "BC-7492"
 */
export function generateLoyaltyCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `BC-${num}`;
}

/** Genera un ID con prefijo y sufijo aleatorio suficientemente único. */
export function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${stamp}${rand}`;
}

/**
 * Safely triggers an external URL navigation without window.open
 */
export function openExternalUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
