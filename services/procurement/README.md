# procurement

Servicio 7 de 8 del diseño: **proveedores, pedidos de compra y existencias** de equipos y repuestos (US-08).

- `GET/POST /suppliers`, `GET /inventory`, `POST /inventory/items`, `POST /inventory/items/{id}/adjust`, `GET/POST /orders`, `POST /orders/{id}/receive|cancel`, `GET /inventory/suggestions`. Leen gerencia, líder de proyecto y facturación; **escribe solo gerencia**.
- Un pedido nace **pendiente**; solo al **recibirlo** sube el stock, **una vez** (se bloquea el pedido y luego el artículo, siempre en ese orden). El stock nunca baja de 0.
- Publica `StockChanged` y `EquipmentPurchased` por outbox (misma transacción) y escucha `ThresholdBreached` para sugerir repuestos. Contratos en `docs/events.md`.
- Base y rol propios (`procurement`), mTLS con el gateway, puerto 4108.

Límites: un artículo por pedido, sin recepciones parciales; Operations aún no escucha `EquipmentPurchased`.

Pruebas: `npm test` y `npm run test:e2e` (PostgreSQL y RabbitMQ reales; el `.env` se copia de `.env.example`).
