"use client";

import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeVariant = 
  | "default" 
  | "success" 
  | "error" 
  | "warning" 
  | "info" 
  | "outline"
  | "secondary";

export type BadgeSize = "sm" | "md" | "lg";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly variant?: BadgeVariant;
  readonly size?: BadgeSize;
  readonly dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  outline: "border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300",
  secondary: "bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-gray-100",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
  lg: "px-3 py-1 text-sm",
};

const dotStyles: Record<BadgeVariant, string> = {
  default: "bg-gray-400",
  success: "bg-green-500",
  error: "bg-red-500",
  warning: "bg-yellow-500",
  info: "bg-blue-500",
  outline: "bg-gray-400",
  secondary: "bg-gray-500",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", size = "md", dot = false, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center font-medium rounded-full",
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full mr-1.5 flex-shrink-0",
              dotStyles[variant]
            )}
            aria-hidden="true"
          />
        )}
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";

// Status badge with predefined semantic variants
export interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  readonly status: "active" | "inactive" | "pending" | "running" | "completed" | "failed" | "warning";
}

const statusVariantMap: Record<StatusBadgeProps["status"], BadgeVariant> = {
  active: "success",
  inactive: "default",
  pending: "warning",
  running: "info",
  completed: "success",
  failed: "error",
  warning: "warning",
};

const statusDotMap: Record<StatusBadgeProps["status"], boolean> = {
  active: true,
  inactive: false,
  pending: true,
  running: true,
  completed: true,
  failed: true,
  warning: true,
};

export function StatusBadge({ status, size = "md", className, ...props }: StatusBadgeProps) {
  return (
    <Badge
      variant={statusVariantMap[status]}
      size={size}
      dot={statusDotMap[status]}
      className={className}
      {...props}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}