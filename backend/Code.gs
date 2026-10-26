/**
 * ==============================================================================
 * BARBER CRM v3 - BACKEND (Google Apps Script + Google Sheets)
 * ==============================================================================
 *
 * Hojas que administra este script (se crean solas):
 *   Clientes, Visitas, Tarjetas, Seguimiento, Recompensas, Configuracion,
 *   Citas, Servicios
 *
 * SEGURIDAD
 *  - Define tu clave de administrador en API_KEY (abajo) o, mejor, en
 *    Configuración del proyecto > Propiedades del script > API_KEY.
 *  - Todas las acciones del panel exigen esa clave. Solo 3 acciones son
 *    públicas (las que usa la tarjeta del cliente): ping, getClientCard y
 *    bookAppointment (reservar cita).
 *
 * ZONA HORARIA
 *  - Se usa la zona horaria de la hoja de cálculo (Archivo > Configuración).
 */

var SCHEMA_VERSION = '3';

// Clave del administrador. Déjala vacía SOLO para pruebas.
var API_KEY = '';

// Acciones que NO requieren clave (las usa la tarjeta pública del cliente)
var PUBLIC_ACTIONS = { ping: true, getClientCard: true, bookAppointment: true };

// Anti-abuso de la reserva online
var MAX_ACTIVE_BOOKINGS_PER_CLIENT = 3;
var MAX_DAYS_AHEAD = 60;

var SCHEMAS = {
  Clientes: [
    'id', 'name', 'phone', 'createdAt', 'lastVisitAt', 'birthday',
    'cutPreferences', 'notes', 'totalVisits', 'cycleVisits', 'totalSpent',
    'status', 'marketingConsent', 'loyaltyCode', 'cardIssuedAt', 'cardStyle',
    'claimedTiers'
  ],
  Visitas: [
    'id', 'idempotencyKey', 'clientId', 'clientName', 'clientPhone',
    'date', 'time', 'service', 'amount', 'notes', 'createdAt'
  ],
  Tarjetas: ['loyaltyCode', 'clientId', 'clientName', 'issuedAt', 'style', 'status'],
  Seguimiento: [
    'id', 'clientId', 'clientName', 'clientPhone', 'date',
    'templateUsed', 'result', 'notes'
  ],
  Recompensas: [
    'id', 'clientId', 'clientName', 'redeemedAt', 'benefitName',
    'visitsConsumed', 'tierVisits', 'notes'
  ],
  Configuracion: ['key', 'value', 'updatedAt'],
  Citas: [
    'id', 'clientId', 'clientName', 'clientPhone', 'date', 'time',
    'service', 'durationMinutes', 'amount', 'status', 'barberName', 'notes', 'createdAt'
  ],
  Servicios: [
    'id', 'name', 'price', 'durationMinutes', 'category', 'description', 'isActive', 'order'
  ]
};

// Tipos de columna. Todo lo demás es TEXTO (formato '@') para que Google Sheets
// NO convierta teléfonos (+58...), fechas (2026-10-10) ni horas (17:30).
var NUMERIC = {
  totalVisits: 1, cycleVisits: 1, totalSpent: 1, amount: 1, durationMinutes: 1,
  visitsConsumed: 1, tierVisits: 1, price: 1, order: 1
};
var BOOLEAN = { marketingConsent: 1, isActive: 1 };

var DEFAULT_SERVICES = [
  { id: 'SRV-101', name: 'Corte Clásico a Tijera', price: 20, durationMinutes: 30, category: 'corte', description: 'Lavado, corte artesanal a tijera y peinado.', isActive: true, order: 1 },
  { id: 'SRV-102', name: 'Skin Fade / Degradado', price: 22, durationMinutes: 45, category: 'corte', description: 'Degradado pulido, navaja en contornos y texturizado.', isActive: true, order: 2 },
  { id: 'SRV-103', name: 'Arreglo Barba Ritual', price: 16, durationMinutes: 30, category: 'barba', description: 'Toalla caliente, perfilado a navaja y bálsamo.', isActive: true, order: 3 },
  { id: 'SRV-104', name: 'Combo Corte + Barba Ritual', price: 32, durationMinutes: 60, category: 'combo', description: 'Corte más arreglo completo de barba.', isActive: true, order: 4 },
  { id: 'SRV-105', name: 'Afeitado Tradicional Navaja', price: 18, durationMinutes: 35, category: 'barba', description: 'Espuma caliente, doble pasada a navaja.', isActive: true, order: 5 },
  { id: 'SRV-106', name: 'Camuflaje de Canas / Color', price: 25, durationMinutes: 40, category: 'tratamiento', description: 'Matizado natural para cabello o barba.', isActive: true, order: 6 },
  { id: 'SRV-107', name: 'Corte Infantil (hasta 12 años)', price: 15, durationMinutes: 30, category: 'corte', description: 'Atención paciente y estilo moderno.', isActive: true, order: 7 },
  { id: 'SRV-108', name: 'Exfoliación & Mascarilla Black', price: 14, durationMinutes: 25, category: 'tratamiento', description: 'Limpieza profunda y mascarilla de carbón.', isActive: true, order: 8 }
];

// ----------------------------------------------------------------------------
// UTILIDADES BÁSICAS
// ----------------------------------------------------------------------------

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function tz_() {
  return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

function getApiKey_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return String(fromProps || API_KEY || '');
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function todayStr_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function nowMinutes_() {
  var hm = Utilities.formatDate(new Date(), tz_(), 'HH:mm').split(':');
  return parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10);
}

function timeToMinutes_(hm) {
  var p = String(hm || '0:0').split(':');
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
}

function digits_(s) {
  return String(s || '').replace(/\D/g, '');
}

function isDateStr_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function isTimeStr_(s) {
  return /^\d{2}:\d{2}$/.test(String(s || ''));
}

function addDays_(ymd, days) {
  var p = ymd.split('-');
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + days);
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + day;
}

function weekdayOf_(ymd) {
  var p = ymd.split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getDay();
}

// ----------------------------------------------------------------------------
// ESQUEMA / HOJAS
// ----------------------------------------------------------------------------

function styleHeader_(sheet, fromCol, count) {
  sheet.getRange(1, fromCol, 1, count)
    .setFontWeight('bold')
    .setBackground('#1e293b')
    .setFontColor('#ffffff');
}

function ensureColumns_(sheet, cols) {
  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastCol === 0) {
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    styleHeader_(sheet, 1, cols.length);
    sheet.setFrozenRows(1);
    return;
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var missing = [];
  for (var i = 0; i < cols.length; i++) {
    if (header.indexOf(cols[i]) < 0) missing.push(cols[i]);
  }
  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    styleHeader_(sheet, lastCol + 1, missing.length);
  }
}

function formatForCol_(key) {
  return NUMERIC[key] ? 'General' : (BOOLEAN[key] ? 'General' : '@');
}

function applyFormats_(sheet) {
  var lastCol = sheet.getLastColumn();
  var maxRows = sheet.getMaxRows();
  if (lastCol === 0 || maxRows < 2) return;
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < header.length; c++) {
    if (formatForCol_(header[c]) === '@') {
      sheet.getRange(2, c + 1, maxRows - 1, 1).setNumberFormat('@');
    }
  }
}

function initDatabase() {
  var props = PropertiesService.getScriptProperties();
  var ss = ss_();
  var allExist = true;
  for (var n in SCHEMAS) {
    if (!ss.getSheetByName(n)) { allExist = false; break; }
  }
  if (allExist && props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION) return;

  withLock_(function () {
    for (var name in SCHEMAS) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) sheet = ss.insertSheet(name);
      ensureColumns_(sheet, SCHEMAS[name]);
      applyFormats_(sheet);
      if (name === 'Servicios' && sheet.getLastRow() <= 1) {
        bulkAppend_('Servicios', DEFAULT_SERVICES);
      }
    }
    props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
  });
}

// ----------------------------------------------------------------------------
// LECTURA / ESCRITURA GENÉRICA DE TABLAS
// ----------------------------------------------------------------------------

function dateToString_(key, d) {
  var tz = tz_();
  if (key === 'time') return Utilities.formatDate(d, tz, 'HH:mm');
  var hms = Utilities.formatDate(d, tz, 'HH:mm:ss');
  if (hms === '00:00:00') return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ss");
}

function cast_(key, v) {
  if (v instanceof Date) v = dateToString_(key, v);
  if (NUMERIC[key]) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  if (BOOLEAN[key]) return v === true || String(v).toLowerCase() === 'true';
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return v;
}

function table_(name) {
  var sheet = ss_().getSheetByName(name);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var data = lastRow > 0 && lastCol > 0 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  return { sheet: sheet, headers: data[0], data: data };
}

function getRowsAsObjects_(name) {
  var t = table_(name);
  var out = [];
  for (var r = 1; r < t.data.length; r++) {
    var row = t.data[r];
    var obj = {};
    var any = false;
    for (var c = 0; c < t.headers.length; c++) {
      var key = t.headers[c];
      if (!key) continue;
      var v = cast_(key, row[c]);
      if (v !== '' && v !== 0 && v !== false) any = true;
      obj[key] = v;
    }
    if (any) out.push(obj);
  }
  return out;
}

function rowValues_(headers, obj, existingRow) {
  var vals = [];
  for (var c = 0; c < headers.length; c++) {
    var h = headers[c];
    var v = obj[h];
    if (v === undefined) {
      vals.push(existingRow ? existingRow[c] : '');
    } else if (v === null) {
      vals.push('');
    } else if (typeof v === 'object') {
      vals.push(JSON.stringify(v));
    } else {
      vals.push(v);
    }
  }
  return vals;
}

function formatsFor_(headers) {
  var f = [];
  for (var c = 0; c < headers.length; c++) f.push(formatForCol_(headers[c]));
  return f;
}

/** Inserta o actualiza (merge) una fila por columna clave. Devuelve el objeto resultante. */
function upsertRow_(name, keyCol, obj) {
  var t = table_(name);
  var keyIdx = t.headers.indexOf(keyCol);
  var found = -1;
  for (var r = 1; r < t.data.length; r++) {
    if (String(t.data[r][keyIdx]) === String(obj[keyCol])) { found = r; break; }
  }
  if (found >= 0) {
    var merged = rowValues_(t.headers, obj, t.data[found]);
    t.sheet.getRange(found + 1, 1, 1, merged.length).setValues([merged]);
  } else {
    var vals = rowValues_(t.headers, obj, null);
    var row = t.sheet.getLastRow() + 1;
    var range = t.sheet.getRange(row, 1, 1, vals.length);
    range.setNumberFormats([formatsFor_(t.headers)]);
    range.setValues([vals]);
  }
  return obj;
}

/** Agrega muchas filas de golpe (omite las que ya existan por clave). */
function bulkAppend_(name, objs, keyCol) {
  if (!objs || objs.length === 0) return 0;
  var t = table_(name);
  var existing = {};
  if (keyCol) {
    var ki = t.headers.indexOf(keyCol);
    for (var r = 1; r < t.data.length; r++) existing[String(t.data[r][ki])] = true;
  }
  var rows = [];
  for (var i = 0; i < objs.length; i++) {
    var o = objs[i];
    if (keyCol && (existing[String(o[keyCol])] || !o[keyCol])) continue;
    rows.push(rowValues_(t.headers, o, null));
  }
  if (rows.length === 0) return 0;
  var start = t.sheet.getLastRow() + 1;
  var range = t.sheet.getRange(start, 1, rows.length, t.headers.length);
  var fmts = formatsFor_(t.headers);
  var fmtRows = [];
  for (var k = 0; k < rows.length; k++) fmtRows.push(fmts);
  range.setNumberFormats(fmtRows);
  range.setValues(rows);
  return rows.length;
}

function findRow_(name, keyCol, keyValue) {
  var t = table_(name);
  var keyIdx = t.headers.indexOf(keyCol);
  for (var r = 1; r < t.data.length; r++) {
    if (String(t.data[r][keyIdx]) === String(keyValue)) {
      return { t: t, rowIndex: r, values: t.data[r] };
    }
  }
  return null;
}

function rowToObj_(headers, values) {
  var obj = {};
  for (var c = 0; c < headers.length; c++) {
    if (headers[c]) obj[headers[c]] = cast_(headers[c], values[c]);
  }
  return obj;
}

function deleteById_(name, id) {
  var f = findRow_(name, 'id', id);
  if (!f) return false;
  f.t.sheet.deleteRow(f.rowIndex + 1);
  return true;
}

// ----------------------------------------------------------------------------
// CONFIGURACIÓN
// ----------------------------------------------------------------------------

function getSettingsMap_() {
  var map = {};
  var t = table_('Configuracion');
  for (var r = 1; r < t.data.length; r++) {
    var key = t.data[r][0];
    var raw = t.data[r][1];
    if (!key) continue;
    try { map[key] = JSON.parse(raw); } catch (e) { map[key] = raw; }
  }
  return map;
}

function scheduleSettings_() {
  var s = getSettingsMap_();
  var barbers = (s.barbers && s.barbers.length) ? s.barbers : ['Barbero Principal'];
  return {
    barbers: barbers,
    capacity: Math.max(1, barbers.length),
    openTime: s.openTime || '09:00',
    closeTime: s.closeTime || '20:00',
    slotMinutes: Number(s.slotMinutes) || 30,
    workingDays: (s.workingDays && s.workingDays.length) ? s.workingDays : [1, 2, 3, 4, 5, 6],
    all: s
  };
}

// ----------------------------------------------------------------------------
// ROUTER
// ----------------------------------------------------------------------------

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || 'ping';
    if (!PUBLIC_ACTIONS[action]) {
      return jsonResponse_({ success: false, error: 'Esta acción solo está disponible por POST.' });
    }
    return dispatch_({ action: action, code: p.code, apiKey: p.apiKey });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ success: false, error: 'Cuerpo de la petición vacío' });
    }
    var payload = JSON.parse(e.postData.contents);
    return dispatch_(payload);
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err) });
  }
}

var READ_ONLY_ACTIONS = { ping: true, getAllData: true, getClientCard: true };

function dispatch_(p) {
  var action = p.action;
  var key = getApiKey_();
  var secured = key !== '';
  var authorized = !secured || String(p.apiKey || '') === key;

  if (!PUBLIC_ACTIONS[action] && !authorized) {
    return jsonResponse_({
      success: false,
      code: 'UNAUTHORIZED',
      error: 'No autorizado: la clave de API es incorrecta o falta (Configuración > Clave de API).'
    });
  }

  if (action === 'ping') {
    return jsonResponse_({
      success: true,
      message: 'Barber CRM API operativa y conectada a Google Sheets.',
      version: SCHEMA_VERSION,
      secured: secured,
      authorized: authorized,
      timezone: tz_()
    });
  }

  initDatabase();

  if (READ_ONLY_ACTIONS[action]) {
    if (action === 'getAllData') return jsonResponse_({ success: true, data: fetchAllCRMData_() });
    if (action === 'getClientCard') return jsonResponse_(fetchClientCardByCode_(p.code));
  }

  // Todas las escrituras van con bloqueo para evitar colisiones
  return withLock_(function () {
    switch (action) {
      case 'saveClient': return handleSaveClient_(p.client);
      case 'archiveClient': return handleArchiveClient_(p.clientId);
      case 'registerVisit': return handleRegisterVisit_(p.visit);
      case 'updateVisit': return handleUpdateVisit_(p.visit);
      case 'deleteVisit': return handleDeleteVisit_(p.visitId);
      case 'redeemReward': return handleRedeemReward_(p.reward, p.clientPatch);
      case 'logFollowUp': return handleLogFollowUp_(p.followUp);
      case 'saveSettings': return handleSaveSettings_(p.settings);
      case 'saveAppointment': return handleSaveAppointment_(p.appointment);
      case 'updateAppointmentStatus': return handleUpdateAppointmentStatus_(p.appointmentId, p.status);
      case 'deleteAppointment': return handleDeleteAppointment_(p.appointmentId);
      case 'saveService': return handleSaveService_(p.service);
      case 'deleteService': return handleDeleteService_(p.serviceId);
      case 'toggleServiceActive': return handleToggleService_(p.serviceId);
      case 'resetServices': return handleResetServices_(p.services);
      case 'bookAppointment': return handleBookAppointment_(p);
      case 'syncAll': return handleSyncAll_(p.data);
      default:
        return jsonResponse_({ success: false, error: 'Acción no reconocida: ' + action });
    }
  });
}

// ----------------------------------------------------------------------------
// LECTURAS
// ----------------------------------------------------------------------------

function fetchAllCRMData_() {
  return {
    clients: getRowsAsObjects_('Clientes'),
    visits: getRowsAsObjects_('Visitas'),
    followUps: getRowsAsObjects_('Seguimiento'),
    rewards: getRowsAsObjects_('Recompensas'),
    appointments: getRowsAsObjects_('Citas'),
    services: getRowsAsObjects_('Servicios'),
    settings: getSettingsMap_(),
    serverDate: todayStr_()
  };
}

function fetchClientCardByCode_(code) {
  if (!code) return { success: false, error: 'Código de tarjeta no proporcionado' };
  var client = findClientByCode_(code);
  if (!client) return { success: false, error: 'Tarjeta no encontrada con el código proporcionado' };
  if (String(client.status) === 'archived') {
    return { success: false, error: 'Esta tarjeta no se encuentra activa' };
  }

  var sch = scheduleSettings_();
  var s = sch.all;
  var tiers = (s.rewardTiers && s.rewardTiers.length) ? s.rewardTiers : [];
  var target = Number(s.loyaltyTargetVisits) || (tiers.length ? tiers[tiers.length - 1].visits : 10);
  var cycle = Number(client.cycleVisits) || 0;
  var claimed = String(client.claimedTiers || '').split(',')
    .map(function (x) { return parseInt(x, 10); })
    .filter(function (x) { return x > 0; });

  var today = todayStr_();
  var services = getRowsAsObjects_('Servicios')
    .filter(function (x) { return x.isActive; })
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
    .map(function (x) {
      return { id: x.id, name: x.name, price: x.price, durationMinutes: x.durationMinutes, description: x.description || '' };
    });

  var appts = getRowsAsObjects_('Citas');
  var busy = [];
  var upcoming = [];
  for (var i = 0; i < appts.length; i++) {
    var a = appts[i];
    if (a.status === 'cancelada' || String(a.date) < today) continue;
    busy.push({ date: a.date, time: a.time, durationMinutes: a.durationMinutes || 30 });
    if (a.clientId === client.id && a.status !== 'completada') {
      upcoming.push({ id: a.id, date: a.date, time: a.time, service: a.service, status: a.status });
    }
  }
  upcoming.sort(function (x, y) { return (x.date + x.time).localeCompare(y.date + y.time); });

  return {
    success: true,
    data: {
      loyaltyCode: String(client.loyaltyCode),
      clientName: String(client.name),
      cycleVisits: cycle,
      totalVisits: Number(client.totalVisits) || 0,
      targetVisits: target,
      rewardBenefit: String(s.rewardBenefit || 'Corte gratis'),
      rewardTiers: tiers,
      claimedTiers: claimed,
      barbershopName: String(s.barbershopName || 'Barber CRM'),
      barbershopPhone: String(s.barbershopPhone || ''),
      currency: String(s.currency || '$'),
      cardStyle: String(client.cardStyle || s.cardStyle || 'obsidian'),
      lastVisitAt: client.lastVisitAt ? String(client.lastVisitAt) : null,
      cardIssuedAt: client.cardIssuedAt ? String(client.cardIssuedAt) : null,
      isRewardUnlocked: cycle >= target,
      services: services,
      busy: busy,
      capacity: sch.capacity,
      openTime: sch.openTime,
      closeTime: sch.closeTime,
      slotMinutes: sch.slotMinutes,
      workingDays: sch.workingDays,
      upcoming: upcoming.slice(0, 3)
    }
  };
}

function findClientByCode_(code) {
  var clients = getRowsAsObjects_('Clientes');
  var wanted = String(code).toUpperCase();
  for (var i = 0; i < clients.length; i++) {
    if (String(clients[i].loyaltyCode).toUpperCase() === wanted) return clients[i];
  }
  return null;
}

// ----------------------------------------------------------------------------
// CLIENTES
// ----------------------------------------------------------------------------

function upsertCardRow_(client) {
  upsertRow_('Tarjetas', 'loyaltyCode', {
    loyaltyCode: client.loyaltyCode,
    clientId: client.id,
    clientName: client.name,
    issuedAt: client.cardIssuedAt || client.createdAt || todayStr_(),
    style: client.cardStyle || 'obsidian',
    status: client.status === 'archived' ? 'archived' : 'active'
  });
}

function handleSaveClient_(client) {
  if (!client || !client.name || !client.phone) {
    return jsonResponse_({ success: false, error: 'Nombre y teléfono son obligatorios' });
  }

  var clients = getRowsAsObjects_('Clientes');
  var cleanPhone = digits_(client.phone);
  var obj = {};
  for (var k in client) obj[k] = client[k];

  if (!obj.id) obj.id = newId_('CLI');
  if (!obj.createdAt) obj.createdAt = todayStr_();
  if (!obj.loyaltyCode) obj.loyaltyCode = 'BC-' + Math.floor(1000 + Math.random() * 9000);

  for (var i = 0; i < clients.length; i++) {
    var c = clients[i];
    if (String(c.id) !== String(obj.id) && digits_(c.phone) === cleanPhone) {
      return jsonResponse_({
        success: false,
        error: 'Ya existe un cliente con este teléfono (' + c.name + ')'
      });
    }
    if (String(c.id) !== String(obj.id) &&
        String(c.loyaltyCode).toUpperCase() === String(obj.loyaltyCode).toUpperCase()) {
      return jsonResponse_({ success: false, error: 'El código de tarjeta ' + obj.loyaltyCode + ' ya está en uso' });
    }
  }

  upsertRow_('Clientes', 'id', obj);
  upsertCardRow_(obj);
  return jsonResponse_({ success: true, client: obj });
}

function handleArchiveClient_(clientId) {
  var f = findRow_('Clientes', 'id', clientId);
  if (!f) return jsonResponse_({ success: false, error: 'Cliente no encontrado' });
  var obj = rowToObj_(f.t.headers, f.values);
  obj.status = 'archived';
  upsertRow_('Clientes', 'id', { id: clientId, status: 'archived' });
  upsertCardRow_(obj);
  return jsonResponse_({ success: true, message: 'Cliente archivado correctamente' });
}

function recomputeLastVisit_(clientId) {
  var visits = getRowsAsObjects_('Visitas');
  var last = '';
  for (var i = 0; i < visits.length; i++) {
    if (String(visits[i].clientId) === String(clientId) && String(visits[i].date) > last) {
      last = String(visits[i].date);
    }
  }
  return last;
}

// ----------------------------------------------------------------------------
// VISITAS
// ----------------------------------------------------------------------------

function handleRegisterVisit_(visit) {
  if (!visit || !visit.clientId) {
    return jsonResponse_({ success: false, error: 'Datos de visita incompletos' });
  }

  var visits = getRowsAsObjects_('Visitas');
  for (var i = 0; i < visits.length; i++) {
    var same = (visit.idempotencyKey && String(visits[i].idempotencyKey) === String(visit.idempotencyKey)) ||
               (visit.id && String(visits[i].id) === String(visit.id));
    if (same) {
      return jsonResponse_({ success: true, duplicate: true, message: 'Visita ya registrada previamente (idempotente)', visit: visits[i] });
    }
  }

  var cf = findRow_('Clientes', 'id', visit.clientId);
  if (!cf) {
    return jsonResponse_({ success: false, error: 'El cliente ' + visit.clientId + ' no existe en Google Sheets' });
  }

  var visitObj = {};
  for (var k in visit) visitObj[k] = visit[k];
  if (!visitObj.id) visitObj.id = newId_('VIS');
  if (!visitObj.createdAt) visitObj.createdAt = new Date().toISOString();
  upsertRow_('Visitas', 'id', visitObj);

  var c = rowToObj_(cf.t.headers, cf.values);
  var lastVisit = String(c.lastVisitAt || '');
  var patch = {
    id: c.id,
    totalVisits: (Number(c.totalVisits) || 0) + 1,
    cycleVisits: (Number(c.cycleVisits) || 0) + 1,
    totalSpent: (Number(c.totalSpent) || 0) + (Number(visitObj.amount) || 0),
    lastVisitAt: String(visitObj.date) > lastVisit ? String(visitObj.date) : lastVisit,
    status: 'active'
  };
  upsertRow_('Clientes', 'id', patch);

  return jsonResponse_({ success: true, visit: visitObj });
}

function handleUpdateVisit_(visit) {
  if (!visit || !visit.id) return jsonResponse_({ success: false, error: 'Visita sin id' });
  var f = findRow_('Visitas', 'id', visit.id);
  if (!f) return jsonResponse_({ success: false, error: 'Visita no encontrada' });

  var old = rowToObj_(f.t.headers, f.values);
  // El cliente de una visita no se puede cambiar (evita descuadrar los sellos)
  var obj = {};
  for (var k in visit) obj[k] = visit[k];
  obj.clientId = old.clientId;
  obj.clientName = old.clientName;
  obj.clientPhone = old.clientPhone;
  upsertRow_('Visitas', 'id', obj);

  var diff = (Number(obj.amount) || 0) - (Number(old.amount) || 0);
  var cf = findRow_('Clientes', 'id', old.clientId);
  if (cf) {
    var c = rowToObj_(cf.t.headers, cf.values);
    upsertRow_('Clientes', 'id', {
      id: c.id,
      totalSpent: Math.max(0, (Number(c.totalSpent) || 0) + diff),
      lastVisitAt: recomputeLastVisit_(c.id)
    });
  }
  return jsonResponse_({ success: true, visit: obj });
}

function handleDeleteVisit_(visitId) {
  var f = findRow_('Visitas', 'id', visitId);
  if (!f) return jsonResponse_({ success: false, error: 'Visita no encontrada' });
  var old = rowToObj_(f.t.headers, f.values);
  f.t.sheet.deleteRow(f.rowIndex + 1);

  var cf = findRow_('Clientes', 'id', old.clientId);
  if (cf) {
    var c = rowToObj_(cf.t.headers, cf.values);
    upsertRow_('Clientes', 'id', {
      id: c.id,
      totalVisits: Math.max(0, (Number(c.totalVisits) || 0) - 1),
      cycleVisits: Math.max(0, (Number(c.cycleVisits) || 0) - 1),
      totalSpent: Math.max(0, (Number(c.totalSpent) || 0) - (Number(old.amount) || 0)),
      lastVisitAt: recomputeLastVisit_(c.id)
    });
  }
  return jsonResponse_({ success: true, message: 'Visita eliminada' });
}

// ----------------------------------------------------------------------------
// RECOMPENSAS, SEGUIMIENTO, CONFIGURACIÓN
// ----------------------------------------------------------------------------

function handleRedeemReward_(reward, clientPatch) {
  if (!reward || !reward.clientId) return jsonResponse_({ success: false, error: 'Datos de canje incompletos' });

  var rewardObj = {};
  for (var k in reward) rewardObj[k] = reward[k];
  if (!rewardObj.id) rewardObj.id = newId_('REW');
  if (!rewardObj.redeemedAt) rewardObj.redeemedAt = new Date().toISOString();

  // Idempotencia: si el canje ya existe no se vuelve a aplicar
  if (findRow_('Recompensas', 'id', rewardObj.id)) {
    return jsonResponse_({ success: true, duplicate: true, reward: rewardObj });
  }

  upsertRow_('Recompensas', 'id', rewardObj);

  var cf = findRow_('Clientes', 'id', rewardObj.clientId);
  if (cf && clientPatch) {
    var patch = { id: rewardObj.clientId };
    if (clientPatch.cycleVisits !== undefined) patch.cycleVisits = Number(clientPatch.cycleVisits) || 0;
    if (clientPatch.claimedTiers !== undefined) patch.claimedTiers = String(clientPatch.claimedTiers);
    upsertRow_('Clientes', 'id', patch);
  }
  return jsonResponse_({ success: true, reward: rewardObj });
}

function handleLogFollowUp_(followUp) {
  if (!followUp) return jsonResponse_({ success: false, error: 'Datos incompletos' });
  var obj = {};
  for (var k in followUp) obj[k] = followUp[k];
  if (!obj.id) obj.id = newId_('FOL');
  if (!obj.date) obj.date = new Date().toISOString();
  if (findRow_('Seguimiento', 'id', obj.id)) return jsonResponse_({ success: true, duplicate: true, followUp: obj });
  upsertRow_('Seguimiento', 'id', obj);
  return jsonResponse_({ success: true, followUp: obj });
}

function handleSaveSettings_(settings) {
  if (!settings) return jsonResponse_({ success: false, error: 'Configuración vacía' });
  var sheet = ss_().getSheetByName('Configuracion');
  var now = new Date().toISOString();
  var rows = [];
  for (var k in settings) {
    // Datos locales de cada dispositivo: nunca se guardan en la hoja
    if (k === 'googleAppsScriptUrl' || k === 'apiKey') continue;
    rows.push([k, JSON.stringify(settings[k]), now]);
  }
  sheet.clear();
  sheet.getRange(1, 1, 1, 3).setValues([SCHEMAS.Configuracion]);
  styleHeader_(sheet, 1, 3);
  sheet.setFrozenRows(1);
  if (rows.length > 0) {
    var range = sheet.getRange(2, 1, rows.length, 3);
    range.setNumberFormat('@');
    range.setValues(rows);
  }
  return jsonResponse_({ success: true, message: 'Configuración guardada' });
}

// ----------------------------------------------------------------------------
// CITAS
// ----------------------------------------------------------------------------

function handleSaveAppointment_(appointment) {
  if (!appointment || !appointment.clientId || !appointment.date || !appointment.time) {
    return jsonResponse_({ success: false, error: 'Datos de cita incompletos (cliente, fecha y hora requeridos)' });
  }
  var obj = {};
  for (var k in appointment) obj[k] = appointment[k];
  if (!obj.id) obj.id = newId_('APT');
  if (!obj.createdAt) obj.createdAt = new Date().toISOString();
  if (!obj.status) obj.status = 'pendiente';
  upsertRow_('Citas', 'id', obj);
  return jsonResponse_({ success: true, appointment: obj });
}

function handleUpdateAppointmentStatus_(appointmentId, status) {
  var f = findRow_('Citas', 'id', appointmentId);
  if (!f) return jsonResponse_({ success: false, error: 'Cita no encontrada' });
  upsertRow_('Citas', 'id', { id: appointmentId, status: status });
  return jsonResponse_({ success: true, message: 'Estado de cita actualizado' });
}

function handleDeleteAppointment_(appointmentId) {
  if (!deleteById_('Citas', appointmentId)) return jsonResponse_({ success: false, error: 'Cita no encontrada' });
  return jsonResponse_({ success: true, message: 'Cita eliminada' });
}

/**
 * RESERVA ONLINE (la usa la tarjeta del cliente). Valida TODO en el servidor:
 * no se confía en lo que envía el navegador (precio, duración, horario libre).
 */
function handleBookAppointment_(p) {
  var date = String(p.date || '');
  var time = String(p.time || '');
  if (!isDateStr_(date) || !isTimeStr_(time)) {
    return jsonResponse_({ success: false, error: 'Fecha u hora inválida.' });
  }

  var client = findClientByCode_(p.code || '');
  if (!client || String(client.status) === 'archived') {
    return jsonResponse_({ success: false, error: 'Tarjeta no válida o inactiva.' });
  }

  var svc = findRow_('Servicios', 'id', p.serviceId || '');
  var service = svc ? rowToObj_(svc.t.headers, svc.values) : null;
  if (!service || !service.isActive) {
    return jsonResponse_({ success: false, error: 'El servicio seleccionado ya no está disponible.' });
  }

  var sch = scheduleSettings_();
  var today = todayStr_();
  if (date < today) return jsonResponse_({ success: false, error: 'No se puede reservar en una fecha pasada.' });
  if (date > addDays_(today, MAX_DAYS_AHEAD)) {
    return jsonResponse_({ success: false, error: 'Solo se puede reservar hasta ' + MAX_DAYS_AHEAD + ' días por adelantado.' });
  }
  if (sch.workingDays.indexOf(weekdayOf_(date)) < 0) {
    return jsonResponse_({ success: false, error: 'La barbería no atiende ese día.' });
  }

  var duration = Number(service.durationMinutes) || 30;
  var start = timeToMinutes_(time);
  var open = timeToMinutes_(sch.openTime);
  var close = timeToMinutes_(sch.closeTime);
  if (start < open || start + duration > close || (start - open) % sch.slotMinutes !== 0) {
    return jsonResponse_({ success: false, error: 'Ese horario está fuera del horario de atención.' });
  }
  if (date === today && start <= nowMinutes_()) {
    return jsonResponse_({ success: false, error: 'Ese horario ya pasó. Elige uno posterior.' });
  }

  var appts = getRowsAsObjects_('Citas');
  var concurrent = 0;
  var activeMine = 0;
  for (var i = 0; i < appts.length; i++) {
    var a = appts[i];
    if (a.status === 'cancelada') continue;
    if (a.clientId === client.id && String(a.date) >= today && a.status !== 'completada') activeMine++;
    if (String(a.date) !== date) continue;
    var as = timeToMinutes_(a.time);
    var ae = as + (Number(a.durationMinutes) || 30);
    if (start < ae && as < start + duration) concurrent++;
  }
  if (concurrent >= sch.capacity) {
    return jsonResponse_({ success: false, code: 'SLOT_TAKEN', error: 'Ese horario acaba de ocuparse. Elige otro.' });
  }
  if (activeMine >= MAX_ACTIVE_BOOKINGS_PER_CLIENT) {
    return jsonResponse_({
      success: false,
      error: 'Ya tienes ' + activeMine + ' citas pendientes. Completa o cancela una antes de reservar otra.'
    });
  }

  var notes = String(p.notes || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 200).trim();
  var appt = {
    id: newId_('APT'),
    clientId: client.id,
    clientName: client.name,
    clientPhone: client.phone,
    date: date,
    time: time,
    service: service.name,
    durationMinutes: duration,
    amount: Number(service.price) || 0,
    status: 'pendiente',
    barberName: 'Por asignar',
    notes: 'Reserva online.' + (notes ? ' ' + notes : ''),
    createdAt: new Date().toISOString()
  };
  upsertRow_('Citas', 'id', appt);

  return jsonResponse_({
    success: true,
    appointment: { id: appt.id, date: appt.date, time: appt.time, service: appt.service, status: appt.status }
  });
}

// ----------------------------------------------------------------------------
// SERVICIOS
// ----------------------------------------------------------------------------

function handleSaveService_(service) {
  if (!service || !service.name) return jsonResponse_({ success: false, error: 'El servicio necesita un nombre' });
  var obj = {};
  for (var k in service) obj[k] = service[k];
  if (!obj.id) obj.id = newId_('SRV');
  upsertRow_('Servicios', 'id', obj);
  return jsonResponse_({ success: true, service: obj });
}

function handleDeleteService_(serviceId) {
  if (!deleteById_('Servicios', serviceId)) return jsonResponse_({ success: false, error: 'Servicio no encontrado' });
  return jsonResponse_({ success: true, message: 'Servicio eliminado' });
}

function handleToggleService_(serviceId) {
  var f = findRow_('Servicios', 'id', serviceId);
  if (!f) return jsonResponse_({ success: false, error: 'Servicio no encontrado' });
  var s = rowToObj_(f.t.headers, f.values);
  upsertRow_('Servicios', 'id', { id: serviceId, isActive: !s.isActive });
  return jsonResponse_({ success: true, isActive: !s.isActive });
}

function handleResetServices_(services) {
  var list = (services && services.length) ? services : DEFAULT_SERVICES;
  var sheet = ss_().getSheetByName('Servicios');
  if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  bulkAppend_('Servicios', list, 'id');
  return jsonResponse_({ success: true, message: 'Catálogo restablecido' });
}

// ----------------------------------------------------------------------------
// SUBIDA INICIAL (datos locales -> Google Sheets). No pisa filas existentes.
// ----------------------------------------------------------------------------

function handleSyncAll_(data) {
  if (!data) return jsonResponse_({ success: false, error: 'Sin datos' });
  var added = {
    clients: bulkAppend_('Clientes', data.clients, 'id'),
    visits: bulkAppend_('Visitas', data.visits, 'id'),
    followUps: bulkAppend_('Seguimiento', data.followUps, 'id'),
    rewards: bulkAppend_('Recompensas', data.rewards, 'id'),
    appointments: bulkAppend_('Citas', data.appointments, 'id')
  };
  if (data.clients) {
    for (var i = 0; i < data.clients.length; i++) upsertCardRow_(data.clients[i]);
  }
  if (data.services && data.services.length) {
    // El catálogo local reemplaza al de ejemplo que crea el script
    handleResetServices_(data.services);
    added.services = data.services.length;
  }
  if (data.settings) handleSaveSettings_(data.settings);
  return jsonResponse_({ success: true, added: added });
}

// ----------------------------------------------------------------------------
// FUNCIONES PARA EJECUTAR A MANO DESDE EL EDITOR
// ----------------------------------------------------------------------------

/** Ejecuta esta función UNA VEZ: autoriza permisos y crea todas las hojas. */
function configurarInicial() {
  PropertiesService.getScriptProperties().deleteProperty('SCHEMA_VERSION');
  initDatabase();
  Logger.log('Listo. Hojas creadas: ' + Object.keys(SCHEMAS).join(', '));
  Logger.log('Zona horaria de la hoja: ' + tz_());
  Logger.log(getApiKey_() ? 'Clave de API configurada.' : 'ATENCIÓN: no hay clave de API (cualquiera con la URL podría leer tus datos).');
}

/** Opcional: guarda la clave de API como propiedad del script. Edita el valor y ejecútala. */
function guardarClaveApi() {
  var nueva = 'CAMBIA-ESTA-CLAVE-LARGA-Y-SECRETA';
  PropertiesService.getScriptProperties().setProperty('API_KEY', nueva);
  Logger.log('Clave guardada. Pégala también en el CRM: Configuración > Clave de API.');
}
