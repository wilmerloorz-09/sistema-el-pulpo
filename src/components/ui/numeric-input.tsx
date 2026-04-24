import * as React from "react";
import { Input } from "@/components/ui/input";
import {
  parseDecimalInput,
  parseIntegerInput,
  sanitizeDecimalInput,
  sanitizeIntegerInput,
} from "@/lib/numericInput";

interface NumericInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "inputMode" | "pattern"> {
  value: number | string | null | undefined;
  onValueChange: (value: number) => void;
  mode?: "integer" | "decimal";
  min?: number;
  max?: number;
  normalizeOnBlur?: boolean;
}

const clamp = (value: number, min?: number, max?: number) => {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
};

const formatValue = (value: NumericInputProps["value"]) => {
  if (value == null) return "";
  return String(value);
};

export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(({
  value,
  onValueChange,
  mode = "integer",
  min,
  max,
  normalizeOnBlur = true,
  onBlur,
  onFocus,
  ...props
}, ref) => {
  const [displayValue, setDisplayValue] = React.useState(formatValue(value));
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (focused) return;
    setDisplayValue(formatValue(value));
  }, [focused, value]);

  const sanitize = mode === "decimal" ? sanitizeDecimalInput : sanitizeIntegerInput;
  const parse = mode === "decimal" ? parseDecimalInput : parseIntegerInput;

  return (
    <Input
      {...props}
      ref={ref}
      type="text"
      inputMode={mode === "decimal" ? "decimal" : "numeric"}
      pattern={mode === "decimal" ? "[0-9]*[.,]?[0-9]*" : "[0-9]*"}
      value={displayValue}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextDisplayValue = sanitize(event.target.value);
        setDisplayValue(nextDisplayValue);
        onValueChange(clamp(parse(nextDisplayValue), min, max));
      }}
      onBlur={(event) => {
        setFocused(false);
        if (normalizeOnBlur) {
          const normalizedValue = clamp(parse(displayValue), min, max);
          setDisplayValue(String(normalizedValue));
          onValueChange(normalizedValue);
        }
        onBlur?.(event);
      }}
    />
  );
});

NumericInput.displayName = "NumericInput";
