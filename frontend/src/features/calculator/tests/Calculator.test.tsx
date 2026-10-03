import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Calculator } from '../Calculator';
import { calculate, CalculationError } from '../calculatorApi';
import { createDeferred } from './testHelpers';

vi.mock('../calculatorApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../calculatorApi')>()),
  calculate: vi.fn(),
}));

const calculateMock = vi.mocked(calculate);
const result = () => screen.getByLabelText('Result');
const button = (name: string) => screen.getByRole('button', { name });

async function press(user: ReturnType<typeof userEvent.setup>, ...keys: string[]) {
  for (const key of keys) {
    await user.click(button(key));
  }
}

beforeEach(() => {
  calculateMock.mockReset();
});

describe('calculator keypad', () => {
  it('starts at zero, has one exact heading and names every symbol control', () => {
    render(<Calculator />);

    expect(screen.getByRole('heading', { name: 'Sezzle calculator' })).toBeInTheDocument();
    expect(result()).toHaveTextContent(/^0$/);
    expect(screen.getAllByRole('button')).toHaveLength(19);
    for (const name of [
      'All clear',
      'Toggle sign',
      'Backspace',
      'Divide',
      'Multiply',
      'Subtract',
      'Add',
      'Decimal point',
      'Equals',
    ]) {
      expect(button(name)).toHaveAccessibleName(name);
    }
    expect(
      screen.getAllByRole('button').filter((key) => key.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(0);
  });

  it('sends 12 × 2 and displays the backend result 24', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(24);
    render(<Calculator />);

    await press(user, '1', '2', 'Multiply', '2', 'Equals');

    expect(calculateMock).toHaveBeenCalledWith(
      { operation: 'multiply', a: 12, b: 2 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^24$/);
    expect(screen.getByLabelText('Expression')).toHaveTextContent('12 × 2');
    expect(screen.getByText('Calculated')).toBeInTheDocument();
  });

  it('renders a supplied server value instead of doing arithmetic in React', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(123);
    render(<Calculator />);

    await press(user, '2', 'Add', '3', 'Equals');

    expect(result()).toHaveTextContent(/^123$/);
  });

  it('ignores incomplete equals and repeated equals without inventing operands', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(3);
    render(<Calculator />);

    await press(user, 'Equals', '1', 'Equals', 'Add', 'Equals');

    expect(calculateMock).not.toHaveBeenCalled();
    await press(user, '2', 'Equals', 'Equals');

    expect(calculateMock).toHaveBeenCalledTimes(1);
    expect(result()).toHaveTextContent(/^3$/);
  });

  it('distinguishes an entered zero from a missing second operand', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(8);
    render(<Calculator />);

    await press(user, '8', 'Add', '0', 'Equals');

    expect(calculateMock).toHaveBeenCalledWith(
      { operation: 'add', a: 8, b: 0 },
      expect.any(AbortSignal),
    );
  });

  it('preserves decimal text, ignores duplicate decimals and submits negative decimals', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(-1);
    render(<Calculator />);

    await press(user, 'Decimal point', '5', 'Decimal point', '0', 'Toggle sign');

    expect(result()).toHaveTextContent(/^-0.50$/);
    await press(user, 'Multiply', '2', 'Equals');

    expect(calculateMock).toHaveBeenCalledWith(
      { operation: 'multiply', a: -0.5, b: 2 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^-1$/);
  });

  it('handles sign changes, signed zero and local backspace', async () => {
    const user = userEvent.setup();
    render(<Calculator />);

    await press(user, 'Toggle sign', '0', '2', '3', 'Backspace');

    expect(result()).toHaveTextContent(/^-2$/);
    await press(user, 'Toggle sign');

    expect(result()).toHaveTextContent(/^2$/);
    await press(user, 'Backspace', 'Backspace');

    expect(result()).toHaveTextContent(/^0$/);
    expect(calculateMock).not.toHaveBeenCalled();
  });

  it('starts a signed second operand from zero and allows its sign to change before digits', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(-3);
    render(<Calculator />);

    await press(user, '1', 'Subtract', 'Toggle sign');

    expect(result()).toHaveTextContent(/^-0$/);
    await press(user, 'Toggle sign');

    expect(result()).toHaveTextContent(/^0$/);

    await press(user, '4', 'Equals');

    expect(calculateMock).toHaveBeenCalledWith(
      { operation: 'subtract', a: 1, b: 4 },
      expect.any(AbortSignal),
    );
  });

  it('submits a sign-only second operand as entered negative zero', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(1);
    render(<Calculator />);

    await press(user, '1', 'Subtract', 'Toggle sign');

    expect(result()).toHaveTextContent(/^-0$/);
    await press(user, 'Equals');

    expect(calculateMock).toHaveBeenCalledWith(
      { operation: 'subtract', a: 1, b: -0 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^1$/);
  });

  it('changes a pending operator without evaluating and ignores backspace while waiting', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(6);
    render(<Calculator />);

    await press(user, '8', 'Add', 'Backspace', 'Subtract');

    expect(calculateMock).not.toHaveBeenCalled();
    expect(button('Subtract')).toHaveAttribute('aria-pressed', 'true');
    await press(user, '2', 'Equals');

    expect(calculateMock).toHaveBeenCalledWith(
      { operation: 'subtract', a: 8, b: 2 },
      expect.any(AbortSignal),
    );
  });

  it('chains left-to-right through the backend: 2 + 3 × 4 = 20', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValueOnce(5).mockResolvedValueOnce(20);
    render(<Calculator />);

    await press(user, '2', 'Add', '3', 'Multiply');

    expect(result()).toHaveTextContent(/^5$/);
    expect(calculateMock).toHaveBeenNthCalledWith(
      1,
      { operation: 'add', a: 2, b: 3 },
      expect.any(AbortSignal),
    );
    await press(user, '4', 'Equals');

    expect(calculateMock).toHaveBeenNthCalledWith(
      2,
      { operation: 'multiply', a: 5, b: 4 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^20$/);
  });

  it('continues from a result with an operator and starts over with a digit', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValueOnce(5).mockResolvedValueOnce(10);
    render(<Calculator />);

    await press(user, '2', 'Add', '3', 'Equals', 'Multiply', '2', 'Equals');

    expect(calculateMock).toHaveBeenNthCalledWith(
      2,
      { operation: 'multiply', a: 5, b: 2 },
      expect.any(AbortSignal),
    );
    await press(user, '7');

    expect(result()).toHaveTextContent(/^7$/);
    expect(screen.getByLabelText('Expression')).toHaveTextContent(/^\s*$/);
  });

  it('handles decimal, sign and backspace after a result consistently', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(3);
    render(<Calculator />);

    await press(user, '1', 'Add', '2', 'Equals', 'Toggle sign');

    expect(result()).toHaveTextContent(/^-3$/);
    await press(user, 'Backspace');

    expect(result()).toHaveTextContent(/^0$/);
    await press(user, '1', 'Add', '2', 'Equals', 'Decimal point', '5');

    expect(result()).toHaveTextContent(/^0.5$/);
  });

  it('clears all state and starts a fresh calculation', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(9);
    render(<Calculator />);

    await press(user, '8', 'Divide', 'All clear');

    expect(result()).toHaveTextContent(/^0$/);
    await press(user, '4', 'Add', '5', 'Equals');

    expect(calculateMock).toHaveBeenCalledWith(
      { operation: 'add', a: 4, b: 5 },
      expect.any(AbortSignal),
    );
  });

  it.each([
    ['DIVISION_BY_ZERO', 'Cannot divide by zero.'],
    ['RESULT_OUT_OF_RANGE', 'The result is outside the supported range.'],
    ['INVALID_INPUT', 'Invalid operation.'],
    ['CONNECTION_FAILED', 'Cannot connect to the calculator service.'],
  ])('shows %s errors and permits editing/retry', async (code, message) => {
    const user = userEvent.setup();
    calculateMock
      .mockRejectedValueOnce(new CalculationError(code, message))
      .mockResolvedValueOnce(4);
    render(<Calculator />);

    await press(user, '8', 'Divide', '0', 'Equals');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    await press(user, '2', 'Equals');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(result()).toHaveTextContent(/^4$/);
  });

  it('handles an unexpected failure without losing the editable operation', async () => {
    const user = userEvent.setup();
    calculateMock.mockRejectedValue('unexpected');
    render(<Calculator />);

    await press(user, '1', 'Add', '2', 'Equals');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The calculation failed. Please try again.',
    );
  });

  it('shows loading and prevents duplicate equals/operator submissions', async () => {
    const user = userEvent.setup();
    const delayed = createDeferred();
    calculateMock.mockReturnValue(delayed.promise);
    render(<Calculator />);

    await press(user, '1', 'Add', '2', 'Equals');

    expect(screen.getByText('Calculating…')).toBeInTheDocument();
    expect(button('Equals')).toBeDisabled();
    expect(button('Multiply')).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: '*' });

    expect(calculateMock).toHaveBeenCalledTimes(1);
    await act(async () => delayed.resolve(3));

    expect(result()).toHaveTextContent(/^3$/);
    expect(button('Equals')).toBeEnabled();
  });

  it('aborts and ignores a late success after AC, even if the server ignores abort', async () => {
    const user = userEvent.setup();
    const delayed = createDeferred();
    calculateMock.mockReturnValue(delayed.promise);
    render(<Calculator />);

    await press(user, '1', 'Add', '2', 'Equals', 'All clear');

    expect(calculateMock.mock.calls[0][1].aborted).toBe(true);
    await act(async () => delayed.resolve(3));

    expect(result()).toHaveTextContent(/^0$/);
    expect(screen.queryByText('Calculated')).not.toBeInTheDocument();
  });

  it('ignores an obsolete failure while a newer request completes', async () => {
    const user = userEvent.setup();
    const old = createDeferred();
    calculateMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(6);
    render(<Calculator />);

    await press(user, '1', 'Add', '2', 'Equals', 'All clear', '2', 'Multiply', '3', 'Equals');
    await act(async () => old.reject(new Error('Old failure')));

    expect(result()).toHaveTextContent(/^6$/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cancels an in-flight calculation when entry is edited and uses the new operand', async () => {
    const user = userEvent.setup();
    const delayed = createDeferred();
    calculateMock.mockReturnValueOnce(delayed.promise).mockResolvedValueOnce(24);
    render(<Calculator />);

    await press(user, '1', 'Add', '2', 'Equals', '3');

    expect(result()).toHaveTextContent(/^23$/);
    await act(async () => delayed.resolve(3));

    expect(result()).toHaveTextContent(/^23$/);
    await press(user, 'Equals');

    expect(calculateMock).toHaveBeenLastCalledWith(
      { operation: 'add', a: 1, b: 23 },
      expect.any(AbortSignal),
    );
  });

  it('aborts a request on unmount', async () => {
    const user = userEvent.setup();
    calculateMock.mockReturnValue(new Promise(() => {}));
    const view = render(<Calculator />);

    await press(user, '1', 'Add', '2', 'Equals');
    view.unmount();

    expect(calculateMock.mock.calls[0][1].aborted).toBe(true);
  });

  it('rejects an overflowing first or second entry before sending JSON', async () => {
    render(<Calculator />);

    for (let i = 0; i < 309; i++) {
      fireEvent.keyDown(window, { key: '9' });
    }
    fireEvent.keyDown(window, { key: '+' });

    expect(screen.getByRole('alert')).toHaveTextContent('finite number');

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: '+' });
    for (let i = 0; i < 309; i++) {
      fireEvent.keyDown(window, { key: '9' });
    }
    fireEvent.keyDown(window, { key: '=' });

    expect(screen.getByRole('alert')).toHaveTextContent('finite number');
    expect(calculateMock).not.toHaveBeenCalled();
  });

  it('supports keyboard shortcuts and native Enter on a focused digit', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValueOnce(24).mockResolvedValueOnce(0.5);
    render(<Calculator />);

    await user.keyboard('12*2{Enter}');
    await waitFor(() => expect(result()).toHaveTextContent(/^24$/));
    await user.keyboard('{Escape}1.2{Backspace}{Backspace}/2=');
    await waitFor(() => expect(result()).toHaveTextContent(/^0.5$/));
    button('7').focus();
    await user.keyboard('{Enter}');

    expect(result()).toHaveTextContent(/^7$/);
    expect(calculateMock).toHaveBeenCalledTimes(2);
  });

  it('ignores modified keys and unrelated keys', async () => {
    const user = userEvent.setup();
    render(<Calculator />);

    await user.keyboard('{Control>}1{/Control}{Meta>}2{/Meta}{Alt>}3{/Alt}a');

    expect(result()).toHaveTextContent(/^0$/);
    expect(calculateMock).not.toHaveBeenCalled();
  });

  it.each(['Other input', 'Other textarea', 'Other select', 'Editable content'])(
    'leaves keyboard input to the focused %s',
    async (label) => {
      const user = userEvent.setup();
      render(
        <>
          <Calculator />
          <input aria-label="Other input" />
          <textarea aria-label="Other textarea" />
          <select aria-label="Other select">
            <option>1</option>
            <option>2</option>
          </select>
          <div contentEditable aria-label="Editable content" />
        </>,
      );
      const editable = screen.getByLabelText(label);
      const needsContentEditableProperty =
        label === 'Editable content' && !('isContentEditable' in editable);
      if (needsContentEditableProperty) {
        // JSDOM lacks the browser's computed content-editability property.
        Object.defineProperty(editable, 'isContentEditable', {
          configurable: true,
          value: true,
        });
      }

      try {
        await user.click(editable);

        expect(editable).toHaveFocus();
        await user.keyboard('1+2={Backspace}{Enter}{Escape}');

        expect(result()).toHaveTextContent(/^0$/);
        expect(calculateMock).not.toHaveBeenCalled();
      } finally {
        if (needsContentEditableProperty) {
          Reflect.deleteProperty(editable, 'isContentEditable');
        }
      }
    },
  );

  it('begins a decimal second operand and preserves ordinary floating-point results', async () => {
    const user = userEvent.setup();
    calculateMock.mockResolvedValue(0.30000000000000004);
    render(<Calculator />);

    await press(user, 'Decimal point', '1', 'Add', 'Decimal point', '2', 'Equals');

    expect(calculateMock).toHaveBeenCalledWith(
      { operation: 'add', a: 0.1, b: 0.2 },
      expect.any(AbortSignal),
    );
    expect(result()).toHaveTextContent(/^0.30000000000000004$/);
  });
});
