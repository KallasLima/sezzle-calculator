import { useEffect, useRef, useState } from 'react';
import { calculate } from './api';
import type { Operation } from './api';

export const symbols: Record<Operation, string> = {
  add: '+', subtract: '−', multiply: '×', divide: '÷',
};

export type CalculatorAction =
  | { type: 'digit'; value: string }
  | { type: 'operator'; value: Operation }
  | { type: 'decimal' }
  | { type: 'sign' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'equals' };

type EntryAction = Extract<CalculatorAction, { type: 'digit' | 'decimal' | 'sign' | 'backspace' }>;

interface PendingOperation {
  operation: Operation;
  operand: number;
  text: string;
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

type Evaluation = { feedbackTimer?: ReturnType<typeof setTimeout> } & (
  | { kind: 'equals'; controller: AbortController }
  | { kind: 'chain'; controller: AbortController; queue: CalculatorAction[] });

const SLOW_REQUEST_MS = 8_000;

const initialState: CalculatorState = {
  entry: '0', entryMode: 'first', pending: null, expression: '', activity: { status: 'idle' },
};

// Entry editing is local text manipulation, never arithmetic.
function editEntry(before: CalculatorState, action: EntryAction): CalculatorState {
  const waiting = before.entryMode === 'waiting';
  const isResult = before.entryMode === 'result';
  let entry = before.entry;
  let entryMode: CalculatorState['entryMode'] = before.pending ? 'second' : 'first';

  switch (action.type) {
    case 'digit':
      if (isResult || waiting) entry = action.value;
      else if (entry === '0' || entry === '-0') entry = `${entry.startsWith('-') ? '-' : ''}${action.value}`;
      else entry += action.value;
      break;
    case 'decimal':
      if (isResult || waiting) entry = '0.';
      else if (!entry.includes('.')) entry += '.';
      break;
    case 'sign':
      entry = waiting ? '-0' : entry.startsWith('-') ? entry.slice(1) : `-${entry}`;
      if (isResult) entryMode = 'result';
      break;
    case 'backspace':
      if (waiting) return before;
      entry = isResult ? '0' : entry.slice(0, -1);
      if (entry === '' || entry === '-') entry = '0';
      break;
  }

  return { ...before, entry, entryMode,
    expression: before.pending ? `${before.pending.text} ${symbols[before.pending.operation]}` : '',
    activity: { status: 'idle' },
  };
}

export function useCalculator() {
  const [state, setState] = useState<CalculatorState>(initialState);
  // Event handlers and promise completions always see the latest transition,
  // even when several inputs arrive before React renders.
  const current = useRef(state);
  const request = useRef<Evaluation | null>(null);

  function update(next: CalculatorState) {
    current.current = next;
    setState(next);
  }

  function cancelRequest() {
    const active = request.current;
    request.current = null;
    if (active?.kind === 'chain') active.queue.length = 0;
    clearTimeout(active?.feedbackTimer);
    active?.controller.abort();
  }

  useEffect(() => () => { cancelRequest(); }, []);

  function fail(before: CalculatorState, message: string) {
    update({ ...before, activity: { status: 'error', message } });
  }

  // Replay only until another request starts. Its completion resumes this same
  // queue, including input that arrives while that later request is pending.
  function drain(queue: CalculatorAction[]) {
    while (queue.length && !request.current) {
      apply(queue.shift()!, queue);
      if (current.current.activity.status === 'error') {
        queue.length = 0;
        fail(current.current, `${current.current.activity.message} (queued input cleared)`);
        return;
      }
    }
  }

  async function evaluate(before: CalculatorState, nextOperation?: Operation, queue?: CalculatorAction[]) {
    const pending = before.pending;
    if (!pending || before.entryMode !== 'second' || request.current) return;
    const b = Number(before.entry);
    if (!Number.isFinite(b)) {
      fail(before, 'Enter a finite number within the supported range.');
      return;
    }

    const controller = new AbortController();
    // A supplied queue means chain mode even when empty. Passing the same queue
    // through later evaluations preserves input order across backend responses.
    const active: Evaluation = queue
      ? { kind: 'chain', controller, queue }
      : { kind: 'equals', controller };
    request.current = active;
    update({ ...before, activity: { status: 'loading', kind: active.kind, slow: false } });
    active.feedbackTimer = setTimeout(() => {
      if (request.current === active) {
        update({ ...current.current, activity: { status: 'loading', kind: active.kind, slow: true } });
      }
    }, SLOW_REQUEST_MS);

    let result: number;
    try {
      result = await calculate({ operation: pending.operation, a: pending.operand, b }, controller.signal);
    } catch (error) {
      if (request.current !== active) return;
      request.current = null;
      const message = error instanceof Error ? error.message : 'The calculation failed. Please try again.';
      if (active.kind === 'chain') active.queue.length = 0;
      // Keep only the failed operation for correction/retry. The continuation
      // cannot safely run without its result, so never replay it after failure.
      fail(before, active.kind === 'chain' ? `${message} (queued input cleared)` : message);
      return;
    } finally {
      clearTimeout(active.feedbackTimer);
    }

    // Abort alone cannot guard a response already completing when AC is pressed.
    if (request.current !== active) return;
    request.current = null;
    const entry = String(result);
    update({
      entry,
      entryMode: nextOperation ? 'waiting' : 'result',
      pending: nextOperation ? { operation: nextOperation, operand: result, text: entry } : null,
      expression: nextOperation
        ? `${entry} ${symbols[nextOperation]}`
        : `${pending.text} ${symbols[pending.operation]} ${before.entry}`,
      activity: { status: 'success' },
    });
    if (active.kind === 'chain') drain(active.queue);
  }

  function apply(action: CalculatorAction, queue?: CalculatorAction[]) {
    if (action.type === 'clear') {
      cancelRequest();
      update(initialState);
      return;
    }

    const active = request.current;
    if (active?.kind === 'chain') {
      active.queue.push(action);
      return;
    }
    if (active) {
      if (action.type === 'operator' || action.type === 'equals') return;
      // Preserve editing/cancellation for a standalone equals request.
      cancelRequest();
    }

    const before = current.current;
    if (action.type === 'equals') {
      void evaluate(before, undefined, queue);
    } else if (action.type === 'operator') {
      if (before.pending && before.entryMode === 'second') {
        // Choosing an operator commits this operand and begins a chain.
        void evaluate(before, action.value, queue ?? []);
        return;
      }
      const operand = Number(before.entry);
      if (!Number.isFinite(operand)) {
        fail(before, 'Enter a finite number within the supported range.');
        return;
      }
      update({ ...before,
        pending: { operation: action.value, operand, text: before.entry },
        entryMode: 'waiting', expression: `${before.entry} ${symbols[action.value]}`,
        activity: { status: 'idle' },
      });
    } else {
      update(editEntry(before, action));
    }
  }

  return {
    entry: state.entry, pending: state.pending, expression: state.expression,
    hasSecondOperand: state.entryMode === 'second',
    status: state.activity.status,
    error: state.activity.status === 'error' ? state.activity.message : null,
    isChaining: state.activity.status === 'loading' && state.activity.kind === 'chain',
    isSlow: state.activity.status === 'loading' && state.activity.slow,
    act: (action: CalculatorAction) => apply(action),
  };
}
