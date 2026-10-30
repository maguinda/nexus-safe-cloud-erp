-- Un contrato puede nacer de una cotización aprobada (evento QuoteApproved de Projects). La referencia es única: el mismo evento dos veces no crea dos contratos.
ALTER TABLE "contracts" ADD COLUMN "quote_ref" TEXT;
CREATE UNIQUE INDEX "contracts_quote_ref_key" ON "contracts"("quote_ref");
