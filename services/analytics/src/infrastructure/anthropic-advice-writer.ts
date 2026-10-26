import { AdviceWriter } from '../domain/ports';

/** Llama a la API de mensajes de Anthropic con `fetch` (sin SDK). Solo lee la respuesta; nunca la deja en un mensaje de error, y la llave nunca sale de aquí. */
export class AnthropicAdviceWriter implements AdviceWriter {
  constructor(private readonly apiKey: string, private readonly model: string, private readonly baseUrl: string = 'https://api.anthropic.com') {}

  async write(prompt: { system: string; user: string }, signal: AbortSignal): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 1500, temperature: 0, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }),
    });
    if (!res.ok) throw new Error(`advice provider answered ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === 'text')?.text;
    if (typeof text !== 'string') throw new Error('advice provider answered without text');
    return text;
  }
}
