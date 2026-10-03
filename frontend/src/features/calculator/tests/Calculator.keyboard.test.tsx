import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Calculator } from '../Calculator';
import { requestCalculation } from '../calculatorApi';

vi.mock('../calculatorApi', () => ({ requestCalculation: vi.fn() }));
const requestCalculationMock = vi.mocked(requestCalculation);
const button = (name: string) => screen.getByRole('button', { name });
const result = () => screen.getByLabelText('Result');
beforeEach(() => {
  requestCalculationMock.mockReset();
});

describe('focused keypad keyboard activation', () => {
  it.each(['{Enter}', ' '])('activates AC and other focused buttons once with %j', async (key) => {
    const user = userEvent.setup();
    requestCalculationMock.mockResolvedValueOnce(24).mockResolvedValueOnce(-4);
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
    expect(requestCalculationMock).toHaveBeenCalledTimes(2);
    expect(requestCalculationMock).toHaveBeenLastCalledWith(
      { operation: 'multiply', a: -2, b: 2 },
      expect.any(AbortSignal),
    );
  });

  it('uses Enter as equals when the display has focus', async () => {
    const user = userEvent.setup();
    requestCalculationMock.mockResolvedValue(5);
    render(<Calculator />);

    await user.keyboard('2+3');
    result().focus();
    await user.keyboard('{Enter}');

    expect(result()).toHaveTextContent(/^5$/);
    expect(requestCalculationMock).toHaveBeenCalledTimes(1);
  });
});
