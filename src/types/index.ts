export type ClientStatus = 'active' | 'inactive' | 'archived';

export interface Client {
  id: string; // e.g. "CLI-1001"
  name: string;
  phone: string; // E.164 format, e.g. "+584121234567"
  createdAt: string; // YYYY-MM-DD
  lastVisitAt: string | null; // YYYY-MM-DD
  birthday?: string; // YYYY-MM-DD
  cutPreferences: string;
  notes: string;
  totalVisits: number;
  cycleVisits: number; // Visits towards the current loyalty cycle
  totalSpent: number;
  status: ClientStatus;
  marketingConsent: boolean;
  loyaltyCode: string; // e.g. "BC-8492"
  cardIssuedAt?: string;
  cardStyle?: 'obsidian' | 'heritage';
  /**
   * Niveles de recompensa ya canjeados dentro del ciclo actual, como lista
   * separada por comas con las visitas del nivel. Ej: "5" o "5,10".
   * Se limpia cuando se canjea el último nivel (el ciclo se reinicia).
   */
  claimedTiers?: string;
}

export interface Visit {
  id: string; // e.g. "VIS-5001"
  idempotencyKey?: string; // prevents double counting
  clientId: string;
  clientName: string;
  clientPhone: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  service: string;
  amount: number;
  notes?: string;
  createdAt: string;
}

export type AppointmentStatus = 'pendiente' | 'confirmada' | 'en_curso' | 'completada' | 'cancelada';

export interface Appointment {
  id: string; // e.g. "APT-1001"
  clientId: string;
  clientName: string;
  clientPhone: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  service: string;
  durationMinutes: number;
  amount: number;
  status: AppointmentStatus;
  barberName?: string;
  notes?: string;
  createdAt: string;
}

export type FollowUpResult = 'pendiente' | 'contactado' | 'respondio' | 'reservo' | 'no_interesado';

export interface FollowUpRecord {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  date: string; // ISO
  templateUsed: string;
  result: FollowUpResult;
  notes?: string;
}

export interface LoyaltyReward {
  id: string;
  clientId: string;
  clientName: string;
  redeemedAt: string; // ISO
  benefitName: string; // e.g. "20% de descuento"
  visitsConsumed: number; // visitas del nivel canjeado
  tierVisits?: number; // umbral del nivel canjeado (5, 10...)
  notes?: string;
}

/** Un nivel de la tarjeta de fidelización (hito dentro del ciclo). */
export type RewardTierType = 'discount' | 'free' | 'custom';

export interface RewardTier {
  /** Visitas del ciclo necesarias para desbloquear este premio (ej. 5, 10). */
  visits: number;
  type: RewardTierType;
  /** Solo para type 'discount': porcentaje de descuento (1-100). */
  discountPercent?: number;
  /** Texto visible para el cliente. Ej: "20% de descuento en tu próximo corte". */
  title: string;
}

export interface CRMSettings {
  barbershopName: string;
  barbershopPhone: string;
  currency: string; // e.g. "$", "€", "Bs."
  /** Derivado: visitas del último nivel (cierra el ciclo). No editar a mano. */
  loyaltyTargetVisits: number;
  /** Derivado: título del último nivel. No editar a mano. */
  rewardBenefit: string;
  /** Niveles de recompensa (ordenados por visitas). */
  rewardTiers: RewardTier[];
  cardStyle: 'obsidian' | 'heritage';
  googleAppsScriptUrl: string; // Web app URL for Apps Script (solo local)
  apiKey?: string; // Clave del administrador (solo local)
  // Agenda
  barbers: string[]; // Barberos / sillones. La capacidad simultánea = cantidad
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
  slotMinutes: number; // Intervalo de turnos, ej. 30
  workingDays: number[]; // 0=domingo ... 6=sábado
  // Plantillas WhatsApp
  welcomeTemplate: string;
  cardDeliveryTemplate: string;
  reminderTemplate: string;
  reactivation7dTemplate: string;
  reactivation14dTemplate: string;
  reactivation21dTemplate: string;
  reactivation30dTemplate: string;
  appointmentConfirmationTemplate: string;
  appointmentReminderTemplate: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  [key: string]: any;
}

export type InactivitySegment = 'recent' | 'days7' | 'days14' | 'days21' | 'days30plus' | 'no_visits';

export type ServiceCategory = 'corte' | 'barba' | 'combo' | 'tratamiento' | 'otro';

export interface BarberService {
  id: string; // e.g. "SRV-101"
  name: string;
  price: number;
  durationMinutes: number;
  category: ServiceCategory;
  description?: string;
  isActive: boolean;
  order?: number;
}

/** Hueco ocupado de la agenda (lo que ve la tarjeta pública, sin datos personales). */
export interface BusySlot {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  durationMinutes: number;
}

export interface PublicService {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  description?: string;
}

export interface PublicAppointment {
  id: string;
  date: string;
  time: string;
  service: string;
  status: AppointmentStatus;
}

export interface PublicCardData {
  loyaltyCode: string;
  clientName: string;
  cycleVisits: number;
  totalVisits: number;
  targetVisits: number;
  rewardBenefit: string;
  rewardTiers: RewardTier[];
  claimedTiers: number[];
  barbershopName: string;
  barbershopPhone: string;
  currency: string;
  cardStyle: 'obsidian' | 'heritage';
  lastVisitAt: string | null;
  cardIssuedAt?: string;
  isRewardUnlocked: boolean;
  // Reserva online
  services: PublicService[];
  busy: BusySlot[];
  capacity: number;
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  workingDays: number[];
  upcoming: PublicAppointment[];
}

export interface BookingRequest {
  code: string;
  date: string;
  time: string;
  serviceId: string;
  notes?: string;
}
