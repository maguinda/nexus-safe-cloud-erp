-- Operations & Telemetry: sensores IoT, lecturas e inventario de red (equivale a las migraciones 0002 a 0004 de analytics, de donde salió este servicio).
-- CreateTable
CREATE TABLE "iot_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "vlan" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "mac_address" TEXT NOT NULL,
    "connection" TEXT NOT NULL,
    "reading_kind" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "iot_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iot_readings" (
    "id" INTEGER NOT NULL,
    "device_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "iot_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "iot_devices_location_idx" ON "iot_devices"("location");

-- CreateIndex
CREATE INDEX "iot_readings_recorded_at_idx" ON "iot_readings"("recorded_at");

-- CreateIndex
CREATE INDEX "iot_readings_status_recorded_at_idx" ON "iot_readings"("status", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "iot_readings_device_id_recorded_at_key" ON "iot_readings"("device_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "iot_readings" ADD CONSTRAINT "iot_readings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "iot_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas que Prisma no expresa: la base rechaza lo que la lógica nunca debería guardar.
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_connection_check" CHECK ("connection" IN ('ONLINE', 'OFFLINE'));
ALTER TABLE "iot_readings" ADD CONSTRAINT "iot_readings_status_check" CHECK (length("status") > 0);
-- Un NaN o un infinito no es una medida (Postgres los acepta en DOUBLE PRECISION). Ojo: en Postgres NaN = NaN es verdadero,
-- así que «value = value» no sirve para detectarlo; hay que compararlo con el literal.
ALTER TABLE "iot_readings" ADD CONSTRAINT "iot_readings_value_finite_check" CHECK ("value" NOT IN ('NaN', 'Infinity', '-Infinity'));
-- CreateTable
CREATE TABLE "network_devices" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "pt_type" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "ips" TEXT,
    "gateways" TEXT,

    CONSTRAINT "network_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_links" (
    "id" INTEGER NOT NULL,
    "origin_name" TEXT NOT NULL,
    "origin_port" TEXT NOT NULL,
    "destination_name" TEXT NOT NULL,
    "destination_port" TEXT NOT NULL,
    "link_type" TEXT NOT NULL,
    "cable_type" TEXT,
    "functional" BOOLEAN,
    "length" DOUBLE PRECISION,
    "criticality" TEXT NOT NULL,

    CONSTRAINT "network_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_monitoring" (
    "device_name" TEXT NOT NULL,
    "syslog" BOOLEAN NOT NULL,
    "snmp" BOOLEAN NOT NULL,
    "ntp" BOOLEAN NOT NULL,
    "netflow" BOOLEAN NOT NULL,
    "signals" TEXT[],

    CONSTRAINT "network_monitoring_pkey" PRIMARY KEY ("device_name")
);

-- CreateIndex
CREATE UNIQUE INDEX "network_devices_name_key" ON "network_devices"("name");

-- CreateIndex
CREATE INDEX "network_devices_category_idx" ON "network_devices"("category");

-- CreateIndex
CREATE INDEX "network_devices_criticality_idx" ON "network_devices"("criticality");

-- CreateIndex
CREATE INDEX "network_links_origin_name_idx" ON "network_links"("origin_name");

-- CreateIndex
CREATE INDEX "network_links_destination_name_idx" ON "network_links"("destination_name");

-- CreateIndex
CREATE INDEX "network_links_link_type_idx" ON "network_links"("link_type");

-- AddForeignKey
ALTER TABLE "network_links" ADD CONSTRAINT "network_links_origin_name_fkey" FOREIGN KEY ("origin_name") REFERENCES "network_devices"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_links" ADD CONSTRAINT "network_links_destination_name_fkey" FOREIGN KEY ("destination_name") REFERENCES "network_devices"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_monitoring" ADD CONSTRAINT "network_monitoring_device_name_fkey" FOREIGN KEY ("device_name") REFERENCES "network_devices"("name") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas que Prisma no expresa: la base rechaza lo que el inventario nunca debería traer.
ALTER TABLE "network_devices" ADD CONSTRAINT "network_devices_criticality_check" CHECK ("criticality" IN ('Crítica', 'Alta', 'Media'));
ALTER TABLE "network_links" ADD CONSTRAINT "network_links_criticality_check" CHECK ("criticality" IN ('Crítica', 'Alta', 'Media'));
-- Una longitud negativa, NaN o infinita no es una medida (en Postgres NaN = NaN es verdadero: se compara con el literal).
ALTER TABLE "network_links" ADD CONSTRAINT "network_links_length_check" CHECK ("length" IS NULL OR ("length" >= 0 AND "length" NOT IN ('NaN', 'Infinity')));
-- Un enlace no puede unir un dispositivo consigo mismo por el mismo puerto.
ALTER TABLE "network_links" ADD CONSTRAINT "network_links_not_self_port_check" CHECK ("origin_name" <> "destination_name" OR "origin_port" <> "destination_port");
-- Las lecturas del seed traen su id de la fuente (1 a 4200); las que llegan después por la API de ingesta lo genera la base.
-- «BY DEFAULT» (no «ALWAYS»): el seed y las pruebas siguen pudiendo escribir ids explícitos.
ALTER TABLE "iot_readings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY;

-- La secuencia arranca justo después del id más alto que ya existe, para no chocar con las lecturas cargadas.
SELECT setval(pg_get_serial_sequence('"iot_readings"', 'id'), (SELECT COALESCE(MAX("id"), 0) + 1 FROM "iot_readings"), false);
