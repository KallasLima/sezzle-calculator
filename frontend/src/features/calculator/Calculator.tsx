import { useEffect, useLayoutEffect, useRef } from 'react';
import { useCalculator } from './useCalculator';
import { operationSymbols } from './operations';
import type { CalculatorAction, Operation } from './types';

const keyboardOperations: Record<string, Operation> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
};

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
  const numberDisplay = useRef<HTMLOutputElement>(null);

  useLayoutEffect(() => {
    const display = numberDisplay.current;
    if (display) display.scrollLeft = display.scrollWidth;
  }, [entry]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )
        return;
      // Leave Enter/Space to the focused key's native click behavior.
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        target instanceof HTMLElement &&
        target.closest('.keypad button')
      )
        return;
      let action: CalculatorAction | undefined;
      if (/^[0-9]$/.test(event.key)) action = { type: 'digit', value: event.key };
      else if (event.key === '.') action = { type: 'decimal' };
      else if (keyboardOperations[event.key])
        action = { type: 'operator', value: keyboardOperations[event.key] };
      else if (event.key === '=' || event.key === 'Enter') action = { type: 'equals' };
      else if (event.key === 'Backspace') action = { type: 'backspace' };
      else if (event.key === 'Escape') action = { type: 'clear' };
      if (action) {
        event.preventDefault();
        dispatchAction(action);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatchAction]);

  const operatorButton = (operation: Operation) => (
    <button
      key={operation}
      type="button"
      className="key key--operator"
      aria-label={operation[0].toUpperCase() + operation.slice(1)}
      aria-pressed={pending?.operation === operation}
      disabled={submissionDisabled}
      onClick={() => dispatchAction({ type: 'operator', value: operation })}
    >
      {operationSymbols[operation]}
    </button>
  );

  const digitButton = (digit: string) => (
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
  const numberSize =
    entry.length > 18
      ? 'display__number--long'
      : entry.length > 10
        ? 'display__number--medium'
        : '';

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
            ref={numberDisplay}
            tabIndex={0}
            className={`display__number ${numberSize}`}
            aria-label="Result"
            aria-live="polite"
            aria-atomic="true"
          >
            {entry}
          </output>
        </div>
        <div className="display__feedback">
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <p role="status">
              {status === 'loading'
                ? isSlow
                  ? 'Still connecting. The free demo service may be starting.'
                  : 'Calculating…'
                : status === 'success'
                  ? 'Calculated'
                  : '\u00a0'}
            </p>
          )}
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
        {operatorButton('divide')}
        {['7', '8', '9'].map(digitButton)}
        {operatorButton('multiply')}
        {['4', '5', '6'].map(digitButton)}
        {operatorButton('subtract')}
        {['1', '2', '3'].map(digitButton)}
        {operatorButton('add')}
        {digitButton('0')}
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
