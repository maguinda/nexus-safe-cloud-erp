import http from 'http';
import { AddressInfo } from 'net';

export interface StubCall { method: string; orderId: string; body: any; auth: string | undefined; correlation: string | undefined }
export type StubMode = 'ok' | 'conflict' | 'notfound' | 'invalid' | 'down' | 'slow';

/** Un Technical Capacity de mentira para las pruebas de Operations: guarda lo reservado por orden y se puede poner a rechazar, caerse o tardar. */
export class CapacityStub {
  mode: StubMode = 'ok';
  /** Si es mayor que 0, la siguiente respuesta tarda tanto (ms) en llegar. */
  delayMs = 0;
  calls: StubCall[] = [];
  reserved = new Map<string, any>();
  private server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const orderId = (req.url ?? '').split('/').pop() ?? '';
      let body: any = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* DELETE */ }
      this.calls.push({ method: req.method ?? '', orderId, body, auth: req.headers.authorization, correlation: req.headers['x-correlation-id'] as string | undefined });
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      const send = (status: number, json?: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(json ? JSON.stringify(json) : undefined); };
      if (this.mode === 'down') return send(503, { message: 'down' });
      if (req.method === 'DELETE') { this.reserved.delete(orderId); return send(204); }
      if (this.mode === 'conflict') return send(409, { statusCode: 409, message: 'Hugo Salazar would be allocated at 110% (the limit is 100%)' });
      if (this.mode === 'notfound') return send(404, { statusCode: 404, message: 'Engineer not found' });
      if (this.mode === 'invalid') return send(400, { statusCode: 400, message: 'percent must be a whole number from 1 to 100' });
      this.reserved.set(orderId, body);
      return send(200, { allocationId: 'a-' + orderId, peak: body.percent, overAllocated: false });
    });
  });
  async start() { await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r())); return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`; }
  async stop() { await new Promise<void>((r) => this.server.close(() => r())); }
  reset() { this.mode = 'ok'; this.delayMs = 0; this.calls = []; this.reserved.clear(); }
}
