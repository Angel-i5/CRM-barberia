import React, { useState, useMemo } from 'react';
import {
  Scissors,
  Plus,
  Search,
  Clock,
  Edit2,
  Trash2,
  Check,
  X,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { BarberService, CRMSettings, ServiceCategory } from '../types';
import { formatCurrency } from '../utils/formatters';
import { Modal } from '../components/Modal';

interface ServicesPageProps {
  services: BarberService[];
  settings: CRMSettings;
  onSaveService: (service: BarberService) => Promise<BarberService>;
  onDeleteService: (serviceId: string) => Promise<boolean>;
  onToggleActive: (serviceId: string) => Promise<boolean>;
  onResetDefaults: () => Promise<void>;
}

const CATEGORY_LABELS: Record<ServiceCategory, { label: string; color: string; border: string }> = {
  corte: { label: 'Corte', color: 'bg-blue-950/70 text-blue-300', border: 'border-blue-800/50' },
  barba: { label: 'Barba & Ritual', color: 'bg-amber-950/70 text-amber-300', border: 'border-amber-800/50' },
  combo: { label: 'Combo Completo', color: 'bg-purple-950/70 text-purple-300', border: 'border-purple-800/50' },
  tratamiento: { label: 'Tratamiento / Color', color: 'bg-emerald-950/70 text-emerald-300', border: 'border-emerald-800/50' },
  otro: { label: 'Otros Servicios', color: 'bg-slate-800/70 text-slate-300', border: 'border-slate-700/50' }
};

const COMMON_DURATIONS = [15, 20, 30, 40, 45, 60, 90];

const inputCls =
  'w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/60';

const StatusPill: React.FC<{ active: boolean; onClick: () => void }> = ({ active, onClick }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-semibold border transition-all shrink-0 ${
      active
        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
        : 'bg-slate-800/60 text-slate-400 border-slate-700/60'
    }`}
    title={active ? 'Toca para pausar' : 'Toca para activar'}
  >
    <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
    <span>{active ? 'Activo' : 'Pausado'}</span>
  </button>
);

export const ServicesPage: React.FC<ServicesPageProps> = ({
  services,
  settings,
  onSaveService,
  onDeleteService,
  onToggleActive,
  onResetDefaults
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [onlyActive, setOnlyActive] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<BarberService | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const emptyForm = {
    name: '',
    price: 20,
    durationMinutes: 30,
    category: 'corte' as ServiceCategory,
    description: '',
    isActive: true
  };
  const [formData, setFormData] = useState<typeof emptyForm>(emptyForm);

  const filteredServices = useMemo(() => {
    return services.filter(service => {
      if (selectedCategory !== 'all' && service.category !== selectedCategory) return false;
      if (onlyActive && !service.isActive) return false;
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        return (
          service.name.toLowerCase().includes(q) ||
          (service.description || '').toLowerCase().includes(q) ||
          (CATEGORY_LABELS[service.category]?.label || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [services, selectedCategory, onlyActive, searchQuery]);

  const metrics = useMemo(() => {
    const active = services.filter(s => s.isActive);
    const n = active.length;
    return {
      total: services.length,
      activeCount: n,
      avgPrice: n > 0 ? active.reduce((a, s) => a + s.price, 0) / n : 0,
      avgDuration: n > 0 ? Math.round(active.reduce((a, s) => a + s.durationMinutes, 0) / n) : 0
    };
  }, [services]);

  const openCreate = () => {
    setEditingService(null);
    setFormError(null);
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const openEdit = (service: BarberService) => {
    setEditingService(service);
    setFormError(null);
    setFormData({
      name: service.name,
      price: service.price,
      durationMinutes: service.durationMinutes,
      category: service.category,
      description: service.description || '',
      isActive: service.isActive
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return setFormError('Por favor ingresa el nombre del servicio.');
    if (formData.price < 0) return setFormError('El precio no puede ser negativo.');
    if (formData.durationMinutes <= 0) return setFormError('La duración debe ser mayor a 0 minutos.');

    setIsSubmitting(true);
    setFormError(null);
    try {
      await onSaveService({
        id: editingService ? editingService.id : '',
        name: formData.name.trim(),
        price: Number(formData.price),
        durationMinutes: Number(formData.durationMinutes),
        category: formData.category,
        description: formData.description.trim(),
        isActive: formData.isActive
      });
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'Error al guardar el servicio');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTargetId) return;
    setIsSubmitting(true);
    try {
      await onDeleteService(deleteTargetId);
      setDeleteTargetId(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReset = async () => {
    setIsSubmitting(true);
    try {
      await onResetDefaults();
      setIsResetConfirmOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasFilters = searchQuery || selectedCategory !== 'all' || onlyActive;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <div className="bg-[#14171d] border border-[#222631] rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Scissors className="w-5 h-5" />
              </div>
              <h1 className="text-lg sm:text-2xl font-bold text-white tracking-wide font-display">Servicios y tarifas</h1>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl">
              Precio y duración de cada servicio. Se usan al agendar citas, al registrar visitas y en la reserva online del cliente.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsResetConfirmOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-400 hover:text-white bg-[#0e1014] border border-[#282d3b] rounded-xl"
              title="Restablecer servicios recomendados"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Valores por defecto</span>
            </button>
            <button
              onClick={openCreate}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 rounded-xl shadow-lg shadow-amber-500/20 active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>Añadir servicio</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-[#1e222c]">
          <div className="bg-[#0e1014] p-3 rounded-xl border border-[#20242e]">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Activos</span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-400">{metrics.activeCount}</span>
              <span className="text-[11px] text-slate-500 font-mono">/ {metrics.total}</span>
            </div>
          </div>
          <div className="bg-[#0e1014] p-3 rounded-xl border border-[#20242e]">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Precio promedio</span>
            <div className="mt-1 text-xl sm:text-2xl font-bold font-mono text-amber-300">
              {formatCurrency(metrics.avgPrice, settings.currency)}
            </div>
          </div>
          <div className="bg-[#0e1014] p-3 rounded-xl border border-[#20242e]">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Tiempo promedio</span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-xl sm:text-2xl font-bold font-mono text-sky-400">{metrics.avgDuration}</span>
              <span className="text-[11px] text-slate-500">min</span>
            </div>
          </div>
          <div className="bg-[#0e1014] p-3 rounded-xl border border-[#20242e]">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Moneda</span>
            <div className="mt-1 text-xl sm:text-2xl font-bold font-mono text-white">{settings.currency}</div>
          </div>
        </div>
      </div>

      <div className="bg-[#14171d] border border-[#222631] rounded-2xl p-3 sm:p-5 space-y-3 shadow-lg">
        <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Buscar servicio…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 bg-[#0e1014] border border-[#282d3b] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
                data-compact
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={() => setOnlyActive(prev => !prev)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border self-start md:self-auto shrink-0 ${
              onlyActive ? 'bg-amber-950/40 text-amber-300 border-amber-800/60' : 'bg-[#0e1014] text-slate-400 border-[#282d3b]'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                onlyActive ? 'bg-amber-400 border-amber-300' : 'border-slate-500'
              }`}
            >
              {onlyActive && <Check className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />}
            </div>
            <span>Solo activos</span>
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
          {(['all', 'corte', 'barba', 'combo', 'tratamiento', 'otro'] as const).map(cat => {
            const count = cat === 'all' ? services.length : services.filter(s => s.category === cat).length;
            const selected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-2 rounded-lg font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  selected
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'bg-[#0e1014] text-slate-400 border border-[#252a36]'
                }`}
              >
                <span>{cat === 'all' ? 'Todos' : CATEGORY_LABELS[cat].label}</span>
                <span className="text-[10px] opacity-75 font-mono">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-[#14171d] border border-[#222631] rounded-2xl overflow-hidden shadow-xl">
        {filteredServices.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#1e222c] flex items-center justify-center mx-auto text-slate-500">
              <Scissors className="w-6 h-6" />
            </div>
            <h4 className="text-base font-semibold text-white">No se encontraron servicios</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {hasFilters ? 'Prueba con otros filtros.' : 'Añade tu primer servicio con el botón "Añadir servicio".'}
            </p>
            {hasFilters && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setOnlyActive(false);
                }}
                className="px-4 py-2.5 text-xs font-medium text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-lg"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#101217] text-slate-400 border-b border-[#222631] font-mono text-[11px] uppercase tracking-wider">
                    <th className="py-3.5 px-4">Servicio</th>
                    <th className="py-3.5 px-4">Categoría</th>
                    <th className="py-3.5 px-4">Duración</th>
                    <th className="py-3.5 px-4">Precio</th>
                    <th className="py-3.5 px-4 text-center">Estado</th>
                    <th className="py-3.5 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e222c]">
                  {filteredServices.map(service => {
                    const cat = CATEGORY_LABELS[service.category] || CATEGORY_LABELS.otro;
                    return (
                      <tr key={service.id} className={`hover:bg-[#1a1e27] ${!service.isActive ? 'opacity-60' : ''}`}>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-white text-sm">{service.name}</div>
                          {service.description ? (
                            <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5 max-w-md">{service.description}</p>
                          ) : (
                            <span className="text-[10px] text-slate-500 italic">Sin descripción</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-medium border ${cat.color} ${cat.border}`}>
                            {cat.label}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-sky-300 font-mono text-xs">
                            <Clock className="w-3.5 h-3.5 text-sky-400" />
                            {service.durationMinutes} min
                          </span>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-sm font-bold font-mono text-amber-400">
                          {formatCurrency(service.price, settings.currency)}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <StatusPill active={service.isActive} onClick={() => onToggleActive(service.id)} />
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => openEdit(service)}
                            className="p-2 text-slate-400 hover:text-amber-400 rounded-lg"
                            aria-label="Editar servicio"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTargetId(service.id)}
                            className="p-2 text-slate-400 hover:text-red-400 rounded-lg"
                            aria-label="Eliminar servicio"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-[#1e222c]">
              {filteredServices.map(service => {
                const cat = CATEGORY_LABELS[service.category] || CATEGORY_LABELS.otro;
                return (
                  <div key={service.id} className={`p-4 space-y-3 ${!service.isActive ? 'opacity-65 bg-[#0e1014]/40' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <span className="font-semibold text-white text-sm block">{service.name}</span>
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${cat.color} ${cat.border}`}>
                          {cat.label}
                        </span>
                      </div>
                      <StatusPill active={service.isActive} onClick={() => onToggleActive(service.id)} />
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 bg-[#0e1014] px-3 py-1.5 rounded-xl border border-[#282d3b]">
                        <span className="text-sm font-bold font-mono text-amber-400">
                          {formatCurrency(service.price, settings.currency)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-[#0e1014] px-3 py-1.5 rounded-xl border border-[#282d3b]">
                        <Clock className="w-3.5 h-3.5 text-sky-400" />
                        <span className="text-xs font-mono text-sky-300">{service.durationMinutes} min</span>
                      </div>
                    </div>

                    {service.description && <p className="text-xs text-slate-400 leading-relaxed">{service.description}</p>}

                    <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#1e222c]/80">
                      <button
                        onClick={() => openEdit(service)}
                        className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Editar</span>
                      </button>
                      <button
                        onClick={() => setDeleteTargetId(service.id)}
                        className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {isModalOpen && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={editingService ? 'Editar servicio' : 'Nuevo servicio'}
          subtitle={editingService ? 'Modifica precio, duración o detalles' : 'Configura un corte, arreglo o combo'}
          maxWidth="lg"
        >
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {formError && (
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-medium mb-1">Nombre del servicio *</label>
              <input
                type="text"
                required
                placeholder="Ej. Skin Fade + Diseño"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Categoría *</label>
              <select
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value as ServiceCategory })}
                className={inputCls}
              >
                <option value="corte">Cortes de cabello</option>
                <option value="barba">Barba y afeitado ritual</option>
                <option value="combo">Combos (corte + barba)</option>
                <option value="tratamiento">Tratamiento / coloración / facial</option>
                <option value="otro">Otros servicios</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Precio ({settings.currency}) *</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0"
                  required
                  value={formData.price}
                  onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                  className={`${inputCls} font-mono`}
                />
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {[10, 15, 20, 25, 30, 35].map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFormData({ ...formData, price: p })}
                      className={`px-2.5 py-1.5 rounded text-[11px] font-mono ${
                        formData.price === p ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#181c24] text-slate-400'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Duración (minutos) *</label>
                <input
                  type="number"
                  inputMode="numeric"
                  step="5"
                  min="5"
                  max="300"
                  required
                  value={formData.durationMinutes}
                  onChange={e => setFormData({ ...formData, durationMinutes: parseInt(e.target.value, 10) || 30 })}
                  className={`${inputCls} font-mono`}
                />
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {COMMON_DURATIONS.map(dur => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => setFormData({ ...formData, durationMinutes: dur })}
                      className={`px-2.5 py-1.5 rounded text-[11px] font-mono ${
                        formData.durationMinutes === dur ? 'bg-sky-500 text-slate-950 font-bold' : 'bg-[#181c24] text-slate-400'
                      }`}
                    >
                      {dur}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Descripción / qué incluye</label>
              <textarea
                rows={2}
                placeholder="Ej. Lavado, corte a tijera o máquina, toalla caliente…"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className={`${inputCls} resize-none`}
              />
            </div>

            <div className="bg-[#0e1014] p-3 rounded-xl border border-[#252936] flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-semibold text-white block">Servicio activo</span>
                <span className="text-[11px] text-slate-400">Si está activo, aparece al agendar, registrar visitas y reservar online.</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={formData.isActive}
                data-compact
                onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  formData.isActive ? 'bg-emerald-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition ${
                    formData.isActive ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2.5 text-slate-400 hover:text-white">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 font-semibold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg disabled:opacity-50"
              >
                {isSubmitting ? 'Guardando…' : editingService ? 'Guardar cambios' : 'Crear servicio'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTargetId && (
        <Modal isOpen onClose={() => setDeleteTargetId(null)} title="Eliminar servicio" maxWidth="sm">
          <div className="space-y-4 text-xs">
            <p className="text-slate-300 leading-relaxed">
              Las visitas y citas ya registradas no se ven afectadas, pero este servicio dejará de estar disponible para nuevas reservas.
            </p>
            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button type="button" onClick={() => setDeleteTargetId(null)} className="px-4 py-2.5 text-slate-400">
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleDelete}
                className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg disabled:opacity-50"
              >
                {isSubmitting ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {isResetConfirmOpen && (
        <Modal isOpen onClose={() => setIsResetConfirmOpen(false)} title="Restablecer servicios" maxWidth="md">
          <div className="space-y-4 text-xs">
            <p className="text-slate-300 leading-relaxed">
              Se restaura el catálogo con los servicios clásicos de barbería y sus precios y tiempos recomendados.
            </p>
            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button type="button" onClick={() => setIsResetConfirmOpen(false)} className="px-4 py-2.5 text-slate-400">
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmReset}
                className="px-5 py-2.5 bg-amber-500 text-slate-950 font-semibold rounded-lg disabled:opacity-50"
              >
                {isSubmitting ? 'Restableciendo…' : 'Restablecer catálogo'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
