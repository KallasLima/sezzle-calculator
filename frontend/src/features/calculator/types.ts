export type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

export interface Calculation {
  operation: Operation;
  a: number;
  b: number;
}

export type CalculatorAction =
  | { type: 'digit'; value: string }
  | { type: 'operator'; value: Operation }
  | { type: 'decimal' }
  | { type: 'sign' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'equals' };
