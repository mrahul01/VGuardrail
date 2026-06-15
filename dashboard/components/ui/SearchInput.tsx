"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils/cn";

export type SearchInputSize = "sm" | "md" | "lg";

export interface SearchInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "onChange" | "size"
  > {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onClear?: () => void;
  readonly size?: SearchInputSize;
  readonly wrapperClassName?: string;
}

const sizeStyles: Record<SearchInputSize, string> = {
  sm: "h-8 text-sm",
  md: "h-10 text-sm",
  lg: "h-11 text-base",
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      wrapperClassName,
      value,
      onValueChange,
      onClear,
      size = "md",
      placeholder = "Search…",
      disabled,
      "aria-label": ariaLabel = "Search",
      ...props
    },
    ref
  ) => {
    const id = useId();
    const hasValue = value.length > 0;
    return (
      <div
        className={cn(
          "relative flex items-center w-full",
          wrapperClassName
        )}
      >
        <span
          className="pointer-events-none absolute left-3 text-gray-400"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M9 3a6 6 0 100 12 6 6 0 000-12zM1 9a8 8 0 1114.32 4.9l4.4 4.4a1 1 0 01-1.42 1.42l-4.4-4.4A8 8 0 011 9z"
              clipRule="evenodd"
            />
          </svg>
        </span>
        <input
          ref={ref}
          id={id}
          type="search"
          role="searchbox"
          aria-label={ariaLabel}
          value={value}
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-9 pr-9 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-vg-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed",
            sizeStyles[size],
            className
          )}
          {...props}
        />
        {hasValue && !disabled && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onValueChange("");
              onClear?.();
            }}
            className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-vg-primary-500"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    );
  }
);

SearchInput.displayName = "SearchInput";
