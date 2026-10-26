# Guía de despliegue · CRM Barbería

Tiempo estimado: 20 minutos. No necesitas servidor propio: los datos viven en **Google Sheets** y el backend es **Google Apps Script** (gratis).

## Qué incluye el sistema

- **Agenda de citas** (manual desde el panel y reserva online desde la tarjeta del cliente, con cupo por número de barberos).
- **Tarjeta de fidelidad con premios por niveles**, configurables en *Ajustes*. Por defecto: 5 cortes → 20 % de descuento, 10 cortes → corte gratis (el ciclo reinicia al canjear el último nivel).
- **Seguimiento**: clientes inactivos (7/14/21/30+ días), plantillas de WhatsApp, bitácora de contactos.
- **Panel de rendimiento**: ingresos, comparación con el mes anterior, ticket promedio, servicios top, citas de hoy.
- **Servicios y tarifas** administrables.
- Optimizado para móvil: menú inferior, botón flotante (+), formularios tipo hoja inferior, botones táctiles.

---

## Parte 1 · Backend en Google Sheets + Apps Script

1. Entra a <https://sheets.new> con tu cuenta de Google y llama a la hoja, por ejemplo, **Barber CRM - Datos**.
2. **Archivo > Configuración**: revisa que la **zona horaria** sea la de tu barbería (se usa para "hoy" y para validar reservas).
3. **Extensiones > Apps Script**. Borra el contenido de `Code.gs` y pega el contenido de `backend/Code.gs` (o usa el botón *Copiar Code.gs* en **Ajustes** de la app). Guarda (Ctrl+S).
4. **Clave de administrador.** En `guardarClaveApi()` cambia `CAMBIA-ESTA-CLAVE-LARGA-Y-SECRETA` por una clave larga (20+ caracteres). Selecciona la función `guardarClaveApi` en la barra superior y pulsa **Ejecutar**. La clave queda guardada en las *Propiedades del script*.
   - Sin clave, cualquiera que conozca la URL podría leer y modificar tus datos. No la dejes vacía en producción.
5. Selecciona `configurarInicial` y pulsa **Ejecutar**. Google pedirá permisos: *Revisar permisos > tu cuenta > Configuración avanzada > Ir al proyecto (no seguro) > Permitir*. Esto crea las 8 pestañas: `Clientes, Visitas, Tarjetas, Seguimiento, Recompensas, Configuracion, Citas, Servicios`.
6. **Implementar > Nueva implementación > Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
   - Pulsa **Implementar** y copia la URL que termina en `/exec`.
7. Cuando cambies `Code.gs` más adelante: **Implementar > Administrar implementaciones > ✏️ > Versión: Nueva versión**. La URL no cambia.

> La clave de API protege todo menos tres acciones públicas que necesita la tarjeta del cliente: `ping`, `getClientCard` (nombre, sellos y premios; nunca teléfono ni gastos) y `bookAppointment` (la reserva se valida en el servidor: día, horario, cupo y máximo 3 citas pendientes por cliente).

## Parte 2 · Variables de entorno (conectar la app)

Hay dos formas; la recomendada es la **variable de entorno**, porque así los enlaces de tarjeta que reciben tus clientes funcionan en cualquier celular.

1. Copia `.env.example` a `.env` y completa:

   ```
   VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycb.../exec
   ```

2. La **clave de administrador no va en el `.env`** (quedaría pública en el código). Se escribe una vez en cada dispositivo de trabajo: **Ajustes > Conexión > Clave de administrador**, y se guarda solo en ese dispositivo.
3. En **Ajustes** pulsa **Probar conexión**: debe mostrar "Conexión verificada… acceso protegido con clave" y el conteo de clientes/visitas/citas/servicios.
4. Si ya habías usado la app en modo local y la hoja está vacía, aparecerá el aviso **"Subir mis datos a Google Sheets"**. Púlsalo una vez.

Alternativa sin `.env`: pega la URL directamente en Ajustes. Los enlaces de tarjeta incluirán entonces el identificador del script (`&s=...`) para que funcionen igualmente.

## Parte 3 · Publicar la web

Requisitos: Node 18+.

```bash

npm run build        # genera la carpeta dist/
```

Sube `dist/` a cualquier hosting estático (HTTPS obligatorio):

| Hosting | Pasos |
|---|---|
| **Netlify** | Arrastra la carpeta `dist` a <https://app.netlify.com/drop>. Si lo conectas a Git: build `npm run build`, publish `dist`, y añade `VITE_APPS_SCRIPT_URL` en *Site settings > Environment variables*. |
| **Vercel** | Importa el repo; framework *Vite*; añade `VITE_APPS_SCRIPT_URL` en *Environment Variables*. |
| **GitHub Pages** | En `vite.config.ts` pon `base: '/nombre-del-repo/'`, haz build y publica `dist` (rama `gh-pages` o GitHub Actions). |

> Importante: `VITE_APPS_SCRIPT_URL` se incrusta **al compilar**. Si la cambias, vuelve a hacer el build/deploy.

Para desarrollo local: `npm run dev` y abre <http://localhost:3000>.

## Parte 4 · Uso diario desde el celular

1. Abre la web en el celular del barbero y **Añadir a pantalla de inicio** (Chrome: ⋮ > *Instalar app*; Safari: Compartir > *Añadir a pantalla de inicio*).
2. En **Ajustes > Conexión** escribe la clave de administrador (solo la primera vez).
3. Configura en **Ajustes**: nombre, teléfono, **niveles de premio**, horario, días de apertura y **barberos** (la cantidad de barberos define cuántas citas pueden coincidir a la misma hora).
4. Revisa **Servicios** (precios y duración).
5. Para cada cliente: **Clientes > Nuevo cliente**, y en la ficha usa **Tarjeta** para enviarle por WhatsApp el enlace de su tarjeta digital. Desde ese enlace el cliente ve sus sellos, sus premios y **reserva su cita**.
6. Al atender: botón **+ > Registrar visita** (o **Completar y sellar** desde la cita). Cuando el cliente llegue al nivel, aparecerá el botón **Canjear** (en Clientes, Panel y al registrar la visita).

## Sincronización y sin conexión

- La app guarda localmente y envía a Sheets en segundo plano; si no hay señal, los cambios quedan en cola y se reenvían solos (el indicador de la barra superior muestra cuántos faltan).
- Cada visita lleva una llave de idempotencia: un reintento por mala señal **no duplica el sello**.
- Edita datos desde la hoja con cuidado: respeta los encabezados y no cambies los `id`. Las columnas de teléfono/fecha/hora están en formato texto para que Sheets no convierta `+58…` ni `2026-10-20`.

## Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| "Clave de API incorrecta" | La clave en *Ajustes* no coincide con la guardada en Apps Script (`guardarClaveApi`). |
| "Sin conexión con Sheets" | Revisa internet; la URL debe terminar en `/exec` y la implementación debe tener acceso "Cualquier persona". |
| Cambié `Code.gs` y no se nota | Falta *Nueva versión* en *Administrar implementaciones*. |
| La tarjeta del cliente dice "no encontrada" | El enlace se abrió en un sitio compilado sin `VITE_APPS_SCRIPT_URL` y sin `&s=`: genera el enlace de nuevo desde la app. |
| Horarios fuera de hora/zona | Ajusta la zona horaria en *Archivo > Configuración* de la hoja. |
| Límite de Google | Apps Script gratuito admite miles de operaciones diarias, más que suficiente para una barbería. |

## Seguridad: checklist

- [ ] Clave de administrador larga configurada en Apps Script.
- [ ] La clave **no** está en el `.env` ni en el repositorio.
- [ ] La hoja de Google **no** se comparte con personas ajenas (contiene teléfonos).
- [ ] El sitio se sirve por HTTPS.
- [ ] Los clientes dieron consentimiento antes de recibir mensajes de marketing (campo `marketingConsent`).
npm install