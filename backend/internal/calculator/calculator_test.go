package calculator_test

import (
	"errors"
	"math"
	"testing"

	"github.com/KallasLima/sezzle-calculator/backend/internal/calculator"
)

func TestCalculate(t *testing.T) {
	tests := []struct {
		name      string
		operation string
		a, b      float64
		want      float64
	}{
		{"addition", "add", 2, 3, 5},
		{"subtraction", "subtract", 2, 3, -1},
		{"multiplication", "multiply", 12, 2, 24},
		{"division", "divide", 7, 2, 3.5},
		{"zero operands", "add", 0, 0, 0},
		{"negative operands", "add", -2, -3, -5},
		{"negative product", "multiply", -3, 2, -6},
		{"negative divisor", "divide", 6, -2, -3},
		{"zero numerator", "divide", 0, 2, 0},
		{"decimal operands", "subtract", 1.25, 0.5, 0.75},
		{"no arbitrary rounding", "add", 0.1, 0.2, 0.30000000000000004},
		{"largest finite result", "multiply", math.MaxFloat64, 1, math.MaxFloat64},
		{"underflow follows float64", "divide", math.SmallestNonzeroFloat64, 2, 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := calculator.Calculate(test.operation, test.a, test.b)
			if err != nil {
				t.Fatalf("Calculate() error = %v", err)
			}
			if got != test.want {
				t.Errorf("Calculate() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestCalculateErrors(t *testing.T) {
	tests := []struct {
		name      string
		operation string
		a, b      float64
		want      error
	}{
		{"zero divisor", "divide", 4, 0, calculator.ErrDivisionByZero},
		{"negative zero divisor", "divide", 4, math.Copysign(0, -1), calculator.ErrDivisionByZero},
		{"zero divided by zero", "divide", 0, 0, calculator.ErrDivisionByZero},
		{"unsupported operation", "power", 2, 3, calculator.ErrUnknownOperation},
		{"empty operation", "", 2, 3, calculator.ErrUnknownOperation},
		{"case sensitive operation", "ADD", 2, 3, calculator.ErrUnknownOperation},
		{"nonfinite first operand", "add", math.Inf(1), 3, calculator.ErrInvalidInput},
		{"nonfinite second operand", "add", 2, math.Inf(-1), calculator.ErrInvalidInput},
		{"NaN first operand", "add", math.NaN(), 3, calculator.ErrInvalidInput},
		{"NaN second operand", "add", 2, math.NaN(), calculator.ErrInvalidInput},
		{"addition overflow", "add", math.MaxFloat64, math.MaxFloat64, calculator.ErrResultOutOfRange},
		{"subtraction overflow", "subtract", -math.MaxFloat64, math.MaxFloat64, calculator.ErrResultOutOfRange},
		{"multiplication overflow", "multiply", math.MaxFloat64, 2, calculator.ErrResultOutOfRange},
		{"division overflow", "divide", math.MaxFloat64, 0.5, calculator.ErrResultOutOfRange},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := calculator.Calculate(test.operation, test.a, test.b)
			if !errors.Is(err, test.want) {
				t.Errorf("Calculate() error = %v, want %v", err, test.want)
			}
		})
	}
}
