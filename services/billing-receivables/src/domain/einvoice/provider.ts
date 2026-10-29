/**
 * Puerto hacia el proveedor tecnológico autorizado por la DIAN (el que firma, envía y recibe la validación). HOY solo existe el adaptador de sandbox: no hay
 * proveedor, certificado de firma ni habilitación reales. Cuando los haya, se escribe otro adaptador sin tocar el resto.
 */
export interface EInvoiceSubmission { ref: string; status: 'sandbox_simulated' }
export interface EInvoiceProvider {
  submit(doc: { number: string; cufe: string }): Promise<EInvoiceSubmission>;
}

/** Simula el envío: devuelve una referencia inventada y el estado `sandbox_simulated`. NUNCA «aceptada»: nadie validó nada. */
export class SandboxEInvoiceProvider implements EInvoiceProvider {
  constructor(private readonly newRef: () => string = () => `SANDBOX-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`) {}
  async submit(): Promise<EInvoiceSubmission> {
    return { ref: this.newRef(), status: 'sandbox_simulated' };
  }
}
