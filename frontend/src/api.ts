export type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

export interface Calculation {
  operation: Operation;
  a: number;
  b: number;
}

export class CalculationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

/** The only arithmetic boundary: every calculation is sent to the Go service. */
export async function calculate(input: Calculation, signal: AbortSignal): Promise<number> {
  if (!Number.isFinite(input.a) || !Number.isFinite(input.b)) {
    throw new CalculationError('INVALID_INPUT', 'Enter finite numbers within the supported range.');
  }

  let response: Response;
  try {
    response = await fetch('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CalculationError('CONNECTION_FAILED', 'Cannot connect to the calculator service. Check that the backend is running and try again.');
  }

  // A stopped Go service reaches the browser as a Vite proxy 5xx response.
  if (response.status >= 500) {
    throw new CalculationError('CONNECTION_FAILED', 'The calculator service is unavailable. Check that the backend is running and try again.');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CalculationError('INVALID_RESPONSE', 'The calculator service returned an invalid response. Please try again.');
  }

  if (typeof body === 'object' && body !== null) {
    if (response.ok && 'result' in body && typeof body.result === 'number' && Number.isFinite(body.result)) {
      return body.result;
    }
    if (!response.ok && 'error' in body && typeof body.error === 'object' && body.error !== null &&
        'code' in body.error && typeof body.error.code === 'string' &&
        'message' in body.error && typeof body.error.message === 'string' && body.error.message.trim()) {
      throw new CalculationError(body.error.code, body.error.message);
    }
  }

  throw new CalculationError('INVALID_RESPONSE', 'The calculator service returned an invalid response. Please try again.');
}
