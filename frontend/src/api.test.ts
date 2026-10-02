import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculate, CalculationError } from './api';

const input = { operation: 'add' as const, a: 2, b: 3 };
const signal = () => new AbortController().signal;

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('calculator API client', () => {
  it('posts the exact contract and returns the server result, including zero', async () => {
    const fetchMock = respond({ result: 0 });
    const requestSignal = signal();
    await expect(calculate(input, requestSignal)).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/calculate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: requestSignal,
    });
  });

  it.each([-1.25, 0.30000000000000004, 1.7976931348623157e308])('preserves result %s without rounding', async (result) => {
    respond({ result });
    await expect(calculate(input, signal())).resolves.toBe(result);
  });

  it.each(['INVALID_INPUT', 'DIVISION_BY_ZERO', 'RESULT_OUT_OF_RANGE'])('preserves %s errors', async (code) => {
    respond({ error: { code, message: 'Useful explanation.' } }, 400);
    await expect(calculate(input, signal())).rejects.toMatchObject({ code, message: 'Useful explanation.' });
  });

  it.each([null, {}, { result: '5' }, { result: null }, { error: null }, { error: { code: 'INVALID_INPUT' } }])('rejects invalid success payload %j', async (body) => {
    respond(body);
    await expect(calculate(input, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([null, { error: null }, { error: { code: 'X', message: ' ' } }, { error: { code: 4, message: 'No' } }])('rejects invalid error payload %j', async (body) => {
    respond(body, 400);
    await expect(calculate(input, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a non-finite result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: Infinity }) }));
    await expect(calculate(input, signal())).rejects.toBeInstanceOf(CalculationError);
  });

  it('rejects malformed response JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json')));
    await expect(calculate(input, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('gives an actionable connection failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(calculate(input, signal())).rejects.toMatchObject({ code: 'CONNECTION_FAILED', message: expect.stringContaining('backend is running') });
  });

  it('reports proxy/service failures even when the body is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(calculate(input, signal())).rejects.toMatchObject({ code: 'CONNECTION_FAILED', message: expect.stringContaining('backend is running') });
  });

  it('preserves cancellation instead of reporting a connection failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(calculate(input, controller.signal)).rejects.toBe(error);
  });

  it.each([{ ...input, a: Infinity }, { ...input, b: NaN }])('rejects non-finite operands before serialization', async (request) => {
    const fetchMock = respond({ result: 0 });
    await expect(calculate(request, signal())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
