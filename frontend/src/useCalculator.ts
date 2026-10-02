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

interface PendingOperation {
  operation: Operation;
  operand: number;
  text: string;
}

interface CalculatorState {
  entry: string;
  pending: PendingOperation | null;
  hasSecondOperand: boolean;
  isResult: boolean;
  expression: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
}

const initialState: CalculatorState = {
  entry: '0', pending: null, hasSecondOperand: false, isResult: false,
  expression: '', status: 'idle', error: null,
};

export function useCalculator() {
  const [state, setState] = useState<CalculatorState>(initialState);
  // The ref also guards rapid events that arrive before React has rendered.
  const current = useRef(state);
  const request = useRef<AbortController | null>(null);

  function update(next: CalculatorState) {
    current.current = next;
    setState(next);
  }

  function cancelRequest() {
    request.current?.abort();
    request.current = null;
  }

  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  async function evaluate(before: CalculatorState, nextOperation?: Operation) {
    const pending = before.pending;
    if (!pending || !before.hasSecondOperand || request.current) return;
    const b = Number(before.entry);
    if (!Number.isFinite(b)) {
      update({ ...before, status: 'error', error: 'Enter a finite number within the supported range.' });
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    update({ ...before, status: 'loading', error: null });

    try {
      const result = await calculate({ operation: pending.operation, a: pending.operand, b }, controller.signal);
      // Abort alone is insufficient: a response can already be completing when AC is pressed.
      if (request.current !== controller) return;
      const entry = String(result);
      update({
        entry,
        pending: nextOperation ? { operation: nextOperation, operand: result, text: entry } : null,
        hasSecondOperand: false,
        isResult: !nextOperation,
        expression: nextOperation
          ? `${entry} ${symbols[nextOperation]}`
          : `${pending.text} ${symbols[pending.operation]} ${before.entry}`,
        status: 'success',
        error: null,
      });
    } catch (error) {
      if (request.current !== controller) return;
      update({ ...before, status: 'error', error: error instanceof Error ? error.message : 'The calculation failed. Please try again.' });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function act(action: CalculatorAction) {
    const before = current.current;
    if (action.type === 'clear') {
      cancelRequest();
      update(initialState);
      return;
    }

    if (action.type === 'operator' || action.type === 'equals') {
      if (request.current) return;
      if (action.type === 'equals') {
        void evaluate(before);
        return;
      }
      if (before.pending && before.hasSecondOperand) {
        void evaluate(before, action.value);
        return;
      }
      const operand = Number(before.entry);
      if (!Number.isFinite(operand)) {
        update({ ...before, status: 'error', error: 'Enter a finite number within the supported range.' });
        return;
      }
      update({ ...before,
        pending: { operation: action.value, operand, text: before.entry },
        hasSecondOperand: false, isResult: false,
        expression: `${before.entry} ${symbols[action.value]}`, status: 'idle', error: null,
      });
      return;
    }

    cancelRequest();
    const waiting = before.pending !== null && !before.hasSecondOperand;
    let entry = before.entry;
    let isResult = false;
    if (action.type === 'digit') {
      if (before.isResult || waiting) entry = action.value;
      else if (entry === '0' || entry === '-0') entry = `${entry.startsWith('-') ? '-' : ''}${action.value}`;
      else entry += action.value;
    } else if (action.type === 'decimal') {
      if (before.isResult || waiting) entry = '0.';
      else if (!entry.includes('.')) entry += '.';
    } else if (action.type === 'sign') {
      if (waiting) entry = '-0';
      else entry = entry.startsWith('-') ? entry.slice(1) : `-${entry}`;
      isResult = before.isResult;
    } else if (action.type === 'backspace') {
      if (waiting) return;
      if (before.isResult) entry = '0';
      else {
        entry = entry.slice(0, -1);
        if (entry === '' || entry === '-') entry = '0';
      }
    }

    update({ ...before, entry, isResult,
      hasSecondOperand: before.pending !== null,
      expression: before.pending ? `${before.pending.text} ${symbols[before.pending.operation]}` : '',
      status: 'idle', error: null,
    });
  }

  return { ...state, act };
}
