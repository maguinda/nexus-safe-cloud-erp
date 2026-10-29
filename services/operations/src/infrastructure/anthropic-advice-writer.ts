import { Logger } from '@nestjs/common';
import { AdviceWriter } from '../domain/ports';

/** Llama a la API de mensajes de Anthropic con `fetch` (sin SDK). Solo lee la respuesta; nunca la deja en un mensaje de error, y la llave nunca sale de aquí. */
export class AnthropicAdviceWriter implements AdviceWriter {
  private readonly log = new Logger('advisor');

  constructor(private readonly apiKey: string, private readonly model: string, private readonly baseUrl: string = 'https://api.anthropic.com') {}

  async write(prompt: { system: string; user: string }, signal: AbortSignal): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      // max_tokens alto: el modelo gasta parte en pensar y con 1500 la respuesta llegaba cortada a la mitad (visto con la llave real).
      // Sin `temperature`: Sonnet 5.5 lo rechaza («is deprecated for this model»), como se vio con la llave real.
      body: JSON.stringify({ model: this.model, max_tokens: 6000, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }),
    });
    if (!res.ok) {
      // Solo el código y el tipo de error (nunca el cuerpo ni la llave): así un fallo del proveedor deja rastro en el log y no se pierde en silencio.
      const type = ((await res.json().catch(() => null)) as { error?: { type?: string } } | null)?.error?.type ?? 'unknown';
      this.log.warn(`the advice provider answered ${res.status} (${type}); the rules answer is used`);
      throw new Error(`advice provider answered ${res.status}`);
    }
    const body = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
    if (body.stop_reason === 'max_tokens') {
      this.log.warn('the advice provider cut its answer at the token limit; the rules answer is used');
      throw new Error('advice provider answer was cut at the token limit');
    }
    const text = body.content?.find((c) => c.type === 'text')?.text;
    if (typeof text !== 'string') throw new Error('advice provider answered without text');
    return text;
  }
}
