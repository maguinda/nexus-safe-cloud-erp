# notifications

Servicio 8 de 8 del diseño: **el mensajero**. Ningún otro servicio manda avisos; publican un evento y este lo convierte en un aviso dentro de la app (la campana del encabezado).

- **Escucha** (`q.notifications`, con cola de mensajes muertos `q.notifications.dlq`): `OverdueDetected` (billing), `ThresholdBreached` (operations-telemetry) y `OverAllocationDetected` (technical-capacity). Contrato en `docs/events.md`.
- **Guarda** un aviso por evento (idempotente por `eventId`, en una sola transacción) y SOLO lo que se muestra: tipo, gravedad, qué roles lo ven y unos pocos datos. Ningún dato personal.
- **API** (cualquier rol con sesión; cada quien ve los avisos de SU rol y sus propias marcas de lectura): `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `POST /notifications/{id}/read`. Un aviso de otro rol responde 404, igual que uno que no existe.
- **Texto en la pantalla, no en la base:** la web escribe el mensaje en el idioma de cada persona a partir del tipo y los datos.
- **Base propia** (`notifications`, PostgreSQL), mTLS con el gateway, puerto 4105 (Swagger en 4105 con `docker-compose.docs.yml`).

Límites del MVP: el único canal es la campana (sin correo ni chat; agregar uno no tocaría a los demás servicios); no hay preferencias por persona ni retención (los avisos no se borran); no publica `NotificationSent`.

Pruebas: `npm test` (dominio y caso de uso) y `npm run test:e2e` (PostgreSQL y RabbitMQ reales; con `.env` copiado de `.env.example`).
