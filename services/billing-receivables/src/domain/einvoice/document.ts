import { EInvoiceNotReadyError } from '../errors';
import { computeTotals } from '../tax';
import { computeCufe, money } from './cufe';
import { ENVIRONMENT_CODE, EInvoiceEnvironment, LEGAL_NOTICE_EN, LEGAL_NOTICE_ES } from './legal';
import { xmlEscape as x } from './xml';

export interface Party { nit: string; dv: number; name: string; address: string; city: string; email: string }

export interface EInvoiceInput {
  invoice: { number: string; projectName: string; milestoneName: string; amountCop: number; taxCop: number; totalCop: number; issuedAt: Date; dueDate: Date };
  supplier: Party;
  customer: Party;
  numbering: { prefix: string; consecutive: number };
  environment: EInvoiceEnvironment;
  technicalKey: string;
  /** Base de la dirección que va en el QR (sandbox: nunca la de la DIAN real, porque este documento no existe allá). */
  verifyUrlBase: string;
}

export interface EInvoiceDoc {
  number: string;
  prefix: string;
  consecutive: number;
  issueDate: string;
  issueTime: string;
  dueDate: string;
  cufe: string;
  qrText: string;
  xml: string;
  /** La copia de los datos de las dos partes en el momento de generar: el documento nunca cambia si después cambia el cliente. */
  supplier: Party;
  customer: Party;
}

const COLOMBIA_OFFSET_MS = 5 * 3_600_000; // Colombia es UTC-5 todo el año (sin horario de verano)

/** Un solo reloj: la misma fecha de emisión alimenta el vencimiento, el CUFE y el XML. */
export function colombiaDateTime(utc: Date): { date: string; time: string } {
  const iso = new Date(utc.getTime() - COLOMBIA_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: `${iso.slice(11, 19)}-05:00` };
}

const party = (tag: 'AccountingSupplierParty' | 'AccountingCustomerParty', p: Party) => `  <cac:${tag}>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName><cbc:Name>${x(p.name)}</cbc:Name></cac:PartyName>
      <cac:PhysicalLocation><cac:Address><cbc:CityName>${x(p.city)}</cbc:CityName><cac:AddressLine><cbc:Line>${x(p.address)}</cbc:Line></cac:AddressLine><cac:Country><cbc:IdentificationCode>CO</cbc:IdentificationCode></cac:Country></cac:Address></cac:PhysicalLocation>
      <cac:PartyTaxScheme><cbc:RegistrationName>${x(p.name)}</cbc:RegistrationName><cbc:CompanyID schemeAgencyID="195" schemeID="${p.dv}" schemeName="31">${x(p.nit)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
      <cac:Contact><cbc:ElectronicMail>${x(p.email)}</cbc:ElectronicMail></cac:Contact>
    </cac:Party>
  </cac:${tag}>`;

/** Genera el documento: números del libro (nunca se recalculan), CUFE, texto del QR y XML UBL 2.1 SIN FIRMAR. */
export function buildElectronicInvoice(i: EInvoiceInput): EInvoiceDoc {
  const inv = i.invoice;
  // El XML dice «IVA 19 %»: solo se escribe si los montos del libro de verdad son los de esa regla (y suman). Nunca se «arreglan» montos.
  const expected = computeTotals(inv.amountCop);
  if (inv.taxCop !== expected.taxCop || inv.totalCop !== expected.totalCop) throw new EInvoiceNotReadyError('the invoice totals do not follow the 19 % IVA rule');
  if (!Number.isSafeInteger(i.numbering.consecutive) || i.numbering.consecutive < 1) throw new RangeError('consecutive must be a positive integer');
  const number = `${i.numbering.prefix}${i.numbering.consecutive}`;
  const issued = colombiaDateTime(inv.issuedAt);
  // El vencimiento es el MISMO instante + 30 días: su fecha en hora de Colombia es la de emisión + 30 (la emisión y el vencimiento usan la misma zona).
  const due = colombiaDateTime(inv.dueDate).date;
  const cufe = computeCufe({
    number, issueDate: issued.date, issueTime: issued.time, subtotalCop: inv.amountCop, ivaCop: inv.taxCop, totalCop: inv.totalCop,
    supplierNit: i.supplier.nit, customerNit: i.customer.nit, technicalKey: i.technicalKey, environmentCode: ENVIRONMENT_CODE[i.environment],
  });
  const qrText = [
    `NumFac: ${number}`, `FecFac: ${issued.date}`, `HorFac: ${issued.time}`, `NitFac: ${i.supplier.nit}`, `DocAdq: ${i.customer.nit}`,
    `ValFac: ${money(inv.amountCop)}`, `ValIva: ${money(inv.taxCop)}`, 'ValOtroIm: 0.00', `ValTolFac: ${money(inv.totalCop)}`, `CUFE: ${cufe}`, `${i.verifyUrlBase}${cufe}`,
  ].join('\n');
  const description = `${inv.milestoneName} (${inv.projectName})`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${LEGAL_NOTICE_ES} / ${LEGAL_NOTICE_EN} -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><!-- SIN FIRMAR: aquí iría la firma XAdES-EPES del certificado del emisor; este sandbox no firma --></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>${ENVIRONMENT_CODE[i.environment]}</cbc:ProfileExecutionID>
  <cbc:ID>${x(number)}</cbc:ID>
  <cbc:UUID schemeID="${ENVIRONMENT_CODE[i.environment]}" schemeName="CUFE-SHA384">${cufe}</cbc:UUID>
  <cbc:IssueDate>${issued.date}</cbc:IssueDate>
  <cbc:IssueTime>${issued.time}</cbc:IssueTime>
  <cbc:DueDate>${due}</cbc:DueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:Note>${x(LEGAL_NOTICE_ES)}</cbc:Note>
  <cbc:Note>${x(LEGAL_NOTICE_EN)}</cbc:Note>
  <cbc:Note>${x(`Factura interna ${inv.number}`)}</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
${party('AccountingSupplierParty', i.supplier)}
${party('AccountingCustomerParty', i.customer)}
  <cac:PaymentMeans><cbc:ID>2</cbc:ID><cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode><cbc:PaymentDueDate>${due}</cbc:PaymentDueDate></cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">${money(inv.taxCop)}</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">${money(inv.amountCop)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="COP">${money(inv.taxCop)}</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">${money(inv.amountCop)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">${money(inv.amountCop)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">${money(inv.totalCop)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">${money(inv.totalCop)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">${money(inv.amountCop)}</cbc:LineExtensionAmount>
    <cac:TaxTotal><cbc:TaxAmount currencyID="COP">${money(inv.taxCop)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">${money(inv.amountCop)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="COP">${money(inv.taxCop)}</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Description>${x(description)}</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="COP">${money(inv.amountCop)}</cbc:PriceAmount><cbc:BaseQuantity unitCode="EA">1</cbc:BaseQuantity></cac:Price>
  </cac:InvoiceLine>
</Invoice>
`;
  return { number, prefix: i.numbering.prefix, consecutive: i.numbering.consecutive, issueDate: issued.date, issueTime: issued.time, dueDate: due, cufe, qrText, xml, supplier: i.supplier, customer: i.customer };
}
