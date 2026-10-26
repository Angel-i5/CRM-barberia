import { Client, Visit, FollowUpRecord, LoyaltyReward, CRMSettings, Appointment, BarberService } from '../types';
import { addDaysYMD, todayYMD, getEnvScriptUrl } from '../utils/formatters';
import { DEFAULT_REWARD_TIERS, withDerivedLoyaltyFields, normalizeTiers } from '../utils/loyalty';

export const DEFAULT_SETTINGS: CRMSettings = withDerivedLoyaltyFields({
  barbershopName: 'MI BARBERÍA',
  barbershopPhone: '',
  currency: '$',
  loyaltyTargetVisits: 10,
  rewardBenefit: 'Corte de cabello gratis',
  rewardTiers: DEFAULT_REWARD_TIERS,
  cardStyle: 'obsidian',
  googleAppsScriptUrl: '',
  apiKey: '',
  barbers: ['Barbero Principal'],
  openTime: '09:00',
  closeTime: '20:00',
  slotMinutes: 30,
  workingDays: [1, 2, 3, 4, 5, 6],
  welcomeTemplate:
    '¡Hola {{nombre}}! Bienvenido al club de fidelización de {{barberia}}. Estás registrado y acumulando visitas hacia tus premios.',
  cardDeliveryTemplate:
    '¡Hola {{nombre}}! Aquí tienes tu Tarjeta Digital de {{barberia}}: {{enlace_tarjeta}} . Ábrela en tu móvil para ver tus {{visitas}} visitas y tus premios. ¡Se actualiza en tiempo real cada vez que vengas!',
  reminderTemplate:
    '¡Hola {{nombre}}! Te recordamos que en {{barberia}} nos gusta mantener tu estilo impecable. ¿Te agendamos un turno esta semana?',
  reactivation7dTemplate:
    '¡Hola {{nombre}}! Hace {{dias_ausente}} días de tu última visita en {{barberia}}. Si necesitas repasar contornos o barba antes del fin de semana, avísanos.',
  reactivation14dTemplate:
    '¡Hola {{nombre}}! Ya pasaron {{dias_ausente}} días desde tu corte en {{barberia}}. Es el momento ideal para refrescar el fade. ¿Qué día te queda cómodo?',
  reactivation21dTemplate:
    '¡Hola {{nombre}}! Hace {{dias_ausente}} días que no nos vemos por {{barberia}}. Llevas {{visitas}} visitas acumuladas rumbo a tu próximo premio. ¡Te esperamos!',
  reactivation30dTemplate:
    '¡Hola {{nombre}}! Hace más de un mes ({{dias_ausente}} días) desde tu última visita a {{barberia}}. Queremos verte de nuevo en el sillón. Escríbenos para reservar.',
  appointmentConfirmationTemplate:
    '¡Hola {{nombre}}! Tu cita en {{barberia}} para {{servicio}} el {{fecha}} a las {{hora}} está confirmada con {{barbero}}. ¡Te esperamos!',
  appointmentReminderTemplate:
    '¡Hola {{nombre}}! Te recordamos tu cita hoy en {{barberia}} a las {{hora}} para {{servicio}}. Si necesitas reprogramar, avísanos con tiempo.'
});

export const INITIAL_SERVICES: BarberService[] = [
  {
    id: 'SRV-101',
    name: 'Corte Clásico a Tijera',
    price: 20.0,
    durationMinutes: 30,
    category: 'corte',
    description: 'Lavado revitalizante, corte artesanal a tijera y peinado con pomada mate.',
    isActive: true,
    order: 1
  },
  {
    id: 'SRV-102',
    name: 'Skin Fade / Degradado',
    price: 22.0,
    durationMinutes: 45,
    category: 'corte',
    description: 'Degradado pulido a cero o shaver, navaja en contornos y texturizado superior.',
    isActive: true,
    order: 2
  },
  {
    id: 'SRV-103',
    name: 'Arreglo Barba Ritual',
    price: 16.0,
    durationMinutes: 30,
    category: 'barba',
    description: 'Toalla caliente aromatizada, perfilado a navaja, aceite nutritivo y bálsamo.',
    isActive: true,
    order: 3
  },
  {
    id: 'SRV-104',
    name: 'Combo Corte + Barba Ritual',
    price: 32.0,
    durationMinutes: 60,
    category: 'combo',
    description: 'Servicio estrella: fade o clásico a tijera más arreglo completo de barba con toalla caliente.',
    isActive: true,
    order: 4
  },
  {
    id: 'SRV-105',
    name: 'Afeitado Tradicional Navaja',
    price: 18.0,
    durationMinutes: 35,
    category: 'barba',
    description: 'Espuma caliente batida en brocha, doble pasada a navaja y loción calmante.',
    isActive: true,
    order: 5
  },
  {
    id: 'SRV-106',
    name: 'Camuflaje de Canas / Color',
    price: 25.0,
    durationMinutes: 40,
    category: 'tratamiento',
    description: 'Matizado natural y sutil para cabello o barba con efecto rejuvenecedor.',
    isActive: true,
    order: 6
  },
  {
    id: 'SRV-107',
    name: 'Corte Infantil (hasta 12 años)',
    price: 15.0,
    durationMinutes: 30,
    category: 'corte',
    description: 'Atención paciente y estilo moderno para los más jóvenes de la casa.',
    isActive: true,
    order: 7
  },
  {
    id: 'SRV-108',
    name: 'Exfoliación & Mascarilla Black',
    price: 14.0,
    durationMinutes: 25,
    category: 'tratamiento',
    description: 'Limpieza profunda de poros, exfoliante cítrico y mascarilla de carbón activo.',
    isActive: true,
    order: 8
  }
];

export interface DemoData {
  clients: Client[];
  visits: Visit[];
  followUps: FollowUpRecord[];
  rewards: LoyaltyReward[];
  appointments: Appointment[];
}

/**
 * Datos de demostración con fechas RELATIVAS a hoy (así los segmentos de
 * inactividad, citas de hoy, etc. siempre tienen sentido). Solo se cargan si
 * el administrador lo pide en Configuración.
 */
export function buildDemoData(): DemoData {
  const ago = (n: number) => addDaysYMD(todayYMD(), -n);
  const ahead = (n: number) => addDaysYMD(todayYMD(), n);

  const mk = (
    n: number,
    name: string,
    phone: string,
    daysSinceCreated: number,
    lastVisitDaysAgo: number | null,
    totalVisits: number,
    cycleVisits: number,
    claimedTiers: string,
    totalSpent: number,
    code: string,
    style: 'obsidian' | 'heritage',
    status: Client['status'] = 'active',
    consent = true
  ): Client => ({
    id: `CLI-${1000 + n}`,
    name,
    phone,
    createdAt: ago(daysSinceCreated),
    lastVisitAt: lastVisitDaysAgo === null ? null : ago(lastVisitDaysAgo),
    cutPreferences: 'Fade medio con texturizado, barba perfilada.',
    notes: '',
    totalVisits,
    cycleVisits,
    totalSpent,
    status,
    marketingConsent: consent,
    loyaltyCode: code,
    cardIssuedAt: ago(daysSinceCreated),
    cardStyle: style,
    claimedTiers
  });

  const clients: Client[] = [
    mk(1, 'Carlos Mendoza Ramos', '+34611223344', 70, 3, 7, 7, '5', 175, 'BC-7721', 'obsidian'),
    mk(2, 'Alejandro Vidal Ortiz', '+34622334455', 60, 9, 5, 5, '', 135, 'BC-8492', 'heritage'),
    mk(3, 'Mateo Fernández Cruz', '+34633445566', 100, 16, 10, 10, '5', 270, 'BC-9310', 'obsidian'),
    mk(4, 'Javier Santos Morales', '+34644556677', 120, 23, 4, 4, '', 96, 'BC-4412', 'obsidian'),
    mk(5, 'Diego Navarro Gil', '+34655667788', 150, 45, 3, 3, '', 75, 'BC-2280', 'heritage', 'inactive'),
    mk(6, 'Gonzalo Ruiz Benítez', '+34666778899', 4, null, 0, 0, '', 0, 'BC-5519', 'obsidian'),
    mk(7, 'Lucas Hernando Vega', '+34677889900', 180, 60, 6, 2, '', 160, 'BC-3091', 'heritage', 'active', false)
  ];

  const visit = (
    n: number,
    c: Client,
    daysAgo: number,
    time: string,
    service: string,
    amount: number
  ): Visit => ({
    id: `VIS-${9000 + n}`,
    idempotencyKey: `idem-demo-${n}`,
    clientId: c.id,
    clientName: c.name,
    clientPhone: c.phone,
    date: ago(daysAgo),
    time,
    service,
    amount,
    notes: '',
    createdAt: `${ago(daysAgo)}T${time}:00`
  });

  const visits: Visit[] = [
    visit(1, clients[0], 3, '17:30', 'Combo Corte + Barba Ritual', 32),
    visit(2, clients[1], 9, '11:00', 'Corte Clásico a Tijera', 20),
    visit(3, clients[2], 16, '18:45', 'Skin Fade / Degradado', 22),
    visit(4, clients[3], 23, '19:15', 'Arreglo Barba Ritual', 16),
    visit(5, clients[0], 12, '16:00', 'Skin Fade / Degradado', 22),
    visit(6, clients[0], 26, '12:00', 'Corte Clásico a Tijera', 20),
    visit(7, clients[2], 33, '10:30', 'Combo Corte + Barba Ritual', 32)
  ].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  const followUps: FollowUpRecord[] = [
    {
      id: 'FOL-8001',
      clientId: clients[3].id,
      clientName: clients[3].name,
      clientPhone: clients[3].phone,
      date: `${ago(5)}T10:15:00`,
      templateUsed: 'Reactivación 21 días',
      result: 'respondio',
      notes: 'Comentó que agendará la próxima semana.'
    }
  ];

  const rewards: LoyaltyReward[] = [
    {
      id: 'REW-7001',
      clientId: clients[2].id,
      clientName: clients[2].name,
      redeemedAt: `${ago(50)}T12:00:00`,
      benefitName: '20% de descuento en tu próximo corte',
      visitsConsumed: 5,
      tierVisits: 5,
      notes: 'Canje del nivel 5.'
    }
  ];

  const appointments: Appointment[] = [
    {
      id: 'APT-1001',
      clientId: clients[0].id,
      clientName: clients[0].name,
      clientPhone: clients[0].phone,
      date: todayYMD(),
      time: '16:30',
      service: 'Skin Fade / Degradado',
      durationMinutes: 45,
      amount: 22,
      status: 'confirmada',
      barberName: 'Barbero Principal',
      notes: '',
      createdAt: `${ago(1)}T12:00:00`
    },
    {
      id: 'APT-1002',
      clientId: clients[2].id,
      clientName: clients[2].name,
      clientPhone: clients[2].phone,
      date: todayYMD(),
      time: '18:00',
      service: 'Combo Corte + Barba Ritual',
      durationMinutes: 60,
      amount: 32,
      status: 'pendiente',
      barberName: 'Barbero Principal',
      notes: 'Quiere canjear su corte gratis.',
      createdAt: `${ago(1)}T15:20:00`
    },
    {
      id: 'APT-1003',
      clientId: clients[1].id,
      clientName: clients[1].name,
      clientPhone: clients[1].phone,
      date: ahead(1),
      time: '11:00',
      service: 'Corte Clásico a Tijera',
      durationMinutes: 30,
      amount: 20,
      status: 'confirmada',
      barberName: 'Barbero Principal',
      notes: '',
      createdAt: `${ago(2)}T09:40:00`
    }
  ];

  return { clients, visits, followUps, rewards, appointments };
}

const STORAGE_KEYS = {
  SETTINGS: 'barber_crm_settings',
  CLIENTS: 'barber_crm_clients',
  VISITS: 'barber_crm_visits',
  FOLLOW_UPS: 'barber_crm_follow_ups',
  REWARDS: 'barber_crm_rewards',
  APPOINTMENTS: 'barber_crm_appointments',
  SERVICES: 'barber_crm_services',
  OUTBOX: 'barber_crm_outbox'
};

function readArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('No se pudo guardar en el almacenamiento local:', e);
  }
}

export const LocalStore = {
  getSettings(): CRMSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!raw) {
        return { ...DEFAULT_SETTINGS, googleAppsScriptUrl: getEnvScriptUrl() };
      }
      const stored = JSON.parse(raw);
      const merged: CRMSettings = { ...DEFAULT_SETTINGS, ...stored };

      // Migración: configuración antigua con una sola meta de visitas
      if (!Array.isArray(stored.rewardTiers) && stored.loyaltyTargetVisits) {
        merged.rewardTiers = [
          {
            visits: Number(stored.loyaltyTargetVisits) || 8,
            type: 'free',
            title: stored.rewardBenefit || 'Corte gratis'
          }
        ];
      }
      if (!Array.isArray(merged.barbers) || merged.barbers.length === 0) merged.barbers = DEFAULT_SETTINGS.barbers;
      if (!Array.isArray(merged.workingDays)) merged.workingDays = DEFAULT_SETTINGS.workingDays;
      merged.rewardTiers = normalizeTiers(merged.rewardTiers);
      return withDerivedLoyaltyFields(merged);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },
  setSettings(settings: CRMSettings) {
    writeJson(STORAGE_KEYS.SETTINGS, withDerivedLoyaltyFields(settings));
  },

  getClients(): Client[] {
    return readArray<Client>(STORAGE_KEYS.CLIENTS, []);
  },
  setClients(clients: Client[]) {
    writeJson(STORAGE_KEYS.CLIENTS, clients);
  },

  getVisits(): Visit[] {
    return readArray<Visit>(STORAGE_KEYS.VISITS, []);
  },
  setVisits(visits: Visit[]) {
    writeJson(STORAGE_KEYS.VISITS, visits);
  },

  getFollowUps(): FollowUpRecord[] {
    return readArray<FollowUpRecord>(STORAGE_KEYS.FOLLOW_UPS, []);
  },
  setFollowUps(records: FollowUpRecord[]) {
    writeJson(STORAGE_KEYS.FOLLOW_UPS, records);
  },

  getRewards(): LoyaltyReward[] {
    return readArray<LoyaltyReward>(STORAGE_KEYS.REWARDS, []);
  },
  setRewards(rewards: LoyaltyReward[]) {
    writeJson(STORAGE_KEYS.REWARDS, rewards);
  },

  getAppointments(): Appointment[] {
    return readArray<Appointment>(STORAGE_KEYS.APPOINTMENTS, []);
  },
  setAppointments(appointments: Appointment[]) {
    writeJson(STORAGE_KEYS.APPOINTMENTS, appointments);
  },

  getServices(): BarberService[] {
    const list = readArray<BarberService>(STORAGE_KEYS.SERVICES, []);
    return list.length > 0 ? list : INITIAL_SERVICES;
  },
  hasStoredServices(): boolean {
    return readArray<BarberService>(STORAGE_KEYS.SERVICES, []).length > 0;
  },
  setServices(services: BarberService[]) {
    writeJson(STORAGE_KEYS.SERVICES, services);
  },

  // Cola de cambios que no se pudieron enviar a Google Sheets (sin conexión)
  getOutbox(): any[] {
    return readArray<any>(STORAGE_KEYS.OUTBOX, []);
  },
  setOutbox(items: any[]) {
    writeJson(STORAGE_KEYS.OUTBOX, items);
  },

  hasBusinessData(): boolean {
    return (
      this.getClients().length > 0 ||
      this.getVisits().length > 0 ||
      this.getAppointments().length > 0
    );
  }
};
