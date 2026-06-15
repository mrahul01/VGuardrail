"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils/cn";

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface DateRangePickerProps {
  readonly value: DateRange;
  readonly onChange: (range: DateRange) => void;
  readonly label?: string;
  readonly fromLabel?: string;
  readonly toLabel?: string;
  readonly min?: string;
  readonly max?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly id?: string;
}

export const DateRangePicker = forwardRef<HTMLDivElement, DateRangePickerProps>(
  (
    {
      value,
      onChange,
      label,
      fromLabel = "From",
      toLabel = "To",
      min,
      max,
      disabled = false,
      className,
      id,
    },
    ref
  ) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const fromId = `${fieldId}-from`;
    const toId = `${fieldId}-to`;

    const handleFromChange = (next: string): void => {
      onChange({ from: next, to: value.to });
    };
    const handleToChange = (next: string): void => {
      onChange({ from: value.from, to: next });
    };

    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-1", className)}
        data-testid="date-range-picker"
      >
        {label && (
          <span
            id={fieldId}
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
          </span>
        )}
        <div
          className={cn(
            "flex items-center gap-2",
            disabled && "opacity-50"
          )}
          role="group"
          aria-labelledby={label ? fieldId : undefined}
        >
          <label
            htmlFor={fromId}
            className="sr-only"
          >
            {fromLabel}
          </label>
          <input
            id={fromId}
            type="date"
            value={value.from}
            min={min}
            max={max}
            disabled={disabled}
            onChange={(e) => handleFromChange(e.target.value)}
            aria-label={fromLabel}
            className={cn(
              "h-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-vg-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          />
          <span aria-hidden="true" className="text-gray-400">
            →
          </span>
          <label htmlFor={toId} className="sr-only">
            {toLabel}
          </label>
          <input
            id={toId}
            type="date"
            value={value.to}
            min={value.from || min}
            max={max}
            disabled={disabled}
            onChange={(e) => handleToChange(e.target.value)}
            aria-label={toLabel}
            className={cn(
              "h-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-vg-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          />
        </div>
      </div>
    );
  }
);

DateRangePicker.displayName = "DateRangePicker";

export interface PresetDateRange {
  readonly id: string;
  readonly label: string;
  readonly range: DateRange;
}

export function buildPresetDateRanges(
  today: Date = new Date()
): PresetDateRange[] {
  const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);

  const make = (daysBack: number): DateRange => {
    const from = new Date(today);
    from.setDate(from.getDate() - daysBack);
    return { from: isoDate(from), to: isoDate(endOfToday) };
  };

  return [
    { id: "24h", label: "Last 24h", range: make(1) },
    { id: "7d", label: "Last 7 days", range: make(7) },
    { id: "30d", label: "Last 30 days", range: make(30) },
    { id: "90d", label: "Last 90 days", range: make(90) },
  ];
}
