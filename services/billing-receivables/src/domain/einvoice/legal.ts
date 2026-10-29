/**
 * Aviso que acompaña a TODO documento electrónico que genera este servicio (XML, HTML y API). Mientras no haya un proveedor tecnológico autorizado por la DIAN,
 * un certificado de firma, una resolución de numeración vigente y el ambiente de producción conectado, este documento NO es una factura electrónica válida.
 */
export const LEGAL_NOTICE_ES = 'SANDBOX – SIN VALIDEZ LEGAL. Este documento no está firmado, no fue enviado a la DIAN y no es una factura electrónica de venta válida.';
export const LEGAL_NOTICE_EN = 'SANDBOX – NO LEGAL VALIDITY. This document is not signed, was not sent to the DIAN and is not a valid electronic sales invoice.';

export type EInvoiceEnvironment = 'sandbox';
/** Códigos de ambiente del Anexo Técnico: 1 producción, 2 habilitación/pruebas. Este servicio solo genera el 2. */
export const ENVIRONMENT_CODE: Record<EInvoiceEnvironment, '2'> = { sandbox: '2' };

/** Estados del documento. NO existe `accepted`: el sandbox no habla con la DIAN y no puede decir que algo fue aceptado. */
export type EInvoiceStatus = 'generated' | 'sandbox_simulated';
