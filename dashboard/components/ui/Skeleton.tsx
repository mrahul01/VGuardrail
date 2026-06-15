"use client";

import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  readonly variant?: "text" | "circular" | "rectangular" | "rounded";
  readonly width?: string | number;
  readonly height?: string | number;
  readonly lines?: number;
}

const variantStyles: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  text: "rounded h-4",
  circular: "rounded-full",
  rectangular: "rounded-none",
  rounded: "rounded-md",
};

function toSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

export function Skeleton({
  className,
  variant = "text",
  width,
  height,
  style,
  ...props
}: SkeletonProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "animate-pulse bg-gray-200 dark:bg-gray-700",
        variantStyles[variant],
        className
      )}
      style={{
        width: toSize(width),
        height: toSize(height),
        ...style,
      }}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  readonly lines?: number;
  readonly lastLineWidth?: string;
}

export function SkeletonText({
  className,
  lines = 3,
  lastLineWidth = "60%",
  ...props
}: SkeletonTextProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("space-y-2", className)}
      {...props}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          variant="text"
          width={i === lines - 1 ? lastLineWidth : "100%"}
        />
      ))}
    </div>
  );
}

export interface SkeletonCardProps extends HTMLAttributes<HTMLDivElement> {
  readonly showHeader?: boolean;
  readonly showFooter?: boolean;
  readonly bodyLines?: number;
}

export function SkeletonCard({
  className,
  showHeader = true,
  showFooter = false,
  bodyLines = 3,
  ...props
}: SkeletonCardProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5",
        className
      )}
      {...props}
    >
      {showHeader && (
        <div className="mb-4 space-y-2">
          <Skeleton width="40%" height={16} />
          <Skeleton width="70%" height={12} />
        </div>
      )}
      <SkeletonText lines={bodyLines} />
      {showFooter && (
        <div className="mt-4 flex justify-end gap-2">
          <Skeleton width={80} height={32} variant="rounded" />
          <Skeleton width={80} height={32} variant="rounded" />
        </div>
      )}
    </div>
  );
}
