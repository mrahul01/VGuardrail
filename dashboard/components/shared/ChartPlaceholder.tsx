"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader } from "@/components/ui/Card";

export type ChartKind = "line" | "bar" | "pie";

export interface ChartPoint {
  readonly label: string;
  readonly value: number;
  readonly category?: string;
}

export interface ChartPlaceholderProps {
  readonly title: string;
  readonly description?: string;
  readonly data: readonly ChartPoint[];
  readonly kind?: ChartKind;
  readonly height?: number;
  readonly yLabel?: string;
  readonly loading?: boolean;
  readonly className?: string;
}

const PIE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

export function ChartPlaceholder({
  title,
  description,
  data,
  kind = "line",
  height = 240,
  yLabel,
  loading = false,
  className,
}: ChartPlaceholderProps): JSX.Element {
  return (
    <Card padding="md" className={className}>
      <CardHeader title={title} description={description} />
      <div
        className="w-full"
        style={{ height }}
        aria-busy={loading}
        aria-live="polite"
        role="img"
        aria-label={`${title} chart`}
      >
        {loading ? (
          <div className="h-full w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No data available
          </div>
        ) : kind === "line" ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={[...data]}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148, 163, 184, 0.2)"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "#64748b" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
                label={
                  yLabel
                    ? {
                        value: yLabel,
                        angle: -90,
                        position: "insideLeft",
                        style: { fontSize: 12, fill: "#64748b" },
                      }
                    : undefined
                }
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : kind === "bar" ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...data]}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148, 163, 184, 0.2)"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "#64748b" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                contentStyle={{
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                iconType="circle"
              />
              <Pie
                data={[...data]}
                dataKey="value"
                nameKey="label"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
              >
                {data.map((entry, idx) => (
                  <Cell
                    key={entry.label}
                    fill={PIE_COLORS[idx % PIE_COLORS.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
