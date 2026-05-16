import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
  /** Muestra botones − / + que respetan `min`, `max` y `incrementStep`. */
  showStepButtons?: boolean;
  incrementStep?: number;
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
  showStepButtons = false,
  incrementStep,
  onBlur,
  onFocus,
  className,
  disabled,
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
  const defaultStep = mode === "decimal" ? 0.01 : 1;
  const resolvedStep = incrementStep ?? defaultStep;

  const baseForStepButtons = (): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return clamp(value, min, max);
    }
    const asString = value != null ? String(value).trim() : "";
    if (asString !== "") {
      return clamp(parse(asString), min, max);
    }
    return clamp(parse(displayValue || "0"), min, max);
  };

  const applyStep = (direction: -1 | 1) => {
    const base = baseForStepButtons();
    let next = base + direction * resolvedStep;
    next = clamp(next, min, max);
    if (mode === "integer") {
      next = Math.trunc(next);
      next = clamp(next, min, max);
    }
    setFocused(false);
    setDisplayValue(String(next));
    onValueChange(next);
  };

  const steppingBase = baseForStepButtons();
  const hitMin = typeof min === "number" && steppingBase <= min;
  const hitMax = typeof max === "number" && steppingBase >= max;

  const control = (
    <Input
      {...props}
      ref={ref}
      disabled={disabled}
      type="text"
      inputMode={mode === "decimal" ? "decimal" : "numeric"}
      pattern={mode === "decimal" ? "[0-9]*[.,]?[0-9]*" : "[0-9]*"}
      value={displayValue}
      className={cn(showStepButtons && "min-w-0 flex-1", className)}
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

  if (!showStepButtons) {
    return control;
  }

  return (
    <div className="flex w-full items-stretch gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Disminuir"
        disabled={disabled || hitMin}
        className={cn(
          "h-auto shrink-0 self-stretch rounded-2xl border-orange-200/90 px-0",
          "aspect-square min-h-11 min-w-11 sm:min-h-12 sm:min-w-12 xl:min-h-14 xl:min-w-14",
        )}
        onClick={() => applyStep(-1)}
      >
        <Minus className="h-5 w-5" aria-hidden />
      </Button>
      {control}
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Aumentar"
        disabled={disabled || hitMax}
        className={cn(
          "h-auto shrink-0 self-stretch rounded-2xl border-orange-200/90 px-0",
          "aspect-square min-h-11 min-w-11 sm:min-h-12 sm:min-w-12 xl:min-h-14 xl:min-w-14",
        )}
        onClick={() => applyStep(1)}
      >
        <Plus className="h-5 w-5" aria-hidden />
      </Button>
    </div>
  );
});

NumericInput.displayName = "NumericInput";
