"use client";

import { HTMLAttributes, ReactNode } from "react";
import { CircleAlert, Inbox, Lock, SearchX } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type EmptyStateVariant =
  | "default"
  | "no-results"
  | "no-data"
  | "error"
  | "unauthorized";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
  readonly variant?: EmptyStateVariant;
  readonly size?: "sm" | "md" | "lg";
}

const variantStyles: Record<
  EmptyStateVariant,
  { iconWrapper: string; title: string }
> = {
  default: {
    iconWrapper: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
    title: "text-gray-900 dark:text-gray-100",
  },
  "no-results": {
    iconWrapper: "bg-blue-50 text-blue-500 dark:bg-blue-900/20 dark:text-blue-400",
    title: "text-gray-900 dark:text-gray-100",
  },
  "no-data": {
    iconWrapper: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
    title: "text-gray-900 dark:text-gray-100",
  },
  error: {
    iconWrapper: "bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400",
    title: "text-red-700 dark:text-red-400",
  },
  unauthorized: {
    iconWrapper:
      "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400",
    title: "text-gray-900 dark:text-gray-100",
  },
};

const sizeStyles: Record<
  NonNullable<EmptyStateProps["size"]>,
  { container: string; icon: string; title: string; description: string }
> = {
  sm: {
    container: "py-6",
    icon: "h-8 w-8",
    title: "text-sm font-medium",
    description: "text-xs",
  },
  md: {
    container: "py-10",
    icon: "h-10 w-10",
    title: "text-base font-semibold",
    description: "text-sm",
  },
  lg: {
    container: "py-16",
    icon: "h-12 w-12",
    title: "text-lg font-semibold",
    description: "text-base",
  },
};

function DefaultIcon({ variant }: { variant: EmptyStateVariant }): JSX.Element {
  const className = "h-6 w-6";
  switch (variant) {
    case "no-results":
      return <SearchX className={className} aria-hidden="true" />;
    case "error":
      return <CircleAlert className={className} aria-hidden="true" />;
    case "unauthorized":
      return <Lock className={className} aria-hidden="true" />;
    default:
      return <Inbox className={className} aria-hidden="true" />;
  }
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  variant = "default",
  size = "md",
  className,
  ...props
}: EmptyStateProps): JSX.Element {
  const v = variantStyles[variant];
  const s = sizeStyles[size];
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center text-center px-4",
        s.container,
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "rounded-full flex items-center justify-center mb-3",
          v.iconWrapper,
          s.icon
        )}
        aria-hidden="true"
      >
        {icon ?? <DefaultIcon variant={variant} />}
      </div>
      <h3 className={cn(s.title, v.title)}>{title}</h3>
      {description && (
        <p
          className={cn(
            "text-gray-500 dark:text-gray-400 mt-1 max-w-md",
            s.description
          )}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
