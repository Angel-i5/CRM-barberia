import { Client, CRMSettings } from '../types';
import { formatDate, getClientCardUrl } from './formatters';
import { drawQrToCanvas } from './qrCode';
import {
  getClaimedTiers,
  getFinalTier,
  getNextTier,
  getTiers,
  getUnlockedTiers,
  tierShortLabel
} from './loyalty';

export interface CardRenderOptions {
  client: Client;
  settings: CRMSettings;
  style?: 'obsidian' | 'heritage';
}

const W = 1200;
const H = 720;

/** Texto que se escribe en el QR: el enlace público de la tarjeta (incluye el ID del script si hace falta). */
export function getCardQrPayload(client: Client, settings: CRMSettings): string {
  return getClientCardUrl(client.loyaltyCode || 'BC-0001', settings.googleAppsScriptUrl);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Recorta el texto con "…" si no cabe en el ancho disponible. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

interface Palette {
  stampDone: string;
  stampDoneStroke: string;
  stampEmpty: string;
  stampEmptyStroke: string;
  emptyText: string;
  accent: string;
  tierColor: string;
  boxFill: string;
  boxStroke: string;
  qrFg: string;
}

/**
 * Dibuja la tarjeta de fidelidad en un canvas de 1200 x 720.
 * Muestra los sellos del ciclo, marca en cada sello el premio que desbloquea
 * (ej. "-20%" en el 5 y "GRATIS" en el 10) y lista los premios con su estado.
 */
export function renderLoyaltyCard(
  canvas: HTMLCanvasElement,
  { client, settings, style = 'obsidian' }: CardRenderOptions
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = W;
  canvas.height = H;

  const tiers = getTiers(settings);
  const target = Math.max(1, getFinalTier(settings).visits);
  const cycle = client.cycleVisits || 0;
  const claimed = new Set(getClaimedTiers(client));
  const unlocked = getUnlockedTiers(client, settings);
  const next = getNextTier(client, settings);
  const ready = unlocked.length > 0;

  const isObsidian = style === 'obsidian';
  const pal: Palette = isObsidian
    ? {
        stampDone: '#d97706',
        stampDoneStroke: '#fef3c7',
        stampEmpty: '#171a21',
        stampEmptyStroke: 'rgba(255,255,255,0.12)',
        emptyText: '#4b5563',
        accent: '#f59e0b',
        tierColor: '#fbbf24',
        boxFill: '#141820',
        boxStroke: ready ? 'rgba(16,185,129,0.6)' : 'rgba(217,119,6,0.4)',
        qrFg: '#0f172a'
      }
    : {
        stampDone: '#b45309',
        stampDoneStroke: '#fef08a',
        stampEmpty: '#21242d',
        stampEmptyStroke: 'rgba(255,255,255,0.1)',
        emptyText: '#6b7280',
        accent: '#f59e0b',
        tierColor: '#fcd34d',
        boxFill: '#181b22',
        boxStroke: 'rgba(180,83,9,0.4)',
        qrFg: '#1e293b'
      };

  // ----------------------------------------------------------------- fondo
  if (isObsidian) {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0c0e12');
    bg.addColorStop(0.5, '#14171d');
    bg.addColorStop(1, '#090a0d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(217,119,6,0.4)';
    ctx.lineWidth = 4;
    roundRect(ctx, 30, 30, W - 60, H - 60, 24);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(245,158,11,0.15)';
    ctx.lineWidth = 1;
    roundRect(ctx, 42, 42, W - 84, H - 84, 18);
    ctx.stroke();

    const corner = (cx: number, cy: number, rot: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 20);
      ctx.lineTo(0, 0);
      ctx.lineTo(20, 0);
      ctx.stroke();
      ctx.restore();
    };
    corner(54, 54, 0);
    corner(W - 54, 54, Math.PI / 2);
    corner(W - 54, H - 54, Math.PI);
    corner(54, H - 54, -Math.PI / 2);
  } else {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#121316');
    bg.addColorStop(1, '#1b1d24');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(260, 0);
    ctx.lineTo(0, 260);
    ctx.closePath();
    ctx.clip();
    for (let s = -200; s < 400; s += 24) {
      const k = (s / 24) % 3;
      ctx.fillStyle = k === 0 ? '#b91c1c' : k === 1 || k === -2 ? '#ffffff' : '#1d4ed8';
      ctx.fillRect(s, -50, 14, 400);
    }
    ctx.restore();

    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 3;
    roundRect(ctx, 35, 35, W - 70, H - 70, 16);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(217,119,6,0.3)';
    ctx.lineWidth = 1;
    roundRect(ctx, 45, 45, W - 90, H - 90, 12);
    ctx.stroke();
  }

  // ------------------------------------------------------------- cabecera
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.accent;
  ctx.font = 'bold 36px "Cinzel", Georgia, serif';
  ctx.fillText(fitText(ctx, (settings.barbershopName || 'BARBERÍA').toUpperCase(), 640), isObsidian ? 75 : 290, 100);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '16px "Outfit", Arial, sans-serif';
  ctx.fillText(isObsidian ? 'CLUB EXCLUSIVO DE FIDELIZACIÓN' : 'TARJETA DE RECOMPENSAS', isObsidian ? 77 : 292, 130);

  // Código
  ctx.fillStyle = 'rgba(217,119,6,0.15)';
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 1.5;
  roundRect(ctx, W - 340, 68, 260, 48, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = pal.accent;
  ctx.font = 'bold 20px "Outfit", Arial, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`CÓDIGO: ${client.loyaltyCode || 'BC-0001'}`, W - 210, 99);
  ctx.textAlign = 'left';

  // Titular
  ctx.fillStyle = '#6b7280';
  ctx.font = '14px "Outfit", Arial, sans-serif';
  ctx.fillText('TITULAR', 77, 185);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px "Outfit", Arial, sans-serif';
  ctx.fillText(fitText(ctx, client.name.toUpperCase(), 820), 75, 224);

  // Estado del progreso
  ctx.fillStyle = ready ? '#34d399' : pal.accent;
  ctx.font = 'bold 22px "Outfit", Arial, sans-serif';
  const status = ready
    ? '¡TIENES UN PREMIO LISTO PARA CANJEAR!'
    : next
    ? `${cycle} de ${target} visitas · próximo premio a las ${next.visits}`
    : `${cycle} de ${target} visitas`;
  ctx.fillText(fitText(ctx, status, 1000), 75, 290);

  // ---------------------------------------------------------------- sellos
  const marks = new Map(tiers.map(t => [t.visits, t]));
  const areaLeft = 75;
  const areaRight = W - 75;
  const perRow = target <= 12 ? target : Math.ceil(target / 2);
  const rows = target > 24 ? 0 : Math.ceil(target / perRow);

  if (rows === 0) {
    // Muchas visitas: barra de progreso con marcadores
    const barY = 345;
    const barW = areaRight - areaLeft;
    ctx.fillStyle = '#1b1f2a';
    roundRect(ctx, areaLeft, barY, barW, 22, 11);
    ctx.fill();
    ctx.fillStyle = pal.stampDone;
    roundRect(ctx, areaLeft, barY, Math.max(22, (Math.min(cycle, target) / target) * barW), 22, 11);
    ctx.fill();
    tiers.forEach(t => {
      const x = areaLeft + (t.visits / target) * barW;
      ctx.fillStyle = claimed.has(t.visits) ? '#64748b' : cycle >= t.visits ? '#10b981' : pal.tierColor;
      ctx.beginPath();
      ctx.arc(x, barY + 11, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e5e7eb';
      ctx.font = 'bold 14px "Outfit", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${t.visits} · ${tierShortLabel(t)}`, x, barY + 48);
    });
    ctx.textAlign = 'left';
  } else {
    const gap = (areaRight - areaLeft) / perRow;
    const radius = Math.min(rows === 1 ? 38 : 26, gap / 2 - 5);
    const rowY = rows === 1 ? [405] : [372, 442];

    for (let i = 1; i <= target; i++) {
      const idx = i - 1;
      const row = Math.floor(idx / perRow);
      const col = idx % perRow;
      const cx = areaLeft + gap * col + gap / 2;
      const cy = rowY[row];
      const done = i <= cycle;
      const tier = marks.get(i);

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      if (done) {
        const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, radius);
        g.addColorStop(0, isObsidian ? '#fbbf24' : '#d97706');
        g.addColorStop(0.7, pal.stampDone);
        g.addColorStop(1, '#92400e');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = pal.stampDoneStroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(radius * 0.65)}px "Outfit", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('✓', cx, cy + radius * 0.22);
      } else {
        ctx.fillStyle = pal.stampEmpty;
        ctx.fill();
        ctx.strokeStyle = tier ? pal.tierColor : pal.stampEmptyStroke;
        ctx.lineWidth = tier ? 3 : 1.5;
        ctx.stroke();
        ctx.fillStyle = tier ? pal.tierColor : pal.emptyText;
        ctx.font = `bold ${Math.round(radius * 0.55)}px "Outfit", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(String(i), cx, cy + radius * 0.2);
      }

      // Marca del premio bajo el sello
      if (tier) {
        const isClaimed = claimed.has(tier.visits);
        ctx.fillStyle = isClaimed ? '#64748b' : done ? '#34d399' : pal.tierColor;
        ctx.font = 'bold 15px "Outfit", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(tierShortLabel(tier), cx, cy + radius + 20);
      }
    }
    ctx.textAlign = 'left';
  }

  // ------------------------------------------------------- caja de premios
  const boxX = 75;
  const boxY = 495;
  const boxW = W - 420;
  const boxH = 150;
  ctx.fillStyle = pal.boxFill;
  ctx.strokeStyle = pal.boxStroke;
  ctx.lineWidth = 1.5;
  roundRect(ctx, boxX, boxY, boxW, boxH, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = ready ? '#34d399' : '#d97706';
  ctx.font = 'bold 13px "Outfit", Arial, sans-serif';
  ctx.fillText('PREMIOS DE TU TARJETA', boxX + 28, boxY + 32);

  ctx.fillStyle = '#6b7280';
  ctx.font = '13px "Outfit", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Visitas totales: ${client.totalVisits || 0}`, boxX + boxW - 28, boxY + 32);
  ctx.textAlign = 'left';

  const shownTiers = tiers.slice(0, 3);
  shownTiers.forEach((t, i) => {
    const y = boxY + 68 + i * 32;
    const isClaimed = claimed.has(t.visits);
    const isReady = cycle >= t.visits && !isClaimed;
    ctx.fillStyle = isClaimed ? '#64748b' : isReady ? '#34d399' : '#f3f4f6';
    ctx.font = 'bold 21px "Outfit", Arial, sans-serif';
    const tag = isClaimed ? ' · canjeado' : isReady ? ' · ¡LISTO!' : '';
    ctx.fillText(fitText(ctx, `${t.visits} visitas → ${t.title}${tag}`, boxW - 56), boxX + 28, y);
  });
  if (tiers.length > shownTiers.length) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '13px "Outfit", Arial, sans-serif';
    ctx.fillText(`+${tiers.length - shownTiers.length} premios más`, boxX + 28, boxY + boxH - 10);
  }

  // Emisión
  ctx.fillStyle = '#6b7280';
  ctx.font = '13px "Outfit", Arial, sans-serif';
  ctx.fillText(`Emitida: ${formatDate(client.cardIssuedAt || client.createdAt)}`, boxX, boxY + boxH + 24);

  // ------------------------------------------------------------------- QR
  const qrBoxX = W - 300;
  const qrBoxY = 462;
  const qrBoxSize = 190;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 12);
  ctx.fill();
  try {
    drawQrToCanvas(ctx, getCardQrPayload(client, settings), qrBoxX, qrBoxY, qrBoxSize, pal.qrFg, '#ffffff');
  } catch {
    // Enlace demasiado largo para el QR: se deja el cuadro vacío en lugar de romper la tarjeta
  }
  ctx.fillStyle = '#9ca3af';
  ctx.font = '12px "Outfit", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ESCANEA · TARJETA EN VIVO', qrBoxX + qrBoxSize / 2, qrBoxY + qrBoxSize + 22);
  ctx.textAlign = 'left';
}

/** Descarga el canvas como PNG. */
export function downloadCardAsPng(canvas: HTMLCanvasElement, clientName: string) {
  const safeName = clientName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_');
  const link = document.createElement('a');
  link.download = `tarjeta_fidelidad_${safeName}.png`;
  link.href = canvas.toDataURL('image/png', 1.0);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
