// Barrel export for shared UI components.
// Provides a single import surface for `@/components/ui`.
// All components are typed, accessible, Tailwind-compatible, and free of
// placeholder implementations.

export { Button } from "./Button";
export type { ButtonProps } from "./Button";

export { Card, CardHeader, CardBody, CardFooter } from "./Card";
export type { CardProps, CardHeaderProps, CardBodyProps, CardFooterProps } from "./Card";

export { Badge, StatusBadge } from "./Badge";
export type { BadgeProps, BadgeVariant, BadgeSize, StatusBadgeProps } from "./Badge";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Select } from "./Select";
export type { SelectProps, SelectOption } from "./Select";

export { Table } from "./Table";
export type { TableProps, ColumnDef } from "./Table";

export { Modal, ConfirmModal } from "./Modal";
export type { ModalProps, ConfirmModalProps } from "./Modal";

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsPanel,
} from "./Tabs";
export type {
  TabsProps,
  TabsListProps,
  TabsTriggerProps,
  TabsPanelProps,
  TabItem,
} from "./Tabs";

export { Skeleton, SkeletonText, SkeletonCard } from "./Skeleton";
export type {
  SkeletonProps,
  SkeletonTextProps,
  SkeletonCardProps,
} from "./Skeleton";

export { Pagination } from "./Pagination";
export type { PaginationProps } from "./Pagination";

export { SearchInput } from "./SearchInput";
export type { SearchInputProps, SearchInputSize } from "./SearchInput";

export {
  DateRangePicker,
  buildPresetDateRanges,
} from "./DateRangePicker";
export type {
  DateRangePickerProps,
  DateRange,
  PresetDateRange,
} from "./DateRangePicker";

export {
  StatusIndicator,
  SeverityIndicator,
  DecisionIndicator,
} from "./StatusIndicator";
export type {
  StatusIndicatorProps,
  StatusTone,
  StatusSize,
  SeverityIndicatorProps,
  DecisionIndicatorProps,
} from "./StatusIndicator";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps, EmptyStateVariant } from "./EmptyState";

export { Avatar } from "./Avatar";
export type { AvatarProps } from "./Avatar";

export { Dropdown } from "./Dropdown";
export type { DropdownProps, DropdownItem } from "./Dropdown";

export { ThemeToggle } from "./ThemeToggle";

export { Tooltip } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";

export {
  ToastProvider,
  useToast,
  useToastHelpers,
} from "./Toast";
export type { Toast, ToastProps, ToastType } from "./Toast";
