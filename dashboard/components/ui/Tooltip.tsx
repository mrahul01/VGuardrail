"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface TooltipProps {
  readonly children: ReactNode;
  readonly content: ReactNode;
  readonly side?: "top" | "bottom";
  readonly className?: string;
}

/**
 * Lightweight CSS-only tooltip (no portal, no positioning JS).
 *
 * Shown on hover and on keyboard focus of anything inside the wrapper. To
 * tooltip a disabled button (which swallows pointer events), wrap the button
 * in a focusable element, e.g. `<Tooltip ...><span tabIndex={0}>…</span></Tooltip>`.
 */
export function Tooltip({
  children,
  content,
  side = "top",
  className,
}: TooltipProps): JSX.Element {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-40 w-max max-w-xs -translate-x-1/2",
          "rounded-md bg-gray-900 dark:bg-gray-700 px-2.5 py-1.5 text-xs text-white shadow-lg",
          "opacity-0 transition-opacity duration-100",
          "group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
        )}
      >
        {content}
      </span>
    </span>
  );
}
