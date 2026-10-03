import type { Operation } from './types';

export const operationSymbols: Record<Operation, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
};

export const operationLabels: Record<Operation, string> = {
  add: 'Add',
  subtract: 'Subtract',
  multiply: 'Multiply',
  divide: 'Divide',
};
