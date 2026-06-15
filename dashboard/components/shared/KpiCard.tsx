"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils/cn";

export type KpiTrend = "up" | "down" | "flat";

export interface KpiCardProps {
  readonly label: string;
  readonly value: string;
  readonly trend?: KpiTrend;
  readonly trendLabel?: string;
  readonly icon?: ReactNode;
  readonly tone?: "default" | "success" | "warning" | "error" | "info";
  readonly helper?: string;
  readonly className?: string;
}

const toneStyles: Record<
  NonNullable<KpiCardProps["tone"]>,
  { iconWrap: string; value: string }
> = {
  default: {
    iconWrap: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    value: "text-gray-900 dark:text-gray-100",
  },
  success: {
    iconWrap:
      "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    value: "text-gray-900 dark:text-gray-100",
  },
  warning: {
    iconWrap:
      "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
    value: "text-gray-900 dark:text-gray-100",
  },
  error: {
    iconWrap: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    value: "text-gray-900 dark:text-gray-100",
  },
  info: {
    iconWrap: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    value: "text-gray-900 dark:text-gray-100",
  },
};

const trendIcon: Record<KpiTrend, string> = {
  up: "▲",
  down: "▼",
  flat: "■",
};

const trendColor: Record<KpiTrend, string> = {
  up: "text-green-600 dark:text-green-400",
  down: "text-red-600 dark:text-red-400",
  flat: "text-gray-500 dark:text-gray-400",
};

export function KpiCard({
  label,
  value,
  trend,
  trendLabel,
  icon,
  tone = "default",
  helper,
  className,
}: KpiCardProps): JSX.Element {
  const t = toneStyles[tone];
  return (
    <Card padding="md" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md",
              t.iconWrap
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className={cn("text-2xl font-semibold tracking-tight", t.value)}>
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium pb-1",
              trendColor[trend]
            )}
            aria-label={trendLabel ?? trend}
          >
            <span aria-hidden="true">{trendIcon[trend]}</span>{" "}
            {trendLabel ?? trend}
          </span>
        )}
      </div>
      {helper && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{helper}</p>
      )}
    </Card>
  );
}
