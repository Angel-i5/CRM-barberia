import React, { useState, useEffect } from 'react';
import {
  Settings,
  Database,
  Code,
  Copy,
  Check,
  Gift,
  MessageSquare,
  Shield,
  Save,
  AlertTriangle,
  Play,
  Scissors,
  ArrowRight,
  Sparkles,
  Plus,
  Trash2,
  Calendar,
  CloudUpload,
  KeyRound,
  X,
  FlaskConical
} from 'lucide-react';
import { CRMSettings, RewardTier, RewardTierType } from '../types';
import { api } from '../services/api';
import type { ConnectionStatus } from '../services/api';
import { GOOGLE_APPS_SCRIPT_CODE, SHEETS_STRUCTURE, SETUP_INSTRUCTIONS } from '../services/sheetsBackendCode';
import { getEnvScriptUrl } from '../utils/formatters';
import { normalizeTiers, withDerivedLoyaltyFields, describeTier, DEFAULT_REWARD_TIERS } from '../utils/loyalty';
import { WEEKDAY_LABELS } from '../utils/scheduling';
import { Modal } from '../components/Modal';

interface SettingsPageProps {
  settings: CRMSettings;
  onUpdateSettings: (newSettings: CRMSettings) => Promise<void>;
  status: ConnectionStatus;
  pendingCount: number;
  needsInitialUpload: boolean;
  onUploadInitialData: () => Promise<{ success: boolean; error?: string }>;
  onLoadDemoData: () => void;
  onClearBusinessData: () => void;
  hasBusinessData: boolean;
  onNavigateTab?: (tab: any) => void;
  servicesCount?: number;
}

const inputCls =
  'w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white text-sm focus:outline-none';

const Card: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({
  icon: Icon,
  title,
  children
}) => (
  <section className="bg-[#14171d] p-4 sm:p-6 rounded-2xl border border-[#222631] space-y-4">
    <div className="flex items-center gap-2.5">
      <Icon className="w-5 h-5 text-amber-500 shrink-0" />
      <h3 className="text-base font-semibold text-white tracking-wide font-display">{title}</h3>
    </div>
    {children}
  </section>
);

const TEMPLATE_FIELDS: { key: keyof CRMSettings; label: string; hint?: string }[] = [
  { key: 'welcomeTemplate', label: 'Bienvenida' },
  { key: 'cardDeliveryTemplate', label: 'Entrega de tarjeta digital', hint: '{{enlace_tarjeta}} inserta el enlace de su tarjeta.' },
  { key: 'reactivation7dTemplate', label: 'Reactivación · 7 días sin venir' },
  { key: 'reactivation14dTemplate', label: 'Reactivación · 14 días sin venir' },
  { key: 'reactivation21dTemplate', label: 'Reactivación · 21 días sin venir' },
  { key: 'reactivation30dTemplate', label: 'Reactivación · +30 días sin venir' },
  { key: 'reminderTemplate', label: 'Recordatorio general' },
  {
    key: 'appointmentConfirmationTemplate',
    label: 'Confirmación de cita',
    hint: 'Variables: {{nombre}} {{barberia}} {{servicio}} {{fecha}} {{hora}} {{barbero}}'
  },
  { key: 'appointmentReminderTemplate', label: 'Recordatorio de cita', hint: 'Mismas variables que la confirmación.' }
];

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onUpdateSettings,
  status,
  pendingCount,
  needsInitialUpload,
  onUploadInitialData,
  onLoadDemoData,
  onClearBusinessData,
  hasBusinessData,
  onNavigateTab,
  servicesCount = 0
}) => {
  const [form, setForm] = useState<CRMSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [codeCopied, setCodeCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<Awaited<ReturnType<typeof api.pingUrl>> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newBarber, setNewBarber] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const envUrl = getEnvScriptUrl();

  // Si cambian los ajustes desde fuera (sincronización) y no hay edición en curso, se refrescan
  useEffect(() => {
    if (!dirty) setForm(settings);
  }, [settings, dirty]);

  const patch = (p: Partial<CRMSettings>) => {
    setForm(f => ({ ...f, ...p }));
    setDirty(true);
    setSaved(false);
  };

  // ---------------------------------------------------------- premios
  const tiers = form.rewardTiers;
  const setTiers = (list: RewardTier[]) => patch({ rewardTiers: list });
  const updateTier = (idx: number, p: Partial<RewardTier>) =>
    setTiers(tiers.map((t, i) => (i === idx ? { ...t, ...p } : t)));
  const changeTierType = (idx: number, type: RewardTierType) => {
    const t = tiers[idx];
    const title =
      !t.title || /^(\d+% de descuento|Corte (de cabello )?gratis|Premio especial)/i.test(t.title)
        ? type === 'discount'
          ? `${t.discountPercent || 20}% de descuento en tu próximo corte`
          : type === 'free'
          ? 'Corte de cabello gratis'
          : 'Premio especial'
        : t.title;
    updateTier(idx, { type, title, discountPercent: type === 'discount' ? t.discountPercent || 20 : undefined });
  };
  const addTier = () => {
    const last = tiers.reduce((m, t) => Math.max(m, Number(t.visits) || 0), 0);
    setTiers([...tiers, { visits: last + 5, type: 'custom', title: 'Premio especial' }]);
  };

  // ---------------------------------------------------------- barberos
  const barbers = form.barbers || [];
  const addBarber = () => {
    const name = newBarber.trim();
    if (!name || barbers.some(b => b.toLowerCase() === name.toLowerCase())) return;
    patch({ barbers: [...barbers, name] });
    setNewBarber('');
  };

  const toggleDay = (d: number) => {
    const days = form.workingDays.includes(d) ? form.workingDays.filter(x => x !== d) : [...form.workingDays, d];
    patch({ workingDays: days.sort((a, b) => a - b) });
  };

  // ---------------------------------------------------------- guardar
  const validate = (): string | null => {
    if (!form.barbershopName.trim()) return 'Escribe el nombre de la barbería.';
    const seen = new Set<number>();
    for (const t of tiers) {
      const v = Math.floor(Number(t.visits));
      if (!Number.isFinite(v) || v < 1) return 'Cada premio necesita un número de visitas mayor que 0.';
      if (v > 100) return 'El máximo es 100 visitas por premio.';
      if (seen.has(v)) return `Hay dos premios para las ${v} visitas. Cada nivel debe ser distinto.`;
      seen.add(v);
      if (t.type === 'discount') {
        const p = Number(t.discountPercent);
        if (!Number.isFinite(p) || p < 1 || p > 100) return 'El descuento debe estar entre 1% y 100%.';
      }
    }
    if (tiers.length === 0) return 'Agrega al menos un premio.';
    if (form.workingDays.length === 0) return 'Marca al menos un día de apertura.';
    if (form.openTime >= form.closeTime) return 'La hora de cierre debe ser posterior a la de apertura.';
    const url = form.googleAppsScriptUrl.trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
      return 'La URL de Google debe tener el formato https://script.google.com/macros/s/…/exec';
    }
    return null;
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const clean = withDerivedLoyaltyFields({
        ...form,
        googleAppsScriptUrl: form.googleAppsScriptUrl.trim(),
        apiKey: (form.apiKey || '').trim(),
        barbers: barbers.map(b => b.trim()).filter(Boolean),
        rewardTiers: normalizeTiers(tiers)
      });
      await onUpdateSettings(clean);
      setForm(clean);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTest(null);
    const url = form.googleAppsScriptUrl.trim() || envUrl;
    setTest(await api.pingUrl(url, form.apiKey));
    setTesting(false);
  };

  const handleUpload = async () => {
    setUploading(true);
    await onUploadInitialData();
    setUploading(false);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 3000);
    } catch {
      setShowCode(true);
    }
  };

  const statusLabel: Record<ConnectionStatus, { text: string; cls: string }> = {
    remote: { text: 'Conectado a Google Sheets', cls: 'text-emerald-300 bg-emerald-950/40 border-emerald-800/60' },
    local: { text: 'Modo local: aún sin enlazar Google Sheets', cls: 'text-amber-300 bg-amber-950/30 border-amber-800/50' },
    offline: { text: 'Sin conexión con Google Sheets (se reintentará)', cls: 'text-orange-300 bg-orange-950/30 border-orange-800/50' },
    unauthorized: { text: 'Clave de API incorrecta', cls: 'text-red-300 bg-red-950/40 border-red-800/60' }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4 sm:space-y-6 max-w-5xl pb-24 md:pb-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#14171d] p-4 sm:p-5 rounded-2xl border border-[#222631]">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide font-display">Ajustes</h2>
          <p className="text-xs text-slate-400 mt-1">Tu barbería, el programa de premios, la agenda y la conexión con Google Sheets.</p>
        </div>
        <button
          type="submit"
          disabled={saving || !dirty}
          className="hidden sm:flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 rounded-lg shadow-md shadow-amber-950/40 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Guardando…' : saved ? '¡Guardado! ✓' : 'Guardar cambios'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 bg-red-950/50 border border-red-800/60 rounded-xl text-red-200 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Conexión */}
      <Card icon={Database} title="1. Conexión con Google Sheets">
        <div className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${statusLabel[status].cls}`}>
          <span className="font-medium">{statusLabel[status].text}</span>
          {pendingCount > 0 && <span className="font-mono shrink-0">{pendingCount} por enviar</span>}
        </div>

        {envUrl && (
          <p className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3">
            Este sitio ya viene configurado con tu script (variable <code className="font-mono">VITE_APPS_SCRIPT_URL</code>). El
            campo de abajo es opcional y solo sirve para usar otra hoja.
          </p>
        )}

        <div>
          <label className="block text-slate-300 text-xs font-medium mb-1">URL de la aplicación web (termina en /exec)</label>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            placeholder="https://script.google.com/macros/s/AKfycb…/exec"
            value={form.googleAppsScriptUrl}
            onChange={e => patch({ googleAppsScriptUrl: e.target.value })}
            className={`${inputCls} font-mono text-xs`}
          />
        </div>

        <div>
          <label className="text-slate-300 text-xs font-medium mb-1 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-amber-500" /> Clave de administrador (API_KEY)
          </label>
          <input
            type="password"
            autoComplete="off"
            placeholder="La misma que guardaste en Apps Script"
            value={form.apiKey || ''}
            onChange={e => patch({ apiKey: e.target.value })}
            className={`${inputCls} font-mono`}
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Protege tus datos: sin la clave, solo se puede ver la tarjeta pública de cada cliente. Se guarda únicamente en este
            dispositivo.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || (!form.googleAppsScriptUrl.trim() && !envUrl)}
            className="px-4 py-3 bg-[#1e232e] hover:bg-[#272e3d] text-slate-200 border border-[#2d3444] rounded-lg text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Play className={`w-4 h-4 text-amber-400 ${testing ? 'animate-pulse' : ''}`} />
            <span>{testing ? 'Verificando…' : 'Probar conexión'}</span>
          </button>
        </div>

        {test && (
          <div
            className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
              test.success ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200' : 'bg-red-950/40 border-red-800/60 text-red-200'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span>{test.message}</span>
              <span className="font-mono text-[11px] text-slate-400 shrink-0">{test.durationMs} ms</span>
            </div>
            {test.counts && (
              <p className="text-[11px] text-slate-300 font-mono">
                En la hoja: {test.counts.clients} clientes · {test.counts.visits} visitas · {test.counts.appointments} citas ·{' '}
                {test.counts.services} servicios
              </p>
            )}
          </div>
        )}

        {needsInitialUpload && (
          <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-700/40 space-y-2.5">
            <p className="text-sm text-amber-100 font-semibold flex items-center gap-2">
              <CloudUpload className="w-4 h-4" /> Tu hoja está vacía y este dispositivo tiene datos
            </p>
            <p className="text-xs text-amber-200/80">
              Sube tus clientes, visitas y citas actuales a Google Sheets para no perderlos. Es un paso de una sola vez.
            </p>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="w-full sm:w-auto px-4 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg disabled:opacity-50"
            >
              {uploading ? 'Subiendo…' : 'Subir mis datos a Google Sheets'}
            </button>
          </div>
        )}
      </Card>

      {/* 2. Servicios */}
      <section className="bg-gradient-to-r from-[#171b24] to-[#14171e] p-4 sm:p-6 rounded-2xl border border-amber-500/30">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <Scissors className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white font-display">
                Servicios y tarifas{' '}
                {servicesCount > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800/60">
                    {servicesCount} activos
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-300 mt-1">
                Precio y duración de cada servicio. Se usan en la agenda, las visitas y la reserva online del cliente.
              </p>
            </div>
          </div>
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('services')}
              className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 rounded-xl shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              <span>Abrir servicios</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </section>

      {/* 3. Negocio */}
      <Card icon={Settings} title="2. Tu barbería">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Nombre</label>
            <input type="text" value={form.barbershopName} onChange={e => patch({ barbershopName: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">Teléfono / WhatsApp</label>
            <input
              type="tel"
              inputMode="tel"
              placeholder="+584121234567"
              value={form.barbershopPhone}
              onChange={e => patch({ barbershopPhone: e.target.value })}
              className={`${inputCls} font-mono`}
            />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">Moneda</label>
            <input type="text" maxLength={6} value={form.currency} onChange={e => patch({ currency: e.target.value })} className={`${inputCls} font-mono`} />
          </div>
        </div>

        <div className="text-xs">
          <label className="block text-slate-300 font-medium mb-1.5">Estilo de tarjeta por defecto</label>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            {(
              [
                ['obsidian', 'Obsidiana'],
                ['heritage', 'Tradicional']
              ] as const
            ).map(([id, name]) => (
              <button
                key={id}
                type="button"
                onClick={() => patch({ cardStyle: id })}
                className={`py-3 rounded-lg border font-semibold ${
                  form.cardStyle === id ? 'bg-amber-600/20 border-amber-500 text-amber-200' : 'bg-[#181a20] border-[#252834] text-slate-400'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* 4. Premios */}
      <Card icon={Gift} title="3. Programa de premios (tarjeta de fidelidad)">
        <p className="text-xs text-slate-400 leading-relaxed">
          Cada visita suma un sello. Define en qué visita se gana cada premio: por ejemplo{' '}
          <strong className="text-slate-200">5 cortes = 20% de descuento</strong> y{' '}
          <strong className="text-slate-200">10 cortes = corte gratis</strong>. El último nivel completa la tarjeta, que vuelve a
          empezar al canjearlo.
        </p>

        <div className="space-y-3">
          {tiers.map((t, idx) => (
            <div key={idx} className="p-3.5 rounded-xl bg-[#0e1014] border border-[#20242e] space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-[7rem_10rem_7rem_1fr] gap-3 items-end text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">En la visita nº</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={Number.isFinite(t.visits) ? t.visits : ''}
                    onChange={e => updateTier(idx, { visits: parseInt(e.target.value, 10) || 0 })}
                    className={`${inputCls} font-mono font-bold text-amber-400`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Tipo</label>
                  <select value={t.type} onChange={e => changeTierType(idx, e.target.value as RewardTierType)} className={inputCls}>
                    <option value="discount">Descuento %</option>
                    <option value="free">Servicio gratis</option>
                    <option value="custom">Otro premio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Descuento</label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      disabled={t.type !== 'discount'}
                      value={t.type === 'discount' ? t.discountPercent ?? '' : ''}
                      onChange={e => updateTier(idx, { discountPercent: parseInt(e.target.value, 10) || 0 })}
                      className={`${inputCls} font-mono pr-8 disabled:opacity-40`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">%</span>
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-slate-400 mb-1">Texto que verá el cliente</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={t.title}
                    onChange={e => updateTier(idx, { title: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500 truncate">
                  Vista: {describeTier({ ...t, visits: t.visits || 0 })}
                </p>
                <button
                  type="button"
                  onClick={() => setTiers(tiers.filter((_, i) => i !== idx))}
                  disabled={tiers.length <= 1}
                  className="px-3 py-2 text-[11px] text-red-300 bg-red-950/30 border border-red-900/40 rounded-lg flex items-center gap-1.5 disabled:opacity-30 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Quitar
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={addTier}
            className="px-4 py-3 text-xs font-semibold text-amber-300 bg-amber-950/30 border border-amber-600/40 rounded-lg flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Agregar premio
          </button>
          <button
            type="button"
            onClick={() => setTiers(DEFAULT_REWARD_TIERS.map(t => ({ ...t })))}
            className="px-4 py-3 text-xs text-slate-300 bg-[#181a20] border border-[#2a2f3a] rounded-lg"
          >
            Restaurar 5 → 20% · 10 → gratis
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          Si cambias los niveles, los clientes que ya canjearon un premio intermedio conservan su canje mientras el nivel siga
          existiendo con las mismas visitas.
        </p>
      </Card>

      {/* 5. Agenda */}
      <Card icon={Calendar} title="4. Agenda y reservas">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Apertura</label>
            <input type="time" value={form.openTime} onChange={e => patch({ openTime: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">Cierre</label>
            <input type="time" value={form.closeTime} onChange={e => patch({ closeTime: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">Turnos cada</label>
            <select value={form.slotMinutes} onChange={e => patch({ slotMinutes: parseInt(e.target.value, 10) })} className={inputCls}>
              {[15, 20, 30, 45, 60].map(m => (
                <option key={m} value={m}>
                  {m} minutos
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs">
          <label className="block text-slate-300 font-medium mb-1.5">Días que abres</label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={form.workingDays.includes(d)}
                className={`w-12 h-12 rounded-lg border font-semibold ${
                  form.workingDays.includes(d) ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-[#181a20] text-slate-500 border-[#252834]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs">
          <label className="block text-slate-300 font-medium mb-1.5">Barberos / sillones</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {barbers.map(b => (
              <span key={b} className="flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full bg-[#181a20] border border-[#2a2f3a] text-slate-200">
                {b}
                <button
                  type="button"
                  aria-label={`Quitar ${b}`}
                  onClick={() => patch({ barbers: barbers.filter(x => x !== b) })}
                  className="p-1.5 text-slate-500 hover:text-red-300"
                  data-compact
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
            {barbers.length === 0 && <span className="text-slate-500">Sin barberos: se asume 1 sillón.</span>}
          </div>
          <div className="flex gap-2 max-w-md">
            <input
              type="text"
              placeholder="Nombre del barbero"
              value={newBarber}
              onChange={e => setNewBarber(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addBarber();
                }
              }}
              className={inputCls}
            />
            <button type="button" onClick={addBarber} className="px-4 bg-[#1e232e] border border-[#2d3444] rounded-lg text-slate-200 text-xs font-semibold shrink-0">
              Agregar
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            La cantidad de barberos define cuántas citas pueden coincidir a la misma hora (en la reserva online y en la agenda).
          </p>
        </div>
      </Card>

      {/* 6. Plantillas */}
      <Card icon={MessageSquare} title="5. Mensajes de WhatsApp">
        <p className="text-xs text-slate-400">
          Variables: <code className="text-amber-400 font-mono">{'{{nombre}}'}</code>{' '}
          <code className="text-amber-400 font-mono">{'{{barberia}}'}</code>{' '}
          <code className="text-amber-400 font-mono">{'{{visitas}}'}</code>{' '}
          <code className="text-amber-400 font-mono">{'{{recompensa}}'}</code>{' '}
          <code className="text-amber-400 font-mono">{'{{dias_ausente}}'}</code>{' '}
          <code className="text-amber-400 font-mono">{'{{enlace_tarjeta}}'}</code>
        </p>
        <div className="space-y-3 text-xs">
          {TEMPLATE_FIELDS.map(f => (
            <div key={f.key}>
              <label className="block text-slate-300 font-medium mb-1">{f.label}</label>
              <textarea
                rows={2}
                value={(form[f.key] as string) || ''}
                onChange={e => patch({ [f.key]: e.target.value } as Partial<CRMSettings>)}
                className="w-full p-3 bg-[#0e1014] border border-[#282d3b] rounded-lg text-white text-sm focus:outline-none focus:border-amber-500"
              />
              {f.hint && <p className="text-[10px] text-slate-500 mt-0.5">{f.hint}</p>}
            </div>
          ))}
        </div>
      </Card>

      {/* 7. Datos */}
      <Card icon={FlaskConical} title="6. Datos de prueba">
        <p className="text-xs text-slate-400">
          Carga clientes y visitas de ejemplo para probar el sistema, y bórralos cuando estés listo para trabajar con datos reales.
          Esto solo afecta a este dispositivo; si ya estás conectado a Google Sheets, no toca tu hoja.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onLoadDemoData}
            disabled={hasBusinessData}
            title={hasBusinessData ? 'Ya hay datos: bórralos primero' : ''}
            className="px-4 py-3 text-xs font-semibold text-slate-200 bg-[#1e232e] border border-[#2d3444] rounded-lg disabled:opacity-40"
          >
            Cargar datos de ejemplo
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={!hasBusinessData}
            className="px-4 py-3 text-xs font-semibold text-red-300 bg-red-950/30 border border-red-900/40 rounded-lg disabled:opacity-40"
          >
            Borrar clientes, visitas y citas de este dispositivo
          </button>
        </div>
      </Card>

      {/* 8. Backend */}
      <Card icon={Code} title="7. Código de Google Apps Script (Code.gs)">
        <p className="text-xs text-slate-400">
          Copia este código en tu proyecto de Apps Script y sigue los pasos. La guía completa está en el archivo{' '}
          <code className="text-amber-400 font-mono">GUIA_DESPLIEGUE.md</code>.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={copyCode}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs"
          >
            {codeCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{codeCopied ? '¡Código copiado!' : 'Copiar Code.gs'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCode(v => !v)}
            className="px-4 py-3 text-xs text-slate-300 bg-[#181a20] border border-[#2a2f3a] rounded-lg"
          >
            {showCode ? 'Ocultar código' : 'Ver código'}
          </button>
        </div>

        {showCode && (
          <pre className="max-h-80 overflow-auto p-3 bg-[#0b0c0f] border border-[#20242e] rounded-lg text-[11px] leading-snug text-slate-300 font-mono whitespace-pre">
            {GOOGLE_APPS_SCRIPT_CODE}
          </pre>
        )}

        <div className="space-y-2.5">
          {SETUP_INSTRUCTIONS.map(inst => (
            <div key={inst.step} className="p-3 bg-[#0e1014] rounded-xl border border-[#20242e] flex items-start gap-3 text-xs">
              <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold text-[11px] shrink-0">
                {inst.step}
              </span>
              <div>
                <p className="font-semibold text-slate-200">{inst.title}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{inst.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
            Hojas que se crean solas ({SHEETS_STRUCTURE.length})
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
            {SHEETS_STRUCTURE.map(s => (
              <div key={s.name} className="p-3 bg-[#101217] rounded-xl border border-[#20242e]">
                <p className="font-bold text-amber-400 font-mono text-[11px]">{s.name}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{s.description}</p>
                <p className="text-[9px] text-slate-500 font-mono mt-1.5 break-words">{s.columns.join(', ')}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 bg-[#111317] rounded-xl border border-amber-500/20 text-xs space-y-2">
          <p className="font-bold text-amber-300 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
            <Shield className="w-4 h-4" /> Seguridad y privacidad
          </p>
          <ul className="list-disc list-inside text-slate-400 space-y-1 text-[11px] leading-relaxed">
            <li>Con la clave de administrador activa, solo quien la tenga puede leer o cambiar clientes, visitas y citas.</li>
            <li>La tarjeta pública solo muestra nombre, sellos y premios; nunca teléfono, gastos ni historial.</li>
            <li>Las reservas online se validan en el servidor (día, horario y cupo) y tienen límite anti-abuso.</li>
            <li>Las visitas usan llave de idempotencia: un reintento por mala señal no suma el sello dos veces.</li>
          </ul>
        </div>
      </Card>

      {/* Barra de guardado fija en móvil */}
      <div className="sm:hidden fixed left-0 right-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 px-3 pb-2 pt-2 bg-gradient-to-t from-[#0b0c0e] via-[#0b0c0e]/95 to-transparent pointer-events-none">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="pointer-events-auto w-full flex items-center justify-center gap-2 py-3.5 text-sm font-semibold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 rounded-xl shadow-xl shadow-black/50 disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Guardando…' : saved ? '¡Guardado! ✓' : dirty ? 'Guardar cambios' : 'Sin cambios'}</span>
        </button>
      </div>

      {confirmClear && (
        <Modal isOpen onClose={() => setConfirmClear(false)} title="Borrar datos de este dispositivo" maxWidth="sm">
          <div className="space-y-4 text-xs">
            <p className="text-slate-300">
              Se borrarán los clientes, visitas, citas, seguimientos y canjes guardados en este dispositivo. Tus servicios y ajustes se
              conservan.
            </p>
            <p className="text-amber-300">Si usas Google Sheets, tu hoja no se modifica, pero la próxima sincronización volverá a traer sus datos.</p>
            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button type="button" onClick={() => setConfirmClear(false)} className="px-3 py-2 text-slate-400">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearBusinessData();
                  setConfirmClear(false);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg"
              >
                Sí, borrar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </form>
  );
};
