import "./i18n.test-setup";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  formatNumber,
  formatPercent,
  formatDate,
  formatNumberAscii,
  formatViews,
  formatDuration,
} from "./formatter";

import i18n from "./i18n";

describe("formatter infrastructure", () => {
  before(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  describe("formatNumber", () => {
    test("returns 0 for undefined", () => {
      assert.equal(formatNumber(undefined), "0");
    });

    test("returns 0 for null", () => {
      assert.equal(formatNumber(null as any), "0");
    });

    test("returns 0 for empty string", () => {
      assert.equal(formatNumber(""), "0");
    });

    test("returns 0 for NaN", () => {
      assert.equal(formatNumber(NaN as any), "0");
    });

    test("formats number with grouping separator for en", async () => {
      await i18n.changeLanguage("en");
      const result = formatNumber(1234567.89);
      assert.ok(result.includes("1"), "should contain 1");
      assert.ok(result.includes(","), "should contain grouping separator");
    });

    test("formats number with grouping separator for fa", async () => {
      await i18n.changeLanguage("fa");
      const result = formatNumber(1234567.89);
      assert.ok(result.includes("۱") || result.includes(","), "should contain Persian ۱ or grouping separator");
    });

    test("accepts string input", async () => {
      await i18n.changeLanguage("en");
      const result = formatNumber("9876543");
      assert.ok(result.includes("9"), "should contain 9");
    });

    test("accepts Intl options", async () => {
      await i18n.changeLanguage("en");
      const result = formatNumber(1234.5, { minimumFractionDigits: 2 });
      assert.ok(result.includes("."), "should contain decimal separator");
    });
  });

  describe("formatPercent", () => {
    test("returns 0% for undefined", () => {
      assert.equal(formatPercent(undefined), "0%");
    });

    test("formats fraction as percentage for en", async () => {
      await i18n.changeLanguage("en");
      const result = formatPercent(0.057);
      assert.ok(result.includes("5") || result.includes("5."), "should contain 5");
      assert.ok(result.includes("%"), "should contain percent sign");
    });

    test("formats fraction as percentage for fa", async () => {
      await i18n.changeLanguage("fa");
      const result = formatPercent(0.057);
      assert.ok(result.includes("%") || result.includes("٪"), "should contain percent sign");
    });
  });

  describe("formatDate", () => {
    test("returns empty string for undefined", () => {
      assert.equal(formatDate(undefined), "");
    });

    test("returns empty string for null", () => {
      assert.equal(formatDate(null as any), "");
    });

    test("returns empty string for empty string", () => {
      assert.equal(formatDate(""), "");
    });

    test("returns empty string for invalid date string", () => {
      assert.equal(formatDate("not-a-date"), "");
    });

    test("formats Gregorian date for en locale", async () => {
      await i18n.changeLanguage("en");
      const result = formatDate("2024-06-15");
      assert.ok(result.length > 0, "should return a non-empty string");
      assert.ok(result.includes("/") || result.includes("-"), "should contain date separators");
    });

    test("formats Jalali date for fa locale", async () => {
      await i18n.changeLanguage("fa");
      const result = formatDate("2024-06-15");
      assert.ok(result.length > 0, "should return a non-empty string");
      // June 15 2024 = 1403/03/26 in Jalali
      assert.ok(result.includes("۱") || result.includes("1403") || result.includes("/03/"), "should contain Jalali date components");
    });

    test("accepts Date object input", async () => {
      await i18n.changeLanguage("en");
      const result = formatDate(new Date("2024-01-01"));
      assert.ok(result.length > 0, "should return a non-empty string");
    });

    test("accepts custom format string", async () => {
      await i18n.changeLanguage("en");
      const result = formatDate("2024-01-01", "yyyy-MM-dd");
      assert.ok(result.includes("2024"), "should contain year");
    });
  });

  describe("formatNumberAscii", () => {
    test("returns 0 for undefined", () => {
      assert.equal(formatNumberAscii(undefined), "0");
    });

    test("returns 0 for null", () => {
      assert.equal(formatNumberAscii(null), "0");
    });

    test("returns 0 for NaN", () => {
      assert.equal(formatNumberAscii(NaN), "0");
    });

    test("uses en-US grouping regardless of locale", async () => {
      await i18n.changeLanguage("fa");
      const result = formatNumberAscii(1234567);
      assert.equal(result, "1,234,567");
    });

    test("formats whole numbers without decimals", () => {
      assert.equal(formatNumberAscii(2500), "2,500");
    });
  });

  describe("formatViews", () => {
    test("returns N/A for undefined", () => {
      assert.equal(formatViews(undefined), "N/A");
    });

    test("returns N/A for null", () => {
      assert.equal(formatViews(null), "N/A");
    });

    test("returns N/A for NaN", () => {
      assert.equal(formatViews(NaN), "N/A");
    });

    test("formats millions with M suffix", () => {
      assert.equal(formatViews(1500000), "1.5M");
    });

    test("formats thousands with K suffix", () => {
      assert.equal(formatViews(2500), "2.5K");
    });

    test("returns raw value below 1000", () => {
      assert.equal(formatViews(999), "999");
    });

    test("returns raw value for zero", () => {
      assert.equal(formatViews(0), "0");
    });
  });

  describe("formatDuration", () => {
    test("returns empty string for undefined", () => {
      assert.equal(formatDuration(undefined), "");
    });

    test("returns empty string for null", () => {
      assert.equal(formatDuration(null), "");
    });

    test("returns empty string for empty input", () => {
      assert.equal(formatDuration(""), "");
    });

    test("returns the raw input when it is not a valid iso duration", () => {
      assert.equal(formatDuration("60 seconds"), "60 seconds");
    });

    test("formats hours, minutes and seconds", () => {
      assert.equal(formatDuration("PT1H2M3S"), "1:02:03");
    });

    test("formats minutes and seconds without an hour part", () => {
      assert.equal(formatDuration("PT9M45S"), "9:45");
    });

    test("formats seconds shorter than a minute with a leading zero", () => {
      assert.equal(formatDuration("PT5S"), "0:05");
    });
  });
});
