import { useEffect, useRef, useState } from 'react';
import { calculate } from './calculatorApi';
import type { CalculatorAction, Operation } from './types';
import { operationSymbols } from './operations';

type EntryAction = Extract<CalculatorAction, { type: 'digit' | 'decimal' | 'sign' | 'backspace' }>;

interface PendingOperation {
  operation: Operation;
  firstOperand: number;
  firstOperandText: string;
}

type Activity =
  | { status: 'idle' | 'success' }
  | { status: 'error'; message: string }
  | { status: 'loading'; kind: 'chain' | 'equals'; slow: boolean };

interface CalculatorState {
  entry: string;
  entryMode: 'first' | 'waiting' | 'second' | 'result';
  pending: PendingOperation | null;
  expression: string;
  activity: Activity;
}

interface ChainContext {
  kind: 'chain';
  queue: CalculatorAction[];
}

type EvaluationContext = { kind: 'equals' } | ChainContext;

interface EvaluationRequest {
  before: CalculatorState;
  context: EvaluationContext;
  nextOperation?: Operation;
}

interface ActiveRequest {
  controller: AbortController;
  context: EvaluationContext;
  feedbackTimer?: ReturnType<typeof setTimeout>;
}

const SLOW_REQUEST_MS = 8_000;

const initialState: CalculatorState = {
  entry: '0',
  entryMode: 'first',
  pending: null,
  expression: '',
  activity: { status: 'idle' },
};

// Entry editing is local text manipulation, never arithmetic.
function editEntry(before: CalculatorState, action: EntryAction): CalculatorState {
  const waiting = before.entryMode === 'waiting';
  const isResult = before.entryMode === 'result';
  let entry = before.entry;
  let entryMode: CalculatorState['entryMode'] = before.pending ? 'second' : 'first';

  switch (action.type) {
    case 'digit':
      if (isResult || waiting) {
        entry = action.value;
      } else if (entry === '0' || entry === '-0') {
        entry = `${entry.startsWith('-') ? '-' : ''}${action.value}`;
      } else {
        entry += action.value;
      }
      break;
    case 'decimal':
      if (isResult || waiting) {
        entry = '0.';
      } else if (!entry.includes('.')) {
        entry += '.';
      }
      break;
    case 'sign':
      if (waiting) {
        entry = '-0';
      } else if (entry.startsWith('-')) {
        entry = entry.slice(1);
      } else {
        entry = `-${entry}`;
      }
      if (isResult) {
        entryMode = 'result';
      }
      break;
    case 'backspace':
      if (waiting) {
        return before;
      }
      entry = isResult ? '0' : entry.slice(0, -1);
      if (entry === '' || entry === '-') {
        entry = '0';
      }
      break;
  }

  return {
    ...before,
    entry,
    entryMode,
    expression: before.pending
      ? `${before.pending.firstOperandText} ${operationSymbols[before.pending.operation]}`
      : '',
    activity: { status: 'idle' },
  };
}

export function useCalculator() {
  const [state, setState] = useState<CalculatorState>(initialState);
  // Event handlers and promise completions always see the latest transition,
  // even when several inputs arrive before React renders.
  const stateRef = useRef(state);
  const activeRequestRef = useRef<ActiveRequest | null>(null);

  function update(next: CalculatorState) {
    stateRef.current = next;
    setState(next);
  }

  function cancelRequest() {
    const active = activeRequestRef.current;
    activeRequestRef.current = null;
    if (active?.context.kind === 'chain') {
      active.context.queue.length = 0;
    }
    clearTimeout(active?.feedbackTimer);
    active?.controller.abort();
  }

  useEffect(
    () => () => {
      cancelRequest();
    },
    [],
  );

  function fail(before: CalculatorState, message: string) {
    update({ ...before, activity: { status: 'error', message } });
  }

  // Replay only until another request starts. Its completion resumes this same
  // queue, including input that arrives while that later request is pending.
  function processQueuedActions(context: ChainContext) {
    const { queue } = context;
    while (queue.length && !activeRequestRef.current) {
      dispatchAction(queue.shift()!, context);
      if (stateRef.current.activity.status === 'error') {
        queue.length = 0;
        fail(stateRef.current, `${stateRef.current.activity.message} (queued input cleared)`);
        return;
      }
    }
  }

  async function evaluatePendingOperation({ before, context, nextOperation }: EvaluationRequest) {
    const pending = before.pending;
    if (!pending || before.entryMode !== 'second' || activeRequestRef.current) {
      return;
    }
    const secondOperand = Number(before.entry);
    if (!Number.isFinite(secondOperand)) {
      fail(before, 'Enter a finite number within the supported range.');
      return;
    }

    const controller = new AbortController();
    const active: ActiveRequest = { controller, context };
    activeRequestRef.current = active;
    update({ ...before, activity: { status: 'loading', kind: context.kind, slow: false } });
    active.feedbackTimer = setTimeout(() => {
      if (activeRequestRef.current === active) {
        update({
          ...stateRef.current,
          activity: { status: 'loading', kind: context.kind, slow: true },
        });
      }
    }, SLOW_REQUEST_MS);

    let result: number;
    try {
      result = await calculate(
        { operation: pending.operation, a: pending.firstOperand, b: secondOperand },
        controller.signal,
      );
    } catch (error) {
      if (activeRequestRef.current !== active) {
        return;
      }
      activeRequestRef.current = null;
      const message =
        error instanceof Error ? error.message : 'The calculation failed. Please try again.';
      if (context.kind === 'chain') {
        context.queue.length = 0;
      }
      // Keep only the failed operation for correction/retry. The continuation
      // cannot safely run without its result, so never replay it after failure.
      fail(before, context.kind === 'chain' ? `${message} (queued input cleared)` : message);
      return;
    } finally {
      clearTimeout(active.feedbackTimer);
    }

    // Abort alone cannot guard a response already completing when AC is pressed.
    if (activeRequestRef.current !== active) {
      return;
    }
    activeRequestRef.current = null;
    const entry = String(result);
    update({
      entry,
      entryMode: nextOperation ? 'waiting' : 'result',
      pending: nextOperation
        ? { operation: nextOperation, firstOperand: result, firstOperandText: entry }
        : null,
      expression: nextOperation
        ? `${entry} ${operationSymbols[nextOperation]}`
        : `${pending.firstOperandText} ${operationSymbols[pending.operation]} ${before.entry}`,
      activity: { status: 'success' },
    });
    if (context.kind === 'chain') {
      processQueuedActions(context);
    }
  }

  function dispatchAction(
    action: CalculatorAction,
    context: EvaluationContext = { kind: 'equals' },
  ) {
    if (action.type === 'clear') {
      cancelRequest();
      update(initialState);
      return;
    }

    const active = activeRequestRef.current;
    if (active?.context.kind === 'chain') {
      active.context.queue.push(action);
      return;
    }
    if (active) {
      if (action.type === 'operator' || action.type === 'equals') {
        return;
      }
      // Preserve editing/cancellation for a standalone equals request.
      cancelRequest();
    }

    const before = stateRef.current;
    if (action.type === 'equals') {
      // Replayed equals retains its chain context even with an empty queue, so
      // later input joins that same queue instead of cancelling this request.
      void evaluatePendingOperation({ before, context });
    } else if (action.type === 'operator') {
      if (before.pending && before.entryMode === 'second') {
        // Choosing an operator commits this operand and begins a chain.
        const chainContext: ChainContext =
          context.kind === 'chain' ? context : { kind: 'chain', queue: [] };
        void evaluatePendingOperation({
          before,
          context: chainContext,
          nextOperation: action.value,
        });
        return;
      }
      const firstOperand = Number(before.entry);
      if (!Number.isFinite(firstOperand)) {
        fail(before, 'Enter a finite number within the supported range.');
        return;
      }
      update({
        ...before,
        pending: { operation: action.value, firstOperand, firstOperandText: before.entry },
        entryMode: 'waiting',
        expression: `${before.entry} ${operationSymbols[action.value]}`,
        activity: { status: 'idle' },
      });
    } else {
      update(editEntry(before, action));
    }
  }

  return {
    entry: state.entry,
    pending: state.pending,
    expression: state.expression,
    hasSecondOperand: state.entryMode === 'second',
    status: state.activity.status,
    error: state.activity.status === 'error' ? state.activity.message : null,
    isChaining: state.activity.status === 'loading' && state.activity.kind === 'chain',
    isSlow: state.activity.status === 'loading' && state.activity.slow,
    dispatchAction,
  };
}
