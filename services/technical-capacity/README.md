# technical-capacity

Servicio 5 de 8 del diseño: **qué ingenieros hay, qué saben hacer y cuánto están ocupados**, para que ventas no prometa lo que no se puede entregar (US-07).

- **Catálogo** de ingenieros con rol, habilidades y certificaciones (`GET/POST /engineers`; crear es solo del gerente).
- **Asignaciones** por porcentaje y período (`POST /engineers/{id}/allocations`, `DELETE /allocations/{id}`; líder de proyecto y gerente). **Nadie pasa de 100 % de carga en ningún día**: se bloquea la fila del ingeniero (`SELECT … FOR UPDATE`), se releen sus asignaciones DENTRO del bloqueo y solo entonces se decide, así dos asignaciones a la vez no suman por encima de 100. Pasarse responde 409 con el máximo que resultaría.
- **Excepción consciente:** solo el gerente puede pasar `allowOverallocation: true`; se acepta, queda marcada y se anuncia `OverAllocationDetected` con el máximo (llega a la campana de gerencia y ventas por Notifications).
- **Vista para ventas** (`GET /engineers`): carga de hoy, libre hoy, máximo de los próximos 30 días y las asignaciones que aún no terminan.
- **Eventos** por outbox transaccional (la asignación y su evento van en una sola transacción): `EngineerAllocated` (`capacity.engineer.allocated`) y `OverAllocationDetected` (`capacity.overallocation.detected`). Contrato en `docs/events.md`.
- Base y rol propios (`capacity`), mTLS con el gateway, puerto 4106.

Límites del MVP: no escucha `MilestoneApproved` ni `ProjectClosed` (el diseño lo prevé; las asignaciones se hacen a mano); el proyecto es un texto, no una referencia al servicio de proyectos (cada servicio es dueño de sus datos); sin edición de una asignación (se borra y se crea otra); jornada igual para todos (100 % = una jornada, sin festivos).

Pruebas: `npm test` (dominio y casos de uso) y `npm run test:e2e` (PostgreSQL y RabbitMQ reales, con carreras de 30 rondas).
