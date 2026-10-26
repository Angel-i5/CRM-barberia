import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Gift } from 'lucide-react';
import { BarberService, Client, CRMSettings, RewardTier, Visit } from '../types';
import { Modal } from './Modal';
import { formatCurrency, generateId, nowHM, todayYMD } from '../utils/formatters';
import { applyTierToAmount, describeTier, getTiers, getUnlockedTiers, tierShortLabel } from '../utils/loyalty';
import { INITIAL_SERVICES } from '../services/storage';

interface VisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  services: BarberService[];
  settings: CRMSettings;
  /** Si se pasa, el modal edita esa visita (el cliente no se puede cambiar). */
  editingVisit?: Visit | null;
  initialClientId?: string;
  onRegisterVisit: (
    visit: Omit<Visit, 'id'>,
    redeemTier?: RewardTier
  ) => Promise<{ success: boolean; error?: string }>;
  onUpdateVisit: (visit: Visit) => Promise<boolean>;
}

const inputCls =
  'w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white text-sm focus:outline-none';

/**
 * Registro / edición de una visita. Lo usan el botón (+) global y la página Visitas.
 * Permite aplicar un premio desbloqueado (descuento o corte gratis) al cobrar.
 */
export const VisitModal: React.FC<VisitModalProps> = ({
  isOpen,
  onClose,
  clients,
  services,
  settings,
  editingVisit,
  initialClientId,
  onRegisterVisit,
  onUpdateVisit
}) => {
  const activeClients = useMemo(
    () => clients.filter(c => c.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name)),
    [clients]
  );

  const catalog = useMemo(() => {
    const active = services.filter(s => s.isActive);
    return active.length > 0 ? active : INITIAL_SERVICES.filter(s => s.isActive);
  }, [services]);

  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState(todayYMD());
  const [time, setTime] = useState(nowHM());
  const [serviceName, setServiceName] = useState('');
  const [baseAmount, setBaseAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [tierVisits, setTierVisits] = useState<number | ''>('');
  const [idemKey, setIdemKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Se reinicia el formulario cada vez que se abre.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSaving(false);
    setTierVisits('');
    if (editingVisit) {
      setClientId(editingVisit.clientId);
      setDate(editingVisit.date);
      setTime(editingVisit.time);
      setServiceName(editingVisit.service);
      setBaseAmount(editingVisit.amount);
      setNotes(editingVisit.notes || '');
      setIdemKey(editingVisit.idempotencyKey || '');
    } else {
      const first = catalog[0];
      setClientId(initialClientId || '');
      setDate(todayYMD());
      setTime(nowHM());
      setServiceName(first ? first.name : '');
      setBaseAmount(first ? first.price : 0);
      setNotes('');
      setIdemKey(generateId('idem'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingVisit?.id, initialClientId]);

  const client = clients.find(c => c.id === clientId) || null;
  const unlocked = client && !editingVisit ? getUnlockedTiers(client, settings) : [];
  const tiers = getTiers(settings);
  const selectedTier = unlocked.find(t => t.visits === tierVisits) || null;
  const finalAmount = applyTierToAmount(baseAmount, selectedTier);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!client) return setError('Selecciona un cliente.');
    if (!serviceName.trim()) return setError('Indica el servicio realizado.');
    if (!Number.isFinite(Number(baseAmount)) || Number(baseAmount) < 0) return setError('Importe no válido.');
    if (!date) return setError('Indica la fecha.');

    setSaving(true);
    try {
      if (editingVisit) {
        await onUpdateVisit({
          ...editingVisit,
          date,
          time,
          service: serviceName.trim(),
          amount: Number(baseAmount),
          notes: notes.trim()
        });
        onClose();
        return;
      }

      const note = [notes.trim(), selectedTier ? `Premio aplicado: ${selectedTier.title}.` : '']
        .filter(Boolean)
        .join(' ');
      const res = await onRegisterVisit(
        {
          idempotencyKey: idemKey,
          clientId: client.id,
          clientName: client.name,
          clientPhone: client.phone,
          date,
          time,
          service: serviceName.trim(),
          amount: finalAmount,
          notes: note,
          createdAt: new Date().toISOString()
        },
        selectedTier || undefined
      );
      if (!res.success) setError(res.error || 'No se pudo registrar la visita.');
      else onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingVisit ? 'Corregir visita' : 'Registrar visita'}
      subtitle={editingVisit ? undefined : 'Cada visita suma un sello en la tarjeta del cliente'}
      maxWidth="lg"
    >
      <form onSubmit={submit} className="space-y-4 text-xs">
        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800/60 rounded-xl text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-slate-300 font-medium mb-1">Cliente *</label>
          <select
            required
            disabled={!!editingVisit}
            value={clientId}
            onChange={e => {
              setClientId(e.target.value);
              setTierVisits('');
            }}
            className={`${inputCls} disabled:opacity-60`}
          >
            <option value="">— Selecciona un cliente —</option>
            {activeClients.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.cycleVisits}/{settings.loyaltyTargetVisits} sellos
              </option>
            ))}
          </select>
          {editingVisit && (
            <p className="text-[10px] text-slate-500 mt-1">
              Para cambiar de cliente, elimina la visita y regístrala de nuevo.
            </p>
          )}
        </div>

        {/* Premios desbloqueados */}
        {unlocked.length > 0 && (
          <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-700/40 space-y-2">
            <p className="flex items-center gap-1.5 font-semibold text-emerald-300">
              <Gift className="w-4 h-4" /> {client?.name.split(' ')[0]} tiene premio disponible
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTierVisits('')}
                className={`px-3 py-2 rounded-lg border text-[11px] font-semibold ${
                  tierVisits === ''
                    ? 'bg-slate-200 text-slate-900 border-slate-200'
                    : 'bg-[#181a20] text-slate-300 border-[#2a2f3a]'
                }`}
              >
                No aplicar
              </button>
              {unlocked.map(t => (
                <button
                  key={t.visits}
                  type="button"
                  onClick={() => setTierVisits(t.visits)}
                  className={`px-3 py-2 rounded-lg border text-[11px] font-semibold text-left ${
                    tierVisits === t.visits
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-[#181a20] text-emerald-300 border-emerald-700/50'
                  }`}
                >
                  {tierShortLabel(t)} · {t.title}
                </button>
              ))}
            </div>
            {selectedTier && (
              <p className="text-[11px] text-emerald-200/90">
                Total a cobrar:{' '}
                <span className="font-mono font-bold text-white">
                  {formatCurrency(finalAmount, settings.currency)}
                </span>{' '}
                <span className="text-slate-400 line-through">{formatCurrency(baseAmount, settings.currency)}</span>
                {selectedTier.type === 'custom' && ' (premio manual: ajusta el importe si hace falta)'}
              </p>
            )}
          </div>
        )}

        {/* Servicios del catálogo */}
        <div>
          <label className="block text-slate-300 font-medium mb-1.5">Servicio</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {catalog.slice(0, 9).map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setServiceName(s.name);
                  setBaseAmount(s.price);
                }}
                className={`p-2.5 rounded-lg text-left border transition-colors ${
                  serviceName === s.name
                    ? 'bg-amber-600/20 border-amber-500/60 text-amber-200'
                    : 'bg-[#181a20] border-[#252934] text-slate-300'
                }`}
              >
                <p className="font-semibold text-[11px] truncate">{s.name}</p>
                <p className="text-[10px] text-amber-400/90 font-mono mt-0.5">
                  {formatCurrency(s.price, settings.currency)}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Nombre del servicio *</label>
            <input
              type="text"
              required
              value={serviceName}
              onChange={e => setServiceName(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">Precio ({settings.currency}) *</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              required
              value={baseAmount}
              onChange={e => setBaseAmount(parseFloat(e.target.value) || 0)}
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Fecha</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">Hora</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">Notas (opcional)</label>
          <textarea
            rows={2}
            placeholder="Productos aplicados, preferencias, recomendaciones…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className={`${inputCls} resize-none`}
          />
        </div>

        {!editingVisit && client && (
          <p className="text-[11px] text-slate-500">
            {(() => {
              const next = tiers.find(t => t.visits > client.cycleVisits + 1 - 1 && !unlocked.includes(t));
              const after = client.cycleVisits + 1;
              const hit = tiers.find(t => t.visits === after);
              if (hit) return `🎁 Con esta visita desbloquea: ${describeTier(hit)}`;
              return next
                ? `Con esta visita llevará ${after}/${settings.loyaltyTargetVisits} sellos. Próximo premio a las ${next.visits}.`
                : `Con esta visita llevará ${after}/${settings.loyaltyTargetVisits} sellos.`;
            })()}
          </p>
        )}

        <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Guardando…' : editingVisit ? 'Actualizar' : 'Confirmar visita'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
