import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Calculator } from '../Calculator';

const result = () => screen.getByLabelText('Result');
const feedback = () => screen.getByRole('status', { name: '' });
const slowMessage = 'Still connecting. The free demo service may be starting.';

function keys(sequence: string) {
  for (const key of sequence) {
    fireEvent.keyDown(window, { key });
  }
}

function delayedFetch() {
  let resolve!: (response: Response) => void;
  let signal!: AbortSignal;
  const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
    signal = options.signal as AbortSignal;
    return new Promise<Response>((resolveResponse, rejectResponse) => {
      resolve = resolveResponse;
      signal.addEventListener('abort', () => rejectResponse(signal.reason), { once: true });
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    get signal() {
      return signal;
    },
    respond: (value: number) => resolve(new Response(JSON.stringify({ result: value }))),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('slow or unavailable backend requests', () => {
  it('shows cautious feedback after eight seconds and removes it when the response arrives', async () => {
    const request = delayedFetch();
    render(<Calculator />);

    keys('2+3=');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_999);
    });
    expect(feedback()).toHaveTextContent('Calculating…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(feedback()).toHaveTextContent(slowMessage);
    expect(request.fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => request.respond(5));

    expect(result()).toHaveTextContent(/^5$/);
    expect(feedback()).toHaveTextContent('Calculated');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the first request at 90 seconds, saves the operands, and retries only on user input', async () => {
    const request = delayedFetch();
    render(<Calculator />);

    keys('12*2=');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(89_999);
    });
    expect(request.signal.aborted).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(request.signal.aborted).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('timed out');
    expect(screen.getByLabelText('Expression')).toHaveTextContent('12 × 2');
    expect(result()).toHaveTextContent(/^2$/);
    expect(request.fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    keys('=');
    expect(request.fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.fetchMock.mock.calls[1][1].body)).toEqual({
      operation: 'multiply',
      a: 12,
      b: 2,
    });
    expect(feedback()).toHaveTextContent('Calculating…');
    await act(async () => request.respond(24));

    expect(result()).toHaveTextContent(/^24$/);
  });

  it.each([1_000, 8_000])(
    'AC cancels the request and both feedback/deadline timers after %i ms',
    async (elapsed) => {
      const request = delayedFetch();
      render(<Calculator />);

      keys('2+3*4+6=');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(elapsed);
      });
      fireEvent.click(screen.getByRole('button', { name: 'All clear' }));

      expect(request.signal.aborted).toBe(true);
      expect(result()).toHaveTextContent(/^0$/);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(feedback()).not.toHaveTextContent(slowMessage);
      expect(request.fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('drops timed-out chain continuation and retains only the failed operation for retry', async () => {
    const request = delayedFetch();
    render(<Calculator />);

    keys('2+3*4+6=');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('queued input cleared');
    expect(request.fetchMock).toHaveBeenCalledTimes(1);
    keys('=');
    await act(async () => request.respond(5));

    expect(result()).toHaveTextContent(/^5$/);
    expect(request.fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.fetchMock.mock.calls[1][1].body)).toEqual({
      operation: 'add',
      a: 2,
      b: 3,
    });
  });

  it('restarts slow feedback for each ordered request and preserves the queued calculation', async () => {
    const request = delayedFetch();
    render(<Calculator />);

    keys('2+3*4=');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(feedback()).toHaveTextContent(slowMessage);
    await act(async () => request.respond(5));

    expect(feedback()).toHaveTextContent('Calculating…');
    expect(request.fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.fetchMock.mock.calls[1][1].body)).toEqual({
      operation: 'multiply',
      a: 5,
      b: 4,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(feedback()).toHaveTextContent(slowMessage);
    await act(async () => request.respond(20));

    expect(result()).toHaveTextContent(/^20$/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes all pending timers when the calculator unmounts', async () => {
    const request = delayedFetch();
    const view = render(<Calculator />);

    keys('2+3=');
    view.unmount();
    await act(async () => {});

    expect(request.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
