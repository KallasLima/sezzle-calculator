import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Calculator } from '../Calculator';
import { calculate } from '../calculatorApi';
import { createDeferred } from './testHelpers';

vi.mock('../calculatorApi', () => ({ calculate: vi.fn() }));
const calculateMock = vi.mocked(calculate);
const result = () => screen.getByLabelText('Result');
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  calculateMock.mockReset();
});

describe('input across unresolved chained calculations', () => {
  it('keeps the next operand editable when equals arrives after the intermediate result', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    calculateMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(20);
    render(<Calculator />);

    await user.keyboard('2+3*4');
    await act(async () => first.resolve(5));

    expect(result()).toHaveTextContent(/^4$/);
    expect(calculateMock).toHaveBeenCalledTimes(1);
    await user.keyboard('=');

    expect(result()).toHaveTextContent(/^20$/);
  });

  it('preserves 2 + 3 × 4 = until both backend results arrive', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    const second = createDeferred();
    calculateMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<Calculator />);

    await user.keyboard('2+3*4=');

    expect(calculateMock).toHaveBeenCalledTimes(1);
    expect(calculateMock.mock.calls[0][1].aborted).toBe(false);
    await act(async () => first.resolve(5));

    expect(calculateMock).toHaveBeenCalledTimes(2);
    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'multiply', a: 5, b: 4 },
      expect.any(AbortSignal),
    );
    await act(async () => second.resolve(20));

    expect(result()).toHaveTextContent(/^20$/);
  });

  it('keeps a queued equals in chain mode when its queue is empty and more input arrives', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    const second = createDeferred();
    const third = createDeferred();
    calculateMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    render(<Calculator />);

    await user.keyboard('2+3*4=');
    await act(async () => first.resolve(5));

    expect(calculateMock).toHaveBeenCalledTimes(2);
    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'multiply', a: 5, b: 4 },
      expect.any(AbortSignal),
    );

    await user.keyboard('7+2=');

    expect(calculateMock).toHaveBeenCalledTimes(2);
    expect(calculateMock.mock.calls[1][1].aborted).toBe(false);
    expect(result()).toHaveTextContent(/^4$/);

    await act(async () => second.resolve(20));

    expect(calculateMock).toHaveBeenCalledTimes(3);
    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'add', a: 7, b: 2 },
      expect.any(AbortSignal),
    );
    await act(async () => third.resolve(9));

    expect(result()).toHaveTextContent(/^9$/);
  });

  it('orders several operators and equals, including input arriving during the next request', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    const second = createDeferred();
    const third = createDeferred();
    calculateMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    render(<Calculator />);

    await user.keyboard('2+3*4+');
    await act(async () => first.resolve(5));

    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'multiply', a: 5, b: 4 },
      expect.any(AbortSignal),
    );
    await user.keyboard('6===');

    expect(calculateMock).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(20));

    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'add', a: 20, b: 6 },
      expect.any(AbortSignal),
    );
    await act(async () => third.resolve(26));

    expect(result()).toHaveTextContent(/^26$/);
    expect(calculateMock).toHaveBeenCalledTimes(3);
  });

  it('accepts queued operators and equals from real keypad clicks', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    calculateMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(5);
    render(<Calculator />);

    for (const name of ['2', 'Add', '3', 'Multiply', 'Divide', '1', 'Equals']) {
      await user.click(button(name));
    }
    await act(async () => first.resolve(5));

    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'divide', a: 5, b: 1 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^5$/);
  });

  it.each(['resolve', 'reject'] as const)(
    'AC discards all queued input and ignores a late %s after a new calculation',
    async (outcome) => {
      const user = userEvent.setup();
      const old = createDeferred();
      calculateMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(9);
      render(<Calculator />);

      await user.keyboard('2+3*4+6=');
      await user.click(button('All clear'));

      expect(result()).toHaveTextContent(/^0$/);
      expect(calculateMock.mock.calls[0][1].aborted).toBe(true);
      await user.keyboard('4+5=');
      await act(async () => {
        if (outcome === 'resolve') {
          old.resolve(5);
        } else {
          old.reject(new Error('Old failure'));
        }
      });
      expect(result()).toHaveTextContent(/^9$/);
      expect(calculateMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('stops and discards the continuation after a failed intermediate result; permits retry', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    calculateMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(20);
    render(<Calculator />);

    await user.keyboard('2+3*4+6=');
    await act(async () => first.reject(new Error('Service unavailable.')));

    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable.');
    expect(screen.getByRole('alert')).toHaveTextContent(/queued input.*clear/i);
    expect(calculateMock).toHaveBeenCalledTimes(1);
    await user.keyboard('=');

    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'add', a: 2, b: 3 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^5$/);
    await user.keyboard('*4=');

    expect(result()).toHaveTextContent(/^20$/);
    expect(calculateMock).toHaveBeenCalledTimes(3);
  });

  it('keeps edits, explicit zero, and a new calculation after queued equals in order', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    calculateMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(9);
    render(<Calculator />);

    await user.keyboard('2+3*4{Backspace}0=7+2=');
    await act(async () => first.resolve(5));

    expect(calculateMock.mock.calls.map(([input]) => input)).toEqual([
      { operation: 'add', a: 2, b: 3 },
      { operation: 'multiply', a: 5, b: 0 },
      { operation: 'add', a: 7, b: 2 },
    ]);
    expect(result()).toHaveTextContent(/^9$/);
  });

  it('queues decimal and sign edits without changing the committed second operand', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    calculateMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(-2.5);
    render(<Calculator />);

    await user.keyboard('2+3*.5.');
    await user.click(button('Toggle sign'));
    await user.keyboard('=');
    await act(async () => first.resolve(5));

    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'multiply', a: 5, b: -0.5 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^-2.5$/);
  });

  it('AC during the second request cannot overwrite or release a newer pending request', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    const second = createDeferred();
    const newer = createDeferred();
    calculateMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(newer.promise);
    render(<Calculator />);

    await user.keyboard('2+3*4+6=');
    await act(async () => first.resolve(5));
    await user.keyboard('{Escape}7+2=');

    expect(calculateMock.mock.calls[1][1].aborted).toBe(true);
    await act(async () => second.resolve(20));

    expect(screen.getByText('Calculating…')).toBeInTheDocument();
    expect(result()).toHaveTextContent(/^2$/);
    await user.keyboard('=');

    expect(calculateMock).toHaveBeenCalledTimes(3);
    await act(async () => newer.resolve(9));

    expect(result()).toHaveTextContent(/^9$/);
  });

  it('recovers the correct operands when a later intermediate request fails', async () => {
    const user = userEvent.setup();
    const first = createDeferred();
    const second = createDeferred();
    calculateMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(20);
    render(<Calculator />);

    await user.keyboard('2+3*4+6=');
    await act(async () => first.resolve(5));
    await act(async () => second.reject(new Error('Connection failed.')));

    expect(screen.getByRole('alert')).toHaveTextContent(/queued input.*clear/i);
    await user.keyboard('=');

    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'multiply', a: 5, b: 4 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^20$/);
    expect(calculateMock).toHaveBeenCalledTimes(3);
  });

  it('stops queued actions at invalid numeric input without sending an invalid request', async () => {
    // Keep every key event, but advance user-event and Testing Library's
    // completion timers without depending on wall-clock scheduling.
    vi.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const first = createDeferred();
      calculateMock.mockReturnValueOnce(first.promise);
      render(<Calculator />);

      const typing = user.keyboard(`2+3*${'9'.repeat(309)}=7+2=`);
      await vi.runAllTimersAsync();
      await typing;
      await act(async () => first.resolve(5));

      expect(screen.getByRole('alert')).toHaveTextContent('finite number');
      expect(screen.getByRole('alert')).toHaveTextContent(/queued input.*clear/i);
      expect(calculateMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
