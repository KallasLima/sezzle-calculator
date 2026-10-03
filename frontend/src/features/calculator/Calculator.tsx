import { useEffect, useLayoutEffect, useRef } from 'react';
import { useCalculator } from './useCalculator';
import { operationLabels, operationSymbols } from './operations';
import type { CalculatorAction, Operation } from './types';

const keyboardOperations: Record<string, Operation> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
};

function keyboardToAction(key: string): CalculatorAction | undefined {
  if (/^[0-9]$/.test(key)) {
    return { type: 'digit', value: key };
  }
  if (keyboardOperations[key]) {
    return { type: 'operator', value: keyboardOperations[key] };
  }
  switch (key) {
    case '.':
      return { type: 'decimal' };
    case '=':
    case 'Enter':
      return { type: 'equals' };
    case 'Backspace':
      return { type: 'backspace' };
    case 'Escape':
      return { type: 'clear' };
    default:
      return undefined;
  }
}

function BackspaceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 26" fill="none">
      <path d="M12 3h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H12L2 13 12 3Z" />
      <path d="m16 9 8 8m0-8-8 8" />
    </svg>
  );
}

export function Calculator() {
  const calculator = useCalculator();
  const {
    dispatchAction,
    entry,
    pending,
    hasSecondOperand,
    expression,
    status,
    error,
    isChaining,
    isSlow,
  } = calculator;
  const submissionDisabled = status === 'loading' && !isChaining;
  const numberDisplayRef = useRef<HTMLOutputElement>(null);

  useLayoutEffect(() => {
    const display = numberDisplayRef.current;
    if (display) {
      display.scrollLeft = display.scrollWidth;
    }
  }, [entry]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (isEditableTarget) {
        return;
      }
      // Leave Enter/Space to the focused key's native click behavior.
      const isNativeButtonActivation =
        (event.key === 'Enter' || event.key === ' ') &&
        target instanceof HTMLElement &&
        target.closest('.keypad button') !== null;
      if (isNativeButtonActivation) {
        return;
      }

      const action = keyboardToAction(event.key);
      if (action) {
        event.preventDefault();
        dispatchAction(action);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatchAction]);

  const renderOperatorButton = (operation: Operation) => (
    <button
      key={operation}
      type="button"
      className="key key--operator"
      aria-label={operationLabels[operation]}
      aria-pressed={pending?.operation === operation}
      disabled={submissionDisabled}
      onClick={() => dispatchAction({ type: 'operator', value: operation })}
    >
      {operationSymbols[operation]}
    </button>
  );

  const renderDigitButton = (digit: string) => (
    <button
      key={digit}
      type="button"
      className={`key${digit === '0' ? ' key--zero' : ''}`}
      onClick={() => dispatchAction({ type: 'digit', value: digit })}
    >
      {digit}
    </button>
  );

  const shownExpression = pending && hasSecondOperand ? `${expression} ${entry}` : expression;
  let numberSizeClass = '';
  if (entry.length > 18) {
    numberSizeClass = 'display__number--long';
  } else if (entry.length > 10) {
    numberSizeClass = 'display__number--medium';
  }

  let feedbackText = '\u00a0';
  let feedbackRole: 'alert' | 'status' = 'status';
  if (error) {
    feedbackText = error;
    feedbackRole = 'alert';
  } else if (status === 'loading') {
    if (isSlow) {
      feedbackText = 'Still connecting. The free demo service may be starting.';
    } else {
      feedbackText = 'Calculating…';
    }
  } else if (status === 'success') {
    feedbackText = 'Calculated';
  }

  return (
    <main className="calculator" aria-labelledby="calculator-heading">
      <h1 id="calculator-heading">Sezzle calculator</h1>
      <section
        className={`display${error ? ' display--error' : ''}`}
        aria-label="Calculator display"
        aria-busy={status === 'loading'}
      >
        <div className="display__content">
          <p className="display__expression" aria-label="Expression">
            {shownExpression || '\u00a0'}
          </p>
          <output
            ref={numberDisplayRef}
            tabIndex={0}
            className={`display__number ${numberSizeClass}`}
            aria-label="Result"
            aria-live="polite"
            aria-atomic="true"
          >
            {entry}
          </output>
        </div>
        <div className="display__feedback">
          <p role={feedbackRole}>{feedbackText}</p>
        </div>
      </section>
      <div className="keypad" role="group" aria-label="Calculator keypad">
        <button
          type="button"
          className="key key--utility"
          aria-label="All clear"
          onClick={() => dispatchAction({ type: 'clear' })}
        >
          AC
        </button>
        <button
          type="button"
          className="key key--utility key--sign"
          aria-label="Toggle sign"
          onClick={() => dispatchAction({ type: 'sign' })}
        >
          ±
        </button>
        <button
          type="button"
          className="key key--utility"
          aria-label="Backspace"
          onClick={() => dispatchAction({ type: 'backspace' })}
        >
          <BackspaceIcon />
        </button>
        {renderOperatorButton('divide')}
        {['7', '8', '9'].map(renderDigitButton)}
        {renderOperatorButton('multiply')}
        {['4', '5', '6'].map(renderDigitButton)}
        {renderOperatorButton('subtract')}
        {['1', '2', '3'].map(renderDigitButton)}
        {renderOperatorButton('add')}
        {renderDigitButton('0')}
        <button
          type="button"
          className="key"
          aria-label="Decimal point"
          onClick={() => dispatchAction({ type: 'decimal' })}
        >
          .
        </button>
        <button
          type="button"
          className="key key--equals"
          aria-label="Equals"
          disabled={submissionDisabled}
          onClick={() => dispatchAction({ type: 'equals' })}
        >
          =
        </button>
      </div>
    </main>
  );
}
