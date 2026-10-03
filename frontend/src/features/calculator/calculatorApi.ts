import type { Calculation } from './types';

export class CalculationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CalculationError';
  }
}

export const REQUEST_TIMEOUT_MS = 90_000;

/** The only arithmetic boundary: every calculation is sent to the Go service. */
export async function calculate(input: Calculation, signal: AbortSignal): Promise<number> {
  if (!Number.isFinite(input.a) || !Number.isFinite(input.b)) {
    throw new CalculationError('INVALID_INPUT', 'Enter finite numbers within the supported range.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new CalculationError(
          'REQUEST_TIMEOUT',
          'The request timed out. Your operands are saved. Please try again.',
        ),
      ),
    REQUEST_TIMEOUT_MS,
  );
  const cancel = () => {
    clearTimeout(timeout);
    controller.abort(signal.reason);
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();

  try {
    controller.signal.throwIfAborted();
    const baseURL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
    let response: Response;
    try {
      response = await fetch(`${baseURL}/api/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new CalculationError(
        'CONNECTION_FAILED',
        'Cannot connect to the calculator service. Check your connection and try again.',
      );
    }

    // A stopped Go service reaches the browser as a Vite proxy 5xx response.
    if (response.status >= 500) {
      throw new CalculationError(
        'CONNECTION_FAILED',
        'The calculator service is unavailable. Please try again.',
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CalculationError(
        'INVALID_RESPONSE',
        'The calculator service returned an invalid response. Please try again.',
      );
    }
    controller.signal.throwIfAborted();

    if (typeof body === 'object' && body !== null) {
      if (
        response.ok &&
        'result' in body &&
        typeof body.result === 'number' &&
        Number.isFinite(body.result)
      ) {
        return body.result;
      }
      if (
        !response.ok &&
        'error' in body &&
        typeof body.error === 'object' &&
        body.error !== null &&
        'code' in body.error &&
        typeof body.error.code === 'string' &&
        'message' in body.error &&
        typeof body.error.message === 'string' &&
        body.error.message.trim()
      ) {
        throw new CalculationError(body.error.code, body.error.message);
      }
    }

    throw new CalculationError(
      'INVALID_RESPONSE',
      'The calculator service returned an invalid response. Please try again.',
    );
  } catch (error) {
    // Covers both waiting for headers and reading the response body.
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}
