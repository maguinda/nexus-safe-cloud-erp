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
