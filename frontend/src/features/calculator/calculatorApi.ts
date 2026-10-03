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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSuccessResponse(body: unknown): body is { result: number } {
  return isObject(body) && typeof body.result === 'number' && Number.isFinite(body.result);
}

function isErrorResponse(body: unknown): body is { error: { code: string; message: string } } {
  if (!isObject(body) || !isObject(body.error)) {
    return false;
  }
  const { code, message } = body.error;
  return typeof code === 'string' && typeof message === 'string' && message.trim().length > 0;
}

/** The only arithmetic boundary: every calculation is sent to the Go service. */
export async function requestCalculation(input: Calculation, signal: AbortSignal): Promise<number> {
  if (!Number.isFinite(input.a) || !Number.isFinite(input.b)) {
    throw new CalculationError('INVALID_INPUT', 'Enter finite numbers within the supported range.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(
      new CalculationError(
        'REQUEST_TIMEOUT',
        'The request timed out. Your operands are saved. Please try again.',
      ),
    );
  }, REQUEST_TIMEOUT_MS);
  const cancelFromCaller = () => {
    clearTimeout(timeoutId);
    controller.abort(signal.reason);
  };
  signal.addEventListener('abort', cancelFromCaller, { once: true });
  if (signal.aborted) {
    cancelFromCaller();
  }

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
      if (controller.signal.aborted) {
        throw error;
      }
      throw new CalculationError(
        'CONNECTION_FAILED',
        'Cannot connect to the calculator service. Check your connection and try again.',
      );
    }

    // Both the local Vite proxy and the hosted service can return 5xx responses
    // when the Go service is unavailable, without a calculator error body.
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

    if (response.ok && isSuccessResponse(body)) {
      return body.result;
    }
    if (!response.ok && isErrorResponse(body)) {
      throw new CalculationError(body.error.code, body.error.message);
    }

    throw new CalculationError(
      'INVALID_RESPONSE',
      'The calculator service returned an invalid response. Please try again.',
    );
  } catch (error) {
    // Covers both waiting for headers and reading the response body.
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', cancelFromCaller);
  }
}
