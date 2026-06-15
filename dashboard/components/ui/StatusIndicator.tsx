"use client";

import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type StatusTone =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "neutral"
  | "pending";

export type StatusSize = "sm" | "md" | "lg";

export interface StatusIndicatorProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly tone: StatusTone;
  readonly label?: string;
  readonly size?: StatusSize;
  readonly pulse?: boolean;
  readonly children?: React.ReactNode;
}

const toneStyles: Record<StatusTone, { dot: string; text: string; ring: string }> = {
  success: {
    dot: "bg-green-500",
    text: "text-green-700 dark:text-green-400",
    ring: "ring-green-500/30",
  },
  error: {
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
    ring: "ring-red-500/30",
  },
  warning: {
    dot: "bg-yellow-500",
    text: "text-yellow-700 dark:text-yellow-400",
    ring: "ring-yellow-500/30",
  },
  info: {
    dot: "bg-blue-500",
    text: "text-blue-700 dark:text-blue-400",
    ring: "ring-blue-500/30",
  },
  neutral: {
    dot: "bg-gray-400",
    text: "text-gray-700 dark:text-gray-400",
    ring: "ring-gray-500/30",
  },
  pending: {
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    ring: "ring-amber-500/30",
  },
};

const sizeStyles: Record<StatusSize, { dot: string; text: string }> = {
  sm: { dot: "h-1.5 w-1.5", text: "text-xs" },
  md: { dot: "h-2 w-2", text: "text-sm" },
  lg: { dot: "h-2.5 w-2.5", text: "text-base" },
};

export function StatusIndicator({
  tone,
  size = "md",
  pulse = false,
  label,
  className,
  children,
  ...props
}: StatusIndicatorProps): JSX.Element {
  const styles = toneStyles[tone];
  const sizes = sizeStyles[size];
  const text = label ?? children;
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2",
        styles.text,
        sizes.text,
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex items-center justify-center rounded-full",
          sizes.dot
        )}
      >
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-60",
            pulse && "animate-ping",
            styles.dot
          )}
        />
        <span
          className={cn(
            "relative inline-flex rounded-full h-full w-full",
            styles.dot
          )}
        />
      </span>
      {text !== undefined && text !== null && (
        <span className="font-medium">{text}</span>
      )}
    </span>
  );
}

export interface SeverityIndicatorProps
  extends Omit<StatusIndicatorProps, "tone"> {
  readonly severity: "low" | "medium" | "high" | "critical";
}

const severityToTone: Record<
  SeverityIndicatorProps["severity"],
  StatusTone
> = {
  low: "info",
  medium: "warning",
  high: "error",
  critical: "error",
};

const severityLabel: Record<SeverityIndicatorProps["severity"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function SeverityIndicator({
  severity,
  label,
  ...props
}: SeverityIndicatorProps): JSX.Element {
  return (
    <StatusIndicator
      tone={severityToTone[severity]}
      pulse={severity === "critical"}
      label={label ?? severityLabel[severity]}
      {...props}
    />
  );
}

export interface DecisionIndicatorProps
  extends Omit<StatusIndicatorProps, "tone"> {
  readonly decision: "allow" | "warn" | "block";
}

const decisionToTone: Record<
  DecisionIndicatorProps["decision"],
  StatusTone
> = {
  allow: "success",
  warn: "warning",
  block: "error",
};

const decisionLabel: Record<DecisionIndicatorProps["decision"], string> = {
  allow: "Allowed",
  warn: "Warned",
  block: "Blocked",
};

export function DecisionIndicator({
  decision,
  label,
  ...props
}: DecisionIndicatorProps): JSX.Element {
  return (
    <StatusIndicator
      tone={decisionToTone[decision]}
      label={label ?? decisionLabel[decision]}
      {...props}
    />
  );
}
