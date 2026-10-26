import React, { useState, useMemo } from 'react';
import { Scissors, Search, Edit2, Trash2 } from 'lucide-react';
import { Visit, Client, CRMSettings, BarberService, RewardTier } from '../types';
import { formatCurrency, formatDate } from '../utils/formatters';
import { Modal } from '../components/Modal';
import { VisitModal } from '../components/VisitModal';

interface VisitsPageProps {
  visits: Visit[];
  clients: Client[];
  settings: CRMSettings;
  services?: BarberService[];
  onRegisterVisit: (
    visit: Omit<Visit, 'id'>,
    redeemTier?: RewardTier
  ) => Promise<{ success: boolean; visit?: Visit; error?: string }>;
  onUpdateVisit: (visit: Visit) => Promise<boolean>;
  onDeleteVisit: (visitId: string) => Promise<boolean>;
}

const PAGE_SIZE = 50;

export const VisitsPage: React.FC<VisitsPageProps> = ({
  visits,
  clients,
  settings,
  services = [],
  onRegisterVisit,
  onUpdateVisit,
  onDeleteVisit
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Visit | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return [...visits]
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
      .filter(
        v =>
          !q ||
          v.clientName.toLowerCase().includes(q) ||
          v.service.toLowerCase().includes(q) ||
          v.clientPhone.includes(q) ||
          v.date.includes(q)
      );
  }, [visits, searchQuery]);

  const shown = filtered.slice(0, limit);
  const total = filtered.reduce((s, v) => s + (Number(v.amount) || 0), 0);

  const openNew = () => {
    setEditingVisit(null);
    setModalOpen(true);
  };
  const openEdit = (v: Visit) => {
    setEditingVisit(v);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    await onDeleteVisit(id);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#14171d] p-4 sm:p-5 rounded-2xl border border-[#222631]">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide font-display">Visitas y servicios</h2>
          <p className="text-xs text-slate-400 mt-1">
            Cada visita suma un sello en la tarjeta del cliente y alimenta los ingresos del panel.
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded-lg shadow-md shadow-amber-950/40"
        >
          <Scissors className="w-4 h-4" />
          <span>Registrar visita</span>
        </button>
      </div>

      <div className="bg-[#14171d] p-3 sm:p-4 rounded-xl border border-[#222631] space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            placeholder="Cliente, servicio, fecha o teléfono…"
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            className="w-full pl-10 pr-4 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none"
          />
        </div>
        <p className="text-[11px] text-slate-500 px-1">
          {filtered.length} visita{filtered.length === 1 ? '' : 's'} · Total{' '}
          <span className="text-amber-400 font-mono">{formatCurrency(total, settings.currency)}</span>
        </p>
      </div>

      <div className="bg-[#14171d] rounded-2xl border border-[#222631] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Scissors className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-300">No hay visitas registradas</p>
            <p className="text-xs text-slate-500 mt-1">Registra una para que el cliente acumule sellos.</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#101217] text-slate-400 border-b border-[#222631] font-mono text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-4">Servicio</th>
                    <th className="py-3 px-4">Importe</th>
                    <th className="py-3 px-4">Notas</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e222c]">
                  {shown.map(v => (
                    <tr key={v.id} className="hover:bg-[#181b24]">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <p className="font-semibold text-slate-200">{formatDate(v.date)}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{v.time}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-100">{v.clientName}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{v.clientPhone}</p>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-200">{v.service}</td>
                      <td className="py-3 px-4 font-bold text-amber-400 text-sm">
                        {formatCurrency(v.amount, settings.currency)}
                      </td>
                      <td className="py-3 px-4 max-w-xs truncate text-slate-400">{v.notes || '—'}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(v)}
                            aria-label="Corregir visita"
                            title="Corregir"
                            className="p-2 text-slate-400 hover:text-white hover:bg-[#202532] rounded"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(v)}
                            aria-label="Eliminar visita"
                            title="Eliminar"
                            className="p-2 text-red-400/80 hover:text-red-300 hover:bg-red-950/40 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-[#1e222c]">
              {shown.map(v => (
                <div key={v.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-sm truncate">{v.clientName}</h4>
                      <p className="text-[11px] text-slate-400 font-mono">{v.clientPhone}</p>
                    </div>
                    <span className="font-bold text-amber-400 text-sm font-mono shrink-0">
                      {formatCurrency(v.amount, settings.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
                    <span className="font-medium flex items-center gap-1.5 min-w-0">
                      <Scissors className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="truncate">{v.service}</span>
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono shrink-0">
                      {formatDate(v.date)} · {v.time}
                    </span>
                  </div>
                  {v.notes && (
                    <p className="text-[11px] text-slate-400 italic bg-[#0f1116] p-2 rounded-lg border border-[#1e222c]">
                      “{v.notes}”
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#1a1d25]">
                    <button
                      onClick={() => openEdit(v)}
                      className="px-3 py-2 text-xs text-slate-300 bg-[#171a22] border border-[#272b38] rounded-md flex items-center gap-1.5"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Editar</span>
                    </button>
                    <button
                      onClick={() => setDeleteTarget(v)}
                      className="px-3 py-2 text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded-md flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {filtered.length > limit && (
              <button
                onClick={() => setLimit(l => l + PAGE_SIZE)}
                className="w-full py-3 text-xs font-medium text-amber-300 border-t border-[#1e222c] hover:bg-[#181b24]"
              >
                Mostrar más ({filtered.length - limit} restantes)
              </button>
            )}
          </>
        )}
      </div>

      <VisitModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        clients={clients}
        services={services}
        settings={settings}
        editingVisit={editingVisit}
        onRegisterVisit={onRegisterVisit}
        onUpdateVisit={onUpdateVisit}
      />

      {deleteTarget && (
        <Modal isOpen onClose={() => setDeleteTarget(null)} title="Eliminar visita" maxWidth="sm">
          <div className="space-y-4 text-xs">
            <p className="text-slate-300">
              ¿Eliminar la visita de <strong className="text-white">{deleteTarget.clientName}</strong> ({deleteTarget.service},{' '}
              {formatDate(deleteTarget.date)})?
            </p>
            <p className="text-slate-500">
              Se descuenta el sello y el importe del cliente. Los premios ya canjeados no se revierten.
            </p>
            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="px-3 py-2 text-slate-400 hover:text-white">
                Cancelar
              </button>
              <button onClick={confirmDelete} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg">
                Eliminar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
