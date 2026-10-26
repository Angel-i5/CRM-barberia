import React, { useState, useEffect, useRef } from 'react';
import {
  CreditCard,
  Download,
  Share2,
  Check,
  Send,
  User,
  Layers,
  ExternalLink,
  Copy,
  Globe,
  AlertTriangle,
  Gift
} from 'lucide-react';
import { Client, CRMSettings, FollowUpRecord } from '../types';
import { renderLoyaltyCard, downloadCardAsPng } from '../utils/cardGenerator';
import {
  buildWhatsAppLink,
  compileTemplate,
  getClientCardUrl,
  getEnvScriptUrl,
  openExternalUrl
} from '../utils/formatters';
import { getUnlockedTiers, describeTier, getTiers } from '../utils/loyalty';
import { Modal } from '../components/Modal';

interface CardsPageProps {
  clients: Client[];
  settings: CRMSettings;
  selectedClient?: Client | null;
  onSelectClient: (client: Client) => void;
  onLogFollowUp: (record: Omit<FollowUpRecord, 'id'>) => Promise<FollowUpRecord>;
  onOpenPublicCardView?: (loyaltyCode: string) => void;
}

export const CardsPage: React.FC<CardsPageProps> = ({
  clients,
  settings,
  selectedClient,
  onSelectClient,
  onLogFollowUp,
  onOpenPublicCardView
}) => {
  const activeClients = clients.filter(c => c.status !== 'archived');
  // Siempre el dato más reciente del cliente elegido
  const fresh = selectedClient ? clients.find(c => c.id === selectedClient.id) : null;
  const currentClient = (fresh && fresh.status !== 'archived' ? fresh : null) || activeClients[0] || null;

  const [cardStyle, setCardStyle] = useState<'obsidian' | 'heritage'>(
    (currentClient?.cardStyle as 'obsidian' | 'heritage') || settings.cardStyle || 'obsidian'
  );

  // Al cambiar de cliente se usa el estilo guardado en su ficha
  useEffect(() => {
    if (currentClient) setCardStyle((currentClient.cardStyle as 'obsidian' | 'heritage') || settings.cardStyle || 'obsidian');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<'link' | 'image'>('link');
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [hasOpenedWhatsApp, setHasOpenedWhatsApp] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const [isLogging, setIsLogging] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const scriptUrl = settings.googleAppsScriptUrl;
  const hasBackend = !!getEnvScriptUrl() || scriptUrl.startsWith('https://script.google.com/');
  const clientCardUrl = currentClient ? getClientCardUrl(currentClient.loyaltyCode, scriptUrl) : '';

  const redraw = () => {
    if (canvasRef.current && currentClient) {
      renderLoyaltyCard(canvasRef.current, { client: currentClient, settings, style: cardStyle });
    }
  };

  useEffect(() => {
    redraw();
    // Las fuentes web pueden cargar después del primer dibujo: se repinta al estar listas.
    const fonts = (document as any).fonts;
    if (fonts?.ready) fonts.ready.then(redraw).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient, settings, cardStyle]);

  const handleDownload = () => {
    if (!canvasRef.current || !currentClient) return;
    redraw();
    downloadCardAsPng(canvasRef.current, currentClient.name);
    setHasDownloaded(true);
  };

  const handleCopyLink = async () => {
    if (!clientCardUrl) return;
    try {
      await navigator.clipboard.writeText(clientCardUrl);
    } catch {
      window.prompt('Copia este enlace:', clientCardUrl);
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const linkMessage = (c: Client) =>
    compileTemplate(settings.cardDeliveryTemplate, {
      nombre: c.name,
      barberia: settings.barbershopName,
      visitas: c.cycleVisits || 0,
      recompensa: settings.rewardBenefit,
      dias_ausente: 0,
      enlace_tarjeta: getClientCardUrl(c.loyaltyCode, scriptUrl)
    });

  const imageMessage = (c: Client) =>
    `¡Hola ${c.name}! Te envío tu Tarjeta de Fidelidad de ${settings.barbershopName}. Llevas ${c.cycleVisits || 0}/${settings.loyaltyTargetVisits} sellos. ¡Guárdala en tu galería!`;

  const openDelivery = () => {
    if (!currentClient) return;
    setDeliveryMode('link');
    setDeliveryMessage(linkMessage(currentClient));
    setHasDownloaded(false);
    setHasOpenedWhatsApp(false);
    setDeliveryOpen(true);
  };

  const launchWhatsApp = () => {
    if (!currentClient) return;
    openExternalUrl(buildWhatsAppLink(currentClient.phone, deliveryMessage));
    setHasOpenedWhatsApp(true);
  };

  const confirmDelivery = async () => {
    if (!currentClient) return;
    setIsLogging(true);
    try {
      await onLogFollowUp({
        clientId: currentClient.id,
        clientName: currentClient.name,
        clientPhone: currentClient.phone,
        date: new Date().toISOString(),
        templateUsed: deliveryMode === 'link' ? 'Entrega de enlace de tarjeta' : 'Entrega de tarjeta (imagen PNG)',
        result: 'contactado',
        notes: `Tarjeta digital enviada (${deliveryMode === 'link' ? 'enlace web en vivo' : 'imagen PNG'}).`
      });
      setDeliveryOpen(false);
    } finally {
      setIsLogging(false);
    }
  };

  if (!currentClient) {
    return (
      <div className="py-20 text-center text-slate-500">
        <CreditCard className="w-12 h-12 mx-auto mb-3 text-slate-600" />
        <p className="text-sm">No hay clientes activos para generar tarjetas.</p>
      </div>
    );
  }

  const target = settings.loyaltyTargetVisits;
  const unlocked = getUnlockedTiers(currentClient, settings);
  const btn =
    'flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-200 bg-[#1e222b] hover:bg-[#272d38] border border-[#2d3442] rounded-lg transition-colors';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#14171d] p-4 sm:p-5 rounded-2xl border border-[#222631]">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide font-display">Tarjetas digitales</h2>
          <p className="text-xs text-slate-400 mt-1">
            El cliente abre un enlace y ve sus sellos, sus premios y puede reservar cita desde su móvil.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <button onClick={handleCopyLink} className={btn}>
            {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-amber-400" />}
            <span>{copiedLink ? 'Copiado' : 'Copiar enlace'}</span>
          </button>
          <button
            onClick={() =>
              onOpenPublicCardView ? onOpenPublicCardView(currentClient.loyaltyCode) : openExternalUrl(clientCardUrl)
            }
            className={btn}
          >
            <ExternalLink className="w-4 h-4" />
            <span>Ver como cliente</span>
          </button>
          <button onClick={handleDownload} className={btn}>
            <Download className="w-4 h-4" />
            <span>Descargar PNG</span>
          </button>
          <button
            onClick={openDelivery}
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded-lg shadow-md shadow-amber-950/40"
          >
            <Share2 className="w-4 h-4" />
            <span>Enviar por WhatsApp</span>
          </button>
        </div>
      </div>

      {!hasBackend && (
        <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-700/40 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Todavía no enlazaste Google Sheets. El enlace de la tarjeta solo funcionará en este dispositivo; para que tus
            clientes la vean en su teléfono, conecta tu hoja en <strong>Ajustes</strong>.
          </span>
        </div>
      )}

      <div className="p-3.5 sm:p-4 bg-[#14171d] rounded-xl border border-[#222631] grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-slate-300 font-medium text-xs mb-1.5 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-amber-500" /> Cliente
          </label>
          <select
            value={currentClient.id}
            onChange={e => {
              const found = clients.find(c => c.id === e.target.value);
              if (found) onSelectClient(found);
            }}
            className="w-full px-3.5 py-2.5 bg-[#0e1014] border border-[#282d3b] focus:border-amber-500 rounded-lg text-white text-sm focus:outline-none"
          >
            {[...activeClients]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.loyaltyCode} ({c.cycleVisits}/{target})
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="text-slate-300 font-medium text-xs mb-1.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-500" /> Estilo de la tarjeta
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['obsidian', 'Obsidiana', 'Carbón, oro y cobre'],
                ['heritage', 'Tradicional', 'Pizarra con poste de barbero']
              ] as const
            ).map(([id, name, desc]) => (
              <button
                key={id}
                onClick={() => setCardStyle(id)}
                className={`p-2.5 rounded-lg text-left border text-xs transition-colors ${
                  cardStyle === id
                    ? 'bg-amber-600/20 border-amber-500 text-amber-200 font-semibold'
                    : 'bg-[#181a20] border-[#252834] text-slate-400'
                }`}
              >
                <p className="font-bold">{name}</p>
                <p className="text-[10px] text-slate-500">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-3.5 bg-[#14171d] rounded-xl border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 shrink-0">
            <Globe className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-200">Enlace de la tarjeta</p>
            <p className="font-mono text-[11px] text-amber-400 truncate mt-0.5">{clientCardUrl}</p>
          </div>
        </div>
        <a
          href={clientCardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3.5 py-2.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg text-amber-300 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Abrir</span>
        </a>
      </div>

      <div className="p-3 sm:p-6 bg-[#14171d] rounded-2xl border border-[#222631] flex flex-col items-center">
        <div className="w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl border border-amber-500/20 bg-[#090a0d]">
          <canvas
            ref={canvasRef}
            className="w-full h-auto block"
            onClick={handleDownload}
            title="Toca para descargar la tarjeta"
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-2 text-center">
          1200 × 720 px · el QR abre la tarjeta en vivo del cliente
        </p>

        <div className="w-full max-w-3xl mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-[#101217] rounded-xl border border-[#20242e] min-w-0">
            <p className="text-slate-500 text-[10px] uppercase">Titular</p>
            <p className="font-semibold text-slate-200 truncate mt-0.5">{currentClient.name}</p>
          </div>
          <div className="p-3 bg-[#101217] rounded-xl border border-[#20242e]">
            <p className="text-slate-500 text-[10px] uppercase">Código</p>
            <p className="font-mono font-bold text-amber-400 mt-0.5">{currentClient.loyaltyCode}</p>
          </div>
          <div className="p-3 bg-[#101217] rounded-xl border border-[#20242e]">
            <p className="text-slate-500 text-[10px] uppercase">Sellos del ciclo</p>
            <p className="font-bold text-white mt-0.5">
              {currentClient.cycleVisits || 0} / {target}
            </p>
          </div>
          <div className="p-3 bg-[#101217] rounded-xl border border-[#20242e]">
            <p className="text-slate-500 text-[10px] uppercase">Premio</p>
            <p className={`font-semibold mt-0.5 ${unlocked.length > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {unlocked.length > 0 ? '¡Disponible!' : 'En progreso'}
            </p>
          </div>
        </div>

        <ul className="w-full max-w-3xl mt-3 space-y-1.5 text-xs">
          {getTiers(settings).map(t => (
            <li key={t.visits} className="flex items-center gap-2 text-slate-300">
              <Gift className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>{describeTier(t)}</span>
            </li>
          ))}
        </ul>
      </div>

      {deliveryOpen && (
        <Modal
          isOpen
          onClose={() => setDeliveryOpen(false)}
          title="Enviar tarjeta por WhatsApp"
          subtitle={`${currentClient.name} · ${currentClient.phone}`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeliveryMode('link');
                  setDeliveryMessage(linkMessage(currentClient));
                }}
                className={`p-3 rounded-xl border text-left ${
                  deliveryMode === 'link'
                    ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                    : 'bg-[#181a20] border-[#262a36] text-slate-400'
                }`}
              >
                <p className="font-bold flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-amber-400" /> Enlace en vivo (recomendado)
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Siempre muestra sus sellos actuales y permite reservar cita.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeliveryMode('image');
                  setDeliveryMessage(imageMessage(currentClient));
                }}
                className={`p-3 rounded-xl border text-left ${
                  deliveryMode === 'image'
                    ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                    : 'bg-[#181a20] border-[#262a36] text-slate-400'
                }`}
              >
                <p className="font-bold flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-amber-400" /> Imagen PNG
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">Se descarga y la adjuntas en el chat (no se actualiza sola).</p>
              </button>
            </div>

            {deliveryMode === 'image' && (
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                  hasDownloaded ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-[#111317] border-[#222631]'
                }`}
              >
                <div>
                  <p className="font-semibold text-slate-200">1. Descargar la imagen</p>
                  <p className="text-[11px] text-slate-400">Luego adjúntala en WhatsApp.</p>
                </div>
                <button
                  onClick={handleDownload}
                  className={`px-3 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 ${
                    hasDownloaded
                      ? 'bg-emerald-900/60 text-emerald-200 border border-emerald-700/50'
                      : 'bg-amber-500 text-slate-950'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{hasDownloaded ? 'Descargada ✓' : 'Descargar'}</span>
                </button>
              </div>
            )}

            <div className="p-3.5 bg-[#111317] rounded-xl border border-[#222631] space-y-1.5">
              <label className="block text-slate-300 font-semibold text-[11px]">Mensaje</label>
              <textarea
                rows={5}
                value={deliveryMessage}
                onChange={e => setDeliveryMessage(e.target.value)}
                className="w-full p-2.5 bg-[#0e1014] border border-[#282d3b] rounded-lg text-white text-sm focus:outline-none"
              />
            </div>

            <button
              onClick={launchWhatsApp}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>Abrir WhatsApp</span>
            </button>
            {hasOpenedWhatsApp && (
              <p className="text-emerald-300 text-[11px] flex items-center gap-1.5">
                <Check className="w-4 h-4" /> WhatsApp abierto. Cuando lo envíes, confirma abajo.
              </p>
            )}

            <div className="pt-3 border-t border-[#222631] flex items-center justify-end gap-3">
              <button onClick={() => setDeliveryOpen(false)} className="px-3 py-2 text-slate-400 hover:text-white">
                Cerrar
              </button>
              <button
                onClick={confirmDelivery}
                disabled={isLogging}
                className="px-4 py-2.5 font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg disabled:opacity-50"
              >
                {isLogging ? 'Guardando…' : 'Registrar envío ✓'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
