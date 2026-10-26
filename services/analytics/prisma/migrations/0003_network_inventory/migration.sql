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
