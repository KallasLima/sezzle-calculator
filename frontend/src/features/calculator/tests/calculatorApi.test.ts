import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculate, CalculationError, REQUEST_TIMEOUT_MS } from '../calculatorApi';

const input = { operation: 'add' as const, a: 2, b: 3 };
const signal = () => new AbortController().signal;

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('calculator API client', () => {
  it('posts the exact contract and returns the server result, including zero', async () => {
    const fetchMock = respond({ result: 0 });
    const requestSignal = signal();
    await expect(calculate(input, requestSignal)).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it.each([
    'https://calculator-api.example',
    'https://calculator-api.example/',
    'https://calculator-api.example///',
  ])('appends the API path to the configured public origin %s', async (origin) => {
    vi.stubEnv('VITE_API_BASE_URL', origin);
    const fetchMock = respond({ result: 5 });
    await calculate(input, signal());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://calculator-api.example/api/calculate',
      expect.any(Object),
    );
  });

  it('keeps the local relative URL when the build-time variable is empty', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    const fetchMock = respond({ result: 5 });
    await calculate(input, signal());
    expect(fetchMock).toHaveBeenCalledWith('/api/calculate', expect.any(Object));
  });

  it.each([-1.25, 0.30000000000000004, 1.7976931348623157e308])(
    'preserves result %s without rounding',
    async (result) => {
      respond({ result });
      await expect(calculate(input, signal())).resolves.toBe(result);
    },
  );

  it.each(['INVALID_INPUT', 'DIVISION_BY_ZERO', 'RESULT_OUT_OF_RANGE'])(
    'preserves %s errors',
    async (code) => {
      respond({ error: { code, message: 'Useful explanation.' } }, 400);
      await expect(calculate(input, signal())).rejects.toMatchObject({
        code,
        message: 'Useful explanation.',
      });
    },
  );

  it.each([
    null,
    {},
    { result: '5' },
    { result: null },
    { error: null },
    { error: { code: 'INVALID_INPUT' } },
  ])('rejects invalid success payload %j', async (body) => {
    respond(body);
    await expect(calculate(input, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    null,
    { error: null },
    { error: { code: 'X', message: ' ' } },
    { error: { code: 4, message: 'No' } },
  ])('rejects invalid error payload %j', async (body) => {
    respond(body, 400);
    await expect(calculate(input, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a non-finite result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: Infinity }) }),
    );
    await expect(calculate(input, signal())).rejects.toBeInstanceOf(CalculationError);
  });

  it('rejects malformed response JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json')));
    await expect(calculate(input, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('gives an actionable connection failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(calculate(input, signal())).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
      message: expect.stringContaining('Check your connection'),
    });
  });

  it('reports proxy/service failures even when the body is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(calculate(input, signal())).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
      message: expect.stringContaining('Please try again'),
    });
  });

  it('preserves cancellation instead of reporting a connection failure', async () => {
    const controller = new AbortController();
    const error = new DOMException('Aborted', 'AbortError');
    controller.abort(error);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(calculate(input, controller.signal)).rejects.toBe(error);
  });

  it('applies the total timeout while reading the response body and releases its timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, options: RequestInit) => ({
        status: 200,
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
              once: true,
            });
          }),
      })),
    );
    const pending = expect(calculate(input, signal())).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the deadline timer after a successful response', async () => {
    vi.useFakeTimers();
    respond({ result: 5 });
    await calculate(input, signal());
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { ...input, a: Infinity },
    { ...input, b: NaN },
  ])('rejects non-finite operands before serialization', async (request) => {
    const fetchMock = respond({ result: 0 });
    await expect(calculate(request, signal())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
