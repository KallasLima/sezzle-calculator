// Package calculator implements the four supported arithmetic operations.
// It has no dependency on HTTP or presentation code.
package calculator

import (
	"errors"
	"math"
)

var (
	ErrInvalidInput     = errors.New("operands must be finite numbers")
	ErrUnknownOperation = errors.New("operation must be add, subtract, multiply, or divide")
	ErrDivisionByZero   = errors.New("cannot divide by zero")
	ErrResultOutOfRange = errors.New("result is outside the finite number range")
)

// Calculate uses ordinary float64 arithmetic without rounding the result.
func Calculate(operation string, a, b float64) (float64, error) {
	if !isFinite(a) || !isFinite(b) {
		return 0, ErrInvalidInput
	}

	var result float64
	switch operation {
	case "add":
		result = a + b
	case "subtract":
		result = a - b
	case "multiply":
		result = a * b
	case "divide":
		if b == 0 {
			return 0, ErrDivisionByZero
		}
		result = a / b
	default:
		return 0, ErrUnknownOperation
	}

	if !isFinite(result) {
		return 0, ErrResultOutOfRange
	}
	return result, nil
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
