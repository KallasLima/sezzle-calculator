import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Calculator } from './Calculator';
import { calculate } from './api';

vi.mock('./api', () => ({ calculate: vi.fn() }));
const calculateMock = vi.mocked(calculate);
const button = (name: string) => screen.getByRole('button', { name });
const result = () => screen.getByLabelText('Result');
beforeEach(() => { calculateMock.mockReset(); });

describe('focused keypad keyboard activation', () => {
  it.each(['{Enter}', ' '])('activates AC and other focused buttons once with %j', async (key) => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValueOnce(24).mockResolvedValueOnce(-4);
    render(<Calculator />);
    await user.keyboard('12*2=');
    expect(result()).toHaveTextContent(/^24$/);

    button('All clear').focus();
    await user.keyboard(key);
    expect(result()).toHaveTextContent(/^0$/);
    button('2').focus();
    await user.keyboard(key);
    expect(result()).toHaveTextContent(/^2$/); // Not 22 from double activation.
    button('Toggle sign').focus();
    await user.keyboard(key);
    expect(result()).toHaveTextContent(/^-2$/);
    button('Multiply').focus();
    await user.keyboard(key);
    button('2').focus();
    await user.keyboard(key);
    button('Equals').focus();
    await user.keyboard(key);
    expect(result()).toHaveTextContent(/^-4$/);
    expect(calculateMock).toHaveBeenCalledTimes(2);
    expect(calculateMock).toHaveBeenLastCalledWith({ operation: 'multiply', a: -2, b: 2 }, expect.any(AbortSignal));
  });

  it('uses Enter as equals when the display has focus', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(5);
    render(<Calculator />);
    await user.keyboard('2+3');
    result().focus();
    await user.keyboard('{Enter}');
    expect(result()).toHaveTextContent(/^5$/);
    expect(calculateMock).toHaveBeenCalledTimes(1);
  });
});
