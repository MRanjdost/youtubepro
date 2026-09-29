import i18n from "./i18n";
import { format as formatGregorian } from "date-fns";
import { format as formatJalali } from "date-fns-jalali";

export function formatNumberAscii(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatNumber(
  value: number | string | undefined,
  options?: Intl.NumberFormatOptions
): string {
  if (value === undefined || value === null || value === "") {
    return "0";
  }
  const num = Number(value);
  if (isNaN(num)) {
    return "0";
  }
  const locale = i18n.language === "fa" ? "fa-IR" : "en-US";
  return new Intl.NumberFormat(locale, options).format(num);
}

export function formatPercent(value: number | string | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "0%";
  }
  const num = Number(value);
  if (isNaN(num)) {
    return "0%";
  }
  const locale = i18n.language === "fa" ? "fa-IR" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatViews(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "N/A";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
}

export function formatDuration(iso: string | undefined | null): string {
  if (!iso) return "";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;

  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDate(
  dateString: string | Date | undefined,
  formatStr?: string
): string {
  if (dateString === undefined || dateString === null || dateString === "") {
    return "";
  }
  const parsedDate = dateString instanceof Date ? dateString : new Date(dateString);
  if (isNaN(parsedDate.getTime())) {
    return "";
  }
  const formatString = formatStr || "yyyy/MM/dd";
  if (i18n.language === "fa") {
    return formatJalali(parsedDate, formatString);
  }
  return formatGregorian(parsedDate, formatString);
}