"use client";

import {
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
  forwardRef,
} from "react";
import { cn } from "@/lib/utils/cn";

export interface ColumnDef<T> {
  readonly key: string;
  readonly header: string;
  readonly accessor: (row: T) => React.ReactNode;
  readonly className?: string;
  readonly headerClassName?: string;
  readonly sortable?: boolean;
}

export interface TableProps<T> extends TableHTMLAttributes<HTMLTableElement> {
  readonly columns: readonly ColumnDef<T>[];
  readonly data: readonly T[];
  readonly keyExtractor: (row: T) => string;
  readonly striped?: boolean;
  readonly hoverable?: boolean;
  readonly emptyMessage?: string;
  readonly sortColumn?: string;
  readonly sortDirection?: "asc" | "desc";
  readonly onSort?: (column: string) => void;
  readonly loading?: boolean;
}

function TableHeader<T>({
  columns,
  sortColumn,
  sortDirection,
  onSort,
}: {
  readonly columns: readonly ColumnDef<T>[];
  readonly sortColumn?: string;
  readonly sortDirection?: "asc" | "desc";
  readonly onSort?: (column: string) => void;
}) {
  return (
    <thead className="bg-gray-50 dark:bg-gray-800">
      <tr>
        {columns.map((column) => (
          <th
            key={column.key}
            scope="col"
            className={cn(
              "px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider",
              "border-b border-gray-200 dark:border-gray-700",
              column.sortable && "cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700",
              column.headerClassName
            )}
            onClick={column.sortable && onSort ? () => onSort(column.key) : undefined}
            aria-sort={
              column.sortable && sortColumn === column.key
                ? sortDirection === "asc"
                  ? "ascending"
                  : "descending"
                : "none"
            }
          >
            <div className="flex items-center space-x-1">
              <span>{column.header}</span>
              {column.sortable && sortColumn === column.key && (
                <svg
                  className={cn(
                    "h-4 w-4 text-gray-400",
                    sortDirection === "asc" ? "rotate-180" : ""
                  )}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              )}
            </div>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function TableBody<T>({
  columns,
  data,
  keyExtractor,
  striped,
  hoverable,
}: {
  readonly columns: readonly ColumnDef<T>[];
  readonly data: readonly T[];
  readonly keyExtractor: (row: T) => string;
  readonly striped?: boolean;
  readonly hoverable?: boolean;
}) {
  if (data.length === 0) {
    return (
      <tbody>
        <tr>
          <td
            colSpan={columns.length}
            className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
          >
            No data available
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
      {data.map((row, rowIndex) => (
        <tr
          key={keyExtractor(row)}
          className={cn(
            striped && rowIndex % 2 === 0 && "bg-gray-50 dark:bg-gray-800/50",
            hoverable && "hover:bg-gray-50 dark:hover:bg-gray-800/50"
          )}
        >
          {columns.map((column) => (
            <td
              key={column.key}
              className={cn(
                "px-4 py-3 text-sm text-gray-900 dark:text-white",
                column.className
              )}
            >
              {column.accessor(row)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  striped = true,
  hoverable = true,
  emptyMessage = "No data available",
  sortColumn,
  sortDirection,
  onSort,
  loading,
  className,
  ...props
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props}>
        <TableHeader
          columns={columns}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={onSort}
        />
        {loading ? (
          <tbody>
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg
                    className="h-5 w-5 animate-spin text-vg-primary-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <span>Loading...</span>
                </div>
              </td>
            </tr>
          </tbody>
        ) : (
          <TableBody
            columns={columns}
            data={data}
            keyExtractor={keyExtractor}
            striped={striped}
            hoverable={hoverable}
          />
        )}
      </table>
      {data.length === 0 && !loading && (
        <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}