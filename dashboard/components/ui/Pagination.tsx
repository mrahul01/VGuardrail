"use client";

import { ButtonHTMLAttributes, HTMLAttributes, forwardRef, useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";

export interface PaginationProps extends HTMLAttributes<HTMLElement> {
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  readonly siblingCount?: number;
  readonly showPerPage?: boolean;
  readonly perPageOptions?: readonly number[];
  readonly onPerPageChange?: (perPage: number) => void;
  readonly ariaLabel?: string;
}

function range(start: number, end: number): number[] {
  const length = end - start + 1;
  return Array.from({ length }, (_, i) => start + i);
}

function buildPageRange(
  current: number,
  totalPages: number,
  siblingCount: number
): (number | "ellipsis")[] {
  const totalNumbers = siblingCount * 2 + 5;
  if (totalPages <= totalNumbers) {
    return range(1, totalPages);
  }
  const leftSibling = Math.max(current - siblingCount, 1);
  const rightSibling = Math.min(current + siblingCount, totalPages);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < totalPages - 1;

  if (!showLeftEllipsis && showRightEllipsis) {
    const leftRange = range(1, 3 + 2 * siblingCount);
    return [...leftRange, "ellipsis", totalPages];
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    const rightRange = range(
      totalPages - (3 + 2 * siblingCount) + 1,
      totalPages
    );
    return [1, "ellipsis", ...rightRange];
  }
  return [
    1,
    "ellipsis",
    ...range(leftSibling, rightSibling),
    "ellipsis",
    totalPages,
  ];
}

export const Pagination = forwardRef<HTMLElement, PaginationProps>(
  (
    {
      className,
      page,
      perPage,
      total,
      onPageChange,
      siblingCount = 1,
      showPerPage = true,
      perPageOptions = [10, 25, 50, 100],
      onPerPageChange,
      ariaLabel = "Pagination",
      ...props
    },
    ref
  ) => {
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const pageItems = useMemo(
      () => buildPageRange(safePage, totalPages, siblingCount),
      [safePage, totalPages, siblingCount]
    );

    const firstItem = total === 0 ? 0 : (safePage - 1) * perPage + 1;
    const lastItem = Math.min(safePage * perPage, total);

    const goTo = (next: number): void => {
      if (next < 1 || next > totalPages) return;
      if (next !== safePage) onPageChange(next);
    };

    return (
      <nav
        ref={ref}
        role="navigation"
        aria-label={ariaLabel}
        className={cn(
          "flex flex-col sm:flex-row items-center justify-between gap-3",
          className
        )}
        {...props}
      >
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {total === 0 ? (
            <span>No results</span>
          ) : (
            <span>
              Showing <span className="font-medium">{firstItem}</span>–
              <span className="font-medium">{lastItem}</span> of{" "}
              <span className="font-medium">{total}</span>
            </span>
          )}
        </div>

        <ul className="flex items-center gap-1">
          <li>
            <PaginationButton
              onClick={() => goTo(safePage - 1)}
              disabled={safePage <= 1}
              aria-label="Previous page"
            >
              ‹
            </PaginationButton>
          </li>
          {pageItems.map((item, idx) => {
            if (item === "ellipsis") {
              return (
                <li
                  key={`ellipsis-${idx}`}
                  className="px-2 text-gray-500 select-none"
                  aria-hidden="true"
                >
                  …
                </li>
              );
            }
            const isActive = item === safePage;
            return (
              <li key={item}>
                <PaginationButton
                  onClick={() => goTo(item)}
                  active={isActive}
                  aria-label={`Go to page ${item}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item}
                </PaginationButton>
              </li>
            );
          })}
          <li>
            <PaginationButton
              onClick={() => goTo(safePage + 1)}
              disabled={safePage >= totalPages}
              aria-label="Next page"
            >
              ›
            </PaginationButton>
          </li>
        </ul>

        {showPerPage && onPerPageChange && (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <label htmlFor={`${ariaLabel}-per-page`} className="sr-only">
              Items per page
            </label>
            <span>Rows</span>
            <select
              id={`${ariaLabel}-per-page`}
              value={perPage}
              onChange={(e) => onPerPageChange(Number(e.target.value))}
              className="h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-2 focus:outline-none focus:ring-2 focus:ring-vg-primary-500"
            >
              {perPageOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
      </nav>
    );
  }
);

Pagination.displayName = "Pagination";

interface PaginationButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly active?: boolean;
}

function PaginationButton({
  active = false,
  className,
  children,
  ...props
}: PaginationButtonProps): JSX.Element {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      className={cn(
        "h-8 min-w-[2rem] px-2 text-sm",
        active && "pointer-events-none",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );
}
