import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerFrom, type AnswerEvent } from '../../src/modules/help/answer.js';
import { networkOf } from '../../src/modules/help/help.service.js';
import { AnthropicProvider } from '../../src/modules/help/providers/anthropic.js';
import { OpenAiCompatibleProvider } from '../../src/modules/help/providers/openai-compatible.js';
import { priceOf } from '../../src/modules/help/providers/pricing.js';
import { costMicros, ProviderError, worstCaseMicros, type AnswerProvider, type ProviderEvent } from '../../src/modules/help/providers/types.js';

const price = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
const request = { system: 's'.repeat(300), messages: [{ role: 'user' as const, content: 'q'.repeat(300) }], maxTokens: 100, hits: [] };
const usage = (inputTokens: number, outputTokens: number) => ({ type: 'usage' as const, inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
const scripted = (model: string, steps: (ProviderEvent | Error | 'wait')[]): AnswerProvider => ({
  name: 'mock',
  model,
  price,
  async *answer({ signal }) {
    for (const s of steps) {
      if (s === 'wait') await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new ProviderError('stopped', false))));
      else if (s instanceof Error) throw s;
      else yield s;
    }
  },
});
const run = async (providers: AnswerProvider[], signal = new AbortController().signal) => {
  const events: AnswerEvent[] = [];
  let error: unknown = null;
  try {
    for await (const e of answerFrom(providers, request, signal)) events.push(e);
  } catch (e) {
    error = e;
  }
  const spent = events.filter((e) => e.type === 'spent').at(-1)!;
  return { text: events.map((e) => (e.type === 'text' ? e.text : '')).join(''), spent, done: events.find((e) => e.type === 'done'), error };
};

describe('answers and what they cost', () => {
  it('charges the reported usage, not the estimate, when the answer finishes', async () => {
    const r = await run([scripted('a', [usage(200, 1), { type: 'text', text: 'x'.repeat(900) }, usage(200, 40), { type: 'done', stop: 'end' }])]);
    expect(r.spent).toMatchObject({ cost: 200 + 40 * 5, attempts: 1 });
  });

  it('charges an answer that fails half-way, and does not start a second one', async () => {
    const r = await run([
      scripted('a', [usage(200, 1), { type: 'text', text: 'x'.repeat(300) }, new ProviderError('was cut off', true)]),
      scripted('b', [
        { type: 'text', text: 'B' },
        { type: 'done', stop: 'end' },
      ]),
    ]);
    expect(r.error).toBeInstanceOf(ProviderError);
    expect(r.text).not.toContain('B');
    expect(r.spent.cost).toBe(200 + 100 * 5);
  });

  it('asks the next provider when the first is busy, and adds both costs', async () => {
    const r = await run([scripted('a', [usage(50, 0), new ProviderError('answered 529', true)]), scripted('b', [usage(10, 2), { type: 'text', text: 'B' }, { type: 'done', stop: 'end' }])]);
    expect(r).toMatchObject({ text: 'B', spent: { model: 'b', attempts: 2, cost: 50 + 10 + 2 * 5 } });
  });

  it('does not ask another provider after a refusal or a bad request', async () => {
    const b = scripted('b', [
      { type: 'text', text: 'B' },
      { type: 'done', stop: 'end' },
    ]);
    expect((await run([scripted('a', [{ type: 'done', stop: 'refusal' }]), b])).done).toEqual({ type: 'done', stop: 'refusal' });
    expect((await run([scripted('a', [new ProviderError('answered 400', false)]), b])).text).toBe('');
  });

  it('charges the question when the visitor leaves before anything came back', async () => {
    const left = new AbortController();
    setTimeout(() => left.abort(), 20);
    const r = await run([scripted('a', ['wait']), scripted('b', [{ type: 'text', text: 'B' }])], left.signal);
    expect(r.text).toBe('');
    expect(r.spent.cost).toBe(200);
  });

  it('knows the most an answer can cost, and no price for an unknown model', () => {
    expect(worstCaseMicros(price, request)).toBe(Math.ceil(200 * 1.25 + 100 * 5));
    expect(costMicros(price, { inputTokens: 1, outputTokens: 1, cacheReadTokens: 10, cacheWriteTokens: 4 })).toBe(12);
    expect(priceOf('anthropic', 'claude-unknown', { input: null, output: null })).toBeNull();
    expect(priceOf('openai-compatible', 'claude-haiku-5-5', { input: null, output: null })).toBeNull();
  });

  it('counts an IPv6 household as one visitor', () => {
    expect(networkOf('2001:0db8:1:2:aaaa::1')).toBe(networkOf('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(networkOf('2001:db8:1:3::1')).not.toBe(networkOf('2001:db8:1:2::1'));
    expect([networkOf('::ffff:10.0.0.1'), networkOf('10.0.0.1'), networkOf(null)]).toEqual(['10.0.0.1', '10.0.0.1', 'unknown']);
  });
});

describe('providers against a fake service', () => {
  let server: Server;
  let base: string;
  let reply: (res: ServerResponse, body: string, req: IncomingMessage) => void;
  let seen: { url?: string; auth?: string; key?: string; body: Record<string, unknown> };
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        seen = { url: req.url, auth: req.headers.authorization, key: String(req.headers['x-api-key'] ?? req.headers.authorization), body: JSON.parse(body) };
        reply(res, body, req);
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  const collect = async (p: AnswerProvider, signal = new AbortController().signal) => {
    const events: ProviderEvent[] = [];
    for await (const e of p.answer({ ...request, signal })) events.push(e);
    return events;
  };
  const stream = (res: ServerResponse, frames: string[]) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const f of frames) res.write(f);
    res.end();
  };
  const oa = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
  const an = (o: { type: string }) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;

  it('reads an OpenAI-style stream: text, usage, stop reason, and sends the key in a header', async () => {
    reply = (res) =>
      stream(res, [
        oa({ choices: [{ delta: { content: 'Open ' } }] }),
        oa({ choices: [{ delta: { content: 'Jobs' } }] }),
        oa({ choices: [{ delta: {}, finish_reason: 'length' }] }),
        oa({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
        'data: [DONE]\n\n',
      ]);
    const e = await collect(new OpenAiCompatibleProvider(`${base}/v1`, 'key', 'm', price));
    expect(e.filter((x) => x.type === 'text').map((x) => x.text)).toEqual(['Open ', 'Jobs']);
    expect(e.filter((x) => x.type === 'usage').at(-1)).toMatchObject({ inputTokens: 12, outputTokens: 3 });
    expect(e.at(-1)).toEqual({ type: 'done', stop: 'length' });
    expect(seen).toMatchObject({ url: '/v1/chat/completions', auth: 'Bearer key', body: { model: 'm', stream: true, stream_options: { include_usage: true } } });
    expect((seen.body.messages as { role: string }[])[0].role).toBe('system');
  });

  it('treats busy and down as worth trying elsewhere, a bad request as not, and a dropped stream as a failure', async () => {
    const p = new OpenAiCompatibleProvider(base, null, 'm', price);
    for (const [status, retryable] of [
      [429, true],
      [503, true],
      [400, false],
      [401, false],
    ] as const) {
      reply = (res) => res.writeHead(status).end('secret detail');
      await expect(collect(p)).rejects.toMatchObject({ retryable, message: expect.not.stringContaining('secret') });
    }
    reply = (res) => stream(res, [oa({ choices: [{ delta: { content: 'Half' } }] })]);
    await expect(collect(p)).rejects.toMatchObject({ message: 'was cut off' });
    await expect(collect(new OpenAiCompatibleProvider('http://127.0.0.1:1', null, 'm', price))).rejects.toMatchObject({ retryable: true });
  });

  it('never follows a redirect with the key', async () => {
    reply = (res) => res.writeHead(302, { Location: 'http://127.0.0.1:1/steal' }).end();
    await expect(collect(new OpenAiCompatibleProvider(base, 'key', 'm', price))).rejects.toBeInstanceOf(ProviderError);
  });

  const claude = (stop: string, text = 'Open Jobs') => [
    an({
      type: 'message_start',
      message: {
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 1, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 },
      },
    } as never),
    an({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } as never),
    an({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as never),
    an({ type: 'content_block_stop', index: 0 } as never),
    an({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 9 } } as never),
    an({ type: 'message_stop' }),
  ];

  it('reads Claude through the SDK: usage from the start, cache tokens apart, and the stop reason', async () => {
    reply = (res) => stream(res, claude('max_tokens'));
    const e = await collect(new AnthropicProvider('sk', 'claude-haiku-5-5', price, base));
    expect(e[0]).toEqual({ type: 'usage', inputTokens: 20, outputTokens: 1, cacheReadTokens: 5, cacheWriteTokens: 7 });
    expect(e.filter((x) => x.type === 'usage').at(-1)).toEqual({ type: 'usage', inputTokens: 20, outputTokens: 9, cacheReadTokens: 5, cacheWriteTokens: 7 });
    expect(e.at(-1)).toEqual({ type: 'done', stop: 'length' });
    expect(seen).toMatchObject({ key: expect.stringMatching(/(^|Bearer )sk$/), body: { model: 'claude-haiku-5-5', output_config: { effort: 'low' } } });
    reply = (res) => stream(res, claude('refusal'));
    expect((await collect(new AnthropicProvider('sk', 'claude-haiku-5-5', price, base))).at(-1)).toEqual({ type: 'done', stop: 'refusal' });
  });

  it('leaves out effort for models that refuse it, and sorts Claude errors', async () => {
    reply = (res) => stream(res, claude('end_turn'));
    await collect(new AnthropicProvider('sk', 'claude-haiku-4-5', price, base));
    expect(seen.body).not.toHaveProperty('output_config');
    for (const [status, retryable] of [
      [529, true],
      [429, true],
      [400, false],
      [401, false],
    ] as const) {
      reply = (res) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'x', message: 'secret detail' } }));
      await expect(collect(new AnthropicProvider('sk', 'claude-haiku-5-5', price, base))).rejects.toMatchObject({ name: 'ProviderError', retryable, message: expect.not.stringContaining('secret') });
    }
  });

  it('stops at once when the visitor leaves', async () => {
    let closed = false;
    reply = (res, _body, req) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(claude('end_turn')[0]);
      req.socket.on('close', () => (closed = true));
    };
    const left = new AbortController();
    setTimeout(() => left.abort(), 100);
    await expect(collect(new AnthropicProvider('sk', 'claude-haiku-5-5', price, base), left.signal)).rejects.toMatchObject({ message: 'stopped', retryable: false });
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(true);
  });
});
