import { UploadDateFilter, DurationFilter, SortBy } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";

interface SearchFiltersProps {
  uploadDate: UploadDateFilter;
  duration: DurationFilter;
  sortBy: SortBy;
  onUploadDateChange: (value: UploadDateFilter) => void;
  onDurationChange: (value: DurationFilter) => void;
  onSortByChange: (value: SortBy) => void;
}

type FilterOption = { value: string; labelKey: string };

export const uploadDateOptions: FilterOption[] = [
  { value: UploadDateFilter.ANY, labelKey: "filters.anyTime" },
  { value: UploadDateFilter.HOUR, labelKey: "filters.lastHour" },
  { value: UploadDateFilter.TODAY, labelKey: "filters.today" },
  { value: UploadDateFilter.WEEK, labelKey: "filters.thisWeek" },
  { value: UploadDateFilter.MONTH, labelKey: "filters.thisMonth" },
  { value: UploadDateFilter.YEAR, labelKey: "filters.thisYear" },
];

export const durationOptions: FilterOption[] = [
  { value: DurationFilter.ANY, labelKey: "filters.anyDuration" },
  { value: DurationFilter.SHORT, labelKey: "filters.short" },
  { value: DurationFilter.MEDIUM, labelKey: "filters.medium" },
  { value: DurationFilter.LONG, labelKey: "filters.long" },
];

export const sortByOptions: FilterOption[] = [
  { value: SortBy.RELEVANCE, labelKey: "filters.relevance" },
  { value: SortBy.DATE, labelKey: "filters.date" },
  { value: SortBy.VIEW_COUNT, labelKey: "filters.viewCount" },
  { value: SortBy.RATING, labelKey: "filters.rating" },
];

export function SearchFilters({
  uploadDate,
  duration,
  sortBy,
  onUploadDateChange,
  onDurationChange,
  onSortByChange,
}: SearchFiltersProps) {
  const { t } = useTranslation("research");
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="filter-upload-date" className="text-xs text-muted-foreground">{t("filters.uploadDate")}</Label>
        <Select value={uploadDate} onValueChange={onUploadDateChange}>
          <SelectTrigger id="filter-upload-date" className="w-[140px]" data-testid="select-upload-date">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {uploadDateOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-duration" className="text-xs text-muted-foreground">{t("filters.duration")}</Label>
        <Select value={duration} onValueChange={onDurationChange}>
          <SelectTrigger id="filter-duration" className="w-[150px]" data-testid="select-duration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {durationOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-sort-by" className="text-xs text-muted-foreground">{t("filters.sortBy")}</Label>
        <Select value={sortBy} onValueChange={onSortByChange}>
          <SelectTrigger id="filter-sort-by" className="w-[130px]" data-testid="select-sort-by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortByOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
