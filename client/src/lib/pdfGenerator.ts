/**
 * PDF generator: renders research, insights, and thumbnail report layouts to
 * PDF, using the Vazirmatn font for Persian text when needed.
 */
import { jsPDF } from "jspdf";
import type { ResearchReportData } from "@/lib/research-export";
import { safeExportStem } from "@/lib/research-export";
import { formatNumberAscii } from "@/lib/formatter";
import i18n from "@/lib/i18n";

const INK: [number, number, number] = [35, 35, 35];
const MUTED: [number, number, number] = [102, 102, 102];
const BORDER: [number, number, number] = [218, 218, 218];
const SURFACE: [number, number, number] = [247, 246, 244];
const PRIMARY: [number, number, number] = [185, 86, 63];
const PRIMARY_LIGHT: [number, number, number] = [243, 220, 213];
const BLUE: [number, number, number] = [102, 142, 181];
const TEAL: [number, number, number] = [92, 155, 145];
const GOLD: [number, number, number] = [204, 161, 85];
const PURPLE: [number, number, number] = [142, 118, 177];

function formatNumber(value: number): string {
  return formatNumberAscii(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function readableDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
    : value;
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return i18n.t("research:export.na");
  if (typeof value === "boolean") return value ? i18n.t("research:export.yes") : i18n.t("research:export.no");
  return String(value).replace(/\s+/g, " ").trim();
}

function pk(key: string, vars?: Record<string, string | number>): string {
  return i18n.t(`research:pdf.${key}`, vars);
}

interface TableColumn {
  label: string;
  width: number;
}

const VAZIRMATN_URL = "/fonts/Vazirmatn-Regular.ttf";
const VAZIRMATN_BOLD_URL = "/fonts/Vazirmatn-Bold.ttf";

async function fetchFontBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load font: ${url}`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

let vazirmatnVfs: { regular: string; bold: string } | null = null;

async function loadVazirmatnFonts(): Promise<void> {
  if (vazirmatnVfs) return;
  const [regular, bold] = await Promise.all([
    fetchFontBase64(VAZIRMATN_URL),
    fetchFontBase64(VAZIRMATN_BOLD_URL),
  ]);
  vazirmatnVfs = { regular, bold };
}

function fontFamily(_weight: "normal" | "bold", isFa: boolean): string {
  return isFa && vazirmatnVfs ? "Vazirmatn" : "helvetica";
}

function registerVazirmatn(pdf: jsPDF): boolean {
  if (!vazirmatnVfs) return false;
  pdf.addFileToVFS("Vazirmatn-Regular.ttf", vazirmatnVfs.regular);
  pdf.addFont("Vazirmatn-Regular.ttf", "Vazirmatn", "normal");
  pdf.addFileToVFS("Vazirmatn-Bold.ttf", vazirmatnVfs.bold);
  pdf.addFont("Vazirmatn-Bold.ttf", "Vazirmatn", "bold");
  return true;
}

export function buildResearchPDF(data: ResearchReportData): jsPDF {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  registerVazirmatn(pdf);
  const isFa = i18n.language === "fa" && vazirmatnVfs !== null;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const contentBottom = pageHeight - 16;
  let y = 0;

  const drawPageHeader = (continuation = true) => {
    pdf.setFillColor(...PRIMARY);
    pdf.rect(0, 0, pageWidth, 4, "F");
    if (continuation) {
      pdf.setFont(fontFamily("bold", isFa), "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(...MUTED);
      pdf.text(pk("brandHeader"), margin, 11);
      pdf.setDrawColor(...BORDER);
      pdf.line(margin, 14, pageWidth - margin, 14);
      y = 21;
    } else {
      y = 16;
    }
  };

  const newPage = () => {
    pdf.addPage();
    drawPageHeader(true);
  };

  const ensure = (height: number) => {
    if (y + height > contentBottom) newPage();
  };

  const addWrapped = (
    value: unknown,
    options: {
      x?: number;
      width?: number;
      size?: number;
      lineHeight?: number;
      color?: [number, number, number];
      bold?: boolean;
      gapAfter?: number;
    } = {},
  ) => {
    const x = options.x ?? margin;
    const width = options.width ?? contentWidth;
    const size = options.size ?? 9;
    const lineHeight = options.lineHeight ?? 4.3;
    pdf.setFont(fontFamily(options.bold ? "bold" : "normal", isFa), options.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...(options.color ?? INK));
    const lines = pdf.splitTextToSize(text(value), width) as string[];
    for (const line of lines) {
      ensure(lineHeight + 1);
      if (isFa) pdf.text(line, x + width, y, { align: "right" });
      else pdf.text(line, x, y);
      y += lineHeight;
    }
    y += options.gapAfter ?? 1.5;
  };

  const addSection = (title: string, subtitle?: string) => {
    ensure(subtitle ? 24 : 16);
    y += 3;
    pdf.setFillColor(...PRIMARY_LIGHT);
    pdf.roundedRect(margin, y, 3, 9, 1.5, 1.5, "F");
    pdf.setFont(fontFamily("bold", isFa), "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(...INK);
    pdf.text(title, margin + 7, y + 6.5);
    y += 13;
    if (subtitle) addWrapped(subtitle, { size: 8.2, color: MUTED, gapAfter: 3 });
  };

  const addLabelValue = (label: string, value: unknown) => {
    ensure(12);
    pdf.setFont(fontFamily("bold", isFa), "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    pdf.text(label.toUpperCase(), margin, y);
    y += 4.5;
    addWrapped(value, { size: 9, gapAfter: 2.5 });
  };

  const addMetricCards = (metrics: { label: string; value: string; note: string }[]) => {
    const columns = 3;
    const gap = 3;
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    const cardHeight = 24;
    metrics.forEach((metric, index) => {
      if (index % columns === 0) ensure(cardHeight + 3);
      const column = index % columns;
      const x = margin + column * (cardWidth + gap);
      pdf.setFillColor(...SURFACE);
      pdf.setDrawColor(...BORDER);
      pdf.roundedRect(x, y, cardWidth, cardHeight, 2, 2, "FD");
      pdf.setFont(fontFamily("normal", isFa), "normal");
      pdf.setFontSize(7.2);
      pdf.setTextColor(...MUTED);
      pdf.text(metric.label, x + 3, y + 5);
      pdf.setFont(fontFamily("bold", isFa), "bold");
      pdf.setFontSize(14);
      pdf.setTextColor(...INK);
      pdf.text(metric.value, x + 3, y + 13);
      pdf.setFont(fontFamily("normal", isFa), "normal");
      pdf.setFontSize(6.5);
      pdf.setTextColor(...MUTED);
      const noteLines = pdf.splitTextToSize(metric.note, cardWidth - 6).slice(0, 2) as string[];
      noteLines.forEach((line, lineIndex) => pdf.text(line, x + 3, y + 18 + lineIndex * 3));
      if (column === columns - 1 || index === metrics.length - 1) y += cardHeight + 3;
    });
    y += 2;
  };

  const addBarChart = (
    title: string,
    rows: { label: string; value: number }[],
    note: string,
    colors: [number, number, number][] = [PRIMARY],
  ) => {
    if (rows.length === 0) return;
    const visibleRows = rows.slice(0, 8);
    const blockHeight = 17 + visibleRows.length * 9;
    ensure(blockHeight);
    pdf.setFillColor(...SURFACE);
    pdf.setDrawColor(...BORDER);
    pdf.roundedRect(margin, y, contentWidth, blockHeight, 2, 2, "FD");
    pdf.setFont(fontFamily("bold", isFa), "bold");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK);
    pdf.text(title, margin + 4, y + 6);
    pdf.setFont(fontFamily("normal", isFa), "normal");
    pdf.setFontSize(6.8);
    pdf.setTextColor(...MUTED);
    pdf.text(note, margin + 4, y + 11);
    const max = Math.max(...visibleRows.map((row) => row.value), 1);
    const labelWidth = 62;
    const barX = margin + labelWidth + 5;
    const barMaxWidth = contentWidth - labelWidth - 26;
    visibleRows.forEach((row, index) => {
      const rowY = y + 18 + index * 9;
      const label = row.label.length > 38 ? `${row.label.slice(0, 37)}...` : row.label;
      pdf.setFont(fontFamily("normal", isFa), "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(...INK);
      pdf.text(label, margin + 4, rowY);
      pdf.setFillColor(230, 229, 227);
      pdf.roundedRect(barX, rowY - 3.4, barMaxWidth, 4, 1, 1, "F");
      const barWidth = Math.max(row.value > 0 ? 1 : 0, (row.value / max) * barMaxWidth);
      pdf.setFillColor(...colors[index % colors.length]);
      pdf.roundedRect(barX, rowY - 3.4, barWidth, 4, 1, 1, "F");
      pdf.setFont(fontFamily("bold", isFa), "bold");
      pdf.setTextColor(...INK);
      pdf.text(formatCompact(row.value), pageWidth - margin - 4, rowY, { align: "right" });
    });
    y += blockHeight + 5;
  };

  const addTable = (columns: TableColumn[], rows: unknown[][]) => {
    const rowPadding = 2;
    const lineHeight = 3.5;
    const drawHeader = () => {
      ensure(9);
      pdf.setFillColor(...PRIMARY);
      pdf.rect(margin, y, contentWidth, 8, "F");
      let x = margin;
      columns.forEach((column) => {
        pdf.setFont(fontFamily("bold", isFa), "bold");
        pdf.setFontSize(7);
        pdf.setTextColor(255, 255, 255);
        pdf.text(column.label, x + rowPadding, y + 5.2);
        x += column.width;
      });
      y += 8;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const lineSets = columns.map((column, columnIndex) =>
        pdf.splitTextToSize(text(row[columnIndex]), column.width - rowPadding * 2) as string[],
      );
      const height = Math.max(8, Math.max(...lineSets.map((lines) => lines.length)) * lineHeight + rowPadding * 2);
      if (y + height > contentBottom) {
        newPage();
        drawHeader();
      }
      if (rowIndex % 2 === 0) {
        pdf.setFillColor(...SURFACE);
        pdf.rect(margin, y, contentWidth, height, "F");
      }
      pdf.setDrawColor(...BORDER);
      pdf.line(margin, y + height, pageWidth - margin, y + height);
      let x = margin;
      lineSets.forEach((lines, columnIndex) => {
        pdf.setFont(fontFamily("normal", isFa), "normal");
        pdf.setFontSize(6.7);
        pdf.setTextColor(...INK);
        lines.forEach((line, lineIndex) => pdf.text(line, x + rowPadding, y + rowPadding + 2.6 + lineIndex * lineHeight));
        x += columns[columnIndex].width;
      });
      y += height;
    });
    y += 5;
  };

  drawPageHeader(false);
  pdf.setFont(fontFamily("bold", isFa), "bold");
  pdf.setFontSize(22);
  pdf.setTextColor(...INK);
  pdf.text(i18n.t("research:export.summary.reportName"), margin, y + 7);
  y += 14;
  addWrapped(pk("snapshot", { query: data.query }), { size: 11, color: MUTED, gapAfter: 2 });
  addWrapped(pk("metaLine", { date: readableDate(data.retrievedAt), count: data.videos.length, channels: data.analytics.uniqueChannels }), {
    size: 8,
    color: MUTED,
    gapAfter: 5,
  });

  addSection(i18n.t("research:export.ai.executiveSummary"));
  addWrapped(data.insights.summary, { size: 10, lineHeight: 5, gapAfter: 4 });
  addWrapped(`${i18n.t("research:export.ai.viewerNeed")}: ${data.insights.queryIntent.viewerNeed}`, { size: 9, bold: true });
  addWrapped(`${i18n.t("research:export.ai.credibilityNote")}: ${data.insights.queryIntent.credibilityNote}`, { size: 8.5, color: MUTED, gapAfter: 4 });

  addMetricCards([
    { label: i18n.t("research:analytics.sampleViews"), value: formatCompact(data.analytics.totalViews), note: i18n.t("research:analytics.sumAcross") },
    { label: i18n.t("research:analytics.medianViews"), value: formatCompact(data.analytics.medianViews), note: i18n.t("research:analytics.lessDistorted") },
    { label: i18n.t("research:analytics.medianViewsDay"), value: formatCompact(data.analytics.medianDailyViews), note: pk("metric.velocityNote") },
    { label: i18n.t("research:analytics.interactionRate"), value: data.analytics.avgEngagement === "N/A" ? i18n.t("research:export.na") : `${data.analytics.avgEngagement}%`, note: pk("metric.interactionNote") },
    { label: i18n.t("research:analytics.averageViews"), value: formatCompact(data.analytics.avgViews), note: pk("metric.medianNote") },
    { label: i18n.t("research:analytics.videosAnalyzed"), value: formatNumber(data.analytics.totalVideos), note: i18n.t("research:analytics.maxPerCall") },
  ]);

  addSection(pk("section.findings"), pk("section.findingsSub"));
  addBarChart(
    pk("chart.topVideos"),
    data.analytics.topVideosList.map((video) => ({ label: video.title, value: video.viewCount || 0 })),
    pk("chart.topVideosNote"),
  );
  addBarChart(
    pk("chart.momentum"),
    data.analytics.velocityLeaders.map(({ video, viewsPerDay }) => ({ label: video.title, value: Math.round(viewsPerDay) })),
    pk("chart.momentumNote"),
    [BLUE],
  );
  addBarChart(
    pk("chart.breakout"),
    data.analytics.breakoutLeaders.map(({ video, viewsPerSubscriber }) => ({ label: video.title, value: Number(viewsPerSubscriber.toFixed(2)) })),
    pk("chart.breakoutNote"),
    [PURPLE],
  );
  addBarChart(
    pk("chart.tags"),
    data.analytics.topTags.map((item) => ({ label: item.label, value: item.count })),
    pk("chart.tagsNote"),
    [GOLD],
  );
  addBarChart(pk("chart.duration"), data.analytics.durationData.map((item) => ({ label: item.name, value: item.value })), pk("chart.durationNote"), [PRIMARY, BLUE, GOLD]);
  addBarChart(pk("chart.recency"), data.analytics.recencyData.map((item) => ({ label: item.name, value: item.value })), pk("chart.recencyNote"), [BLUE, TEAL, PURPLE, GOLD]);
  addBarChart(
    pk("chart.coverage"),
    [
      { label: i18n.t("research:analytics.observedPublicData"), value: data.analytics.coverage.views },
      { label: i18n.t("research:analytics.completeEngagement"), value: data.analytics.coverage.engagement },
      { label: i18n.t("research:analytics.publicSubscribers"), value: data.analytics.coverage.subscribers },
      { label: i18n.t("research:analytics.captionsAvailable"), value: data.analytics.coverage.captions },
      { label: i18n.t("research:analytics.publicTags"), value: data.analytics.coverage.tags },
      { label: i18n.t("research:analytics.hdDefinition"), value: data.analytics.coverage.hd },
    ],
    pk("chart.coverageNote", { count: data.analytics.totalVideos }),
    [TEAL],
  );

  addSection(pk("section.audience"));
  addLabelValue(i18n.t("research:export.ai.primaryIntent"), data.insights.queryIntent.primaryIntent);
  addLabelValue(pk("label.discoverySurface"), data.insights.queryIntent.discoverySurface);
  addLabelValue(pk("label.audienceHypothesis"), `${data.insights.targetAudience.primaryDemographic}. ${pk("label.ageRangeHypothesis")}: ${data.insights.targetAudience.ageRange}.`);
  addLabelValue(i18n.t("research:export.ai.interests"), data.insights.targetAudience.interests.join("; "));
  addLabelValue(i18n.t("research:export.ai.painPoints"), data.insights.targetAudience.painPoints.join("; "));
  addLabelValue(i18n.t("research:export.ai.contentPreferences"), data.insights.targetAudience.contentPreferences.join("; "));
  addLabelValue(pk("label.competition"), data.insights.nicheAnalysis.competitionLevel);
  addLabelValue(pk("label.growth"), data.insights.nicheAnalysis.growthTrend);
  addLabelValue(i18n.t("research:export.ai.formats"), data.insights.nicheAnalysis.recommendedFormats.join("; "));
  addLabelValue(i18n.t("research:export.ai.monetization"), data.insights.nicheAnalysis.monetizationPotential);

  addSection(pk("section.content"));
  addLabelValue(pk("label.contentGaps"), data.insights.contentGaps.map((value, index) => `${index + 1}. ${value}`).join("; "));
  addLabelValue(i18n.t("research:export.ai.subtopics"), data.insights.trendingSubtopics.join("; "));
  addLabelValue(pk("label.postingTimes"), data.insights.nicheAnalysis.bestPostingTimes.join("; "));

  addSection(pk("section.signals"));
  ([
    [pk("signal.observed"), data.insights.evidenceSignals.observed],
    [pk("signal.inferred"), data.insights.evidenceSignals.inferred],
    [pk("signal.requiresStudio"), data.insights.evidenceSignals.requiresStudio],
  ] as const).forEach(([label, values]) => {
    addWrapped(label, { size: 9, bold: true, color: PRIMARY, gapAfter: 1 });
    values.forEach((value, index) => addWrapped(`${index + 1}. ${value}`, { size: 8.5, x: margin + 3, width: contentWidth - 3, gapAfter: 1.5 }));
    y += 2;
  });

  addSection(pk("section.nextSteps"));
  data.insights.recommendedActions.forEach((action, index) => {
    addWrapped(`${index + 1}. ${action.title}`, { size: 9.5, bold: true, gapAfter: 1 });
    addWrapped(`${action.rationale} ${pk("inline.format")}: ${action.format}.`, { size: 8.5, color: MUTED, x: margin + 3, width: contentWidth - 3, gapAfter: 3 });
  });

  addSection(pk("section.questions"));
  data.insights.peopleAlsoAsk.forEach((item, index) => {
    addWrapped(`${index + 1}. ${item.question}`, { size: 9, bold: true, gapAfter: 1 });
    addWrapped(item.answer, { size: 8.3, color: MUTED, x: margin + 3, width: contentWidth - 3, gapAfter: 3 });
  });

  addSection(pk("section.ideas"), pk("section.ideasSub"));
  data.ideas.forEach((idea, index) => {
    pdf.setFont(fontFamily("bold", isFa), "bold");
    pdf.setFontSize(9.5);
    const titleLines = pdf.splitTextToSize(`${index + 1}. ${text(idea.title)}`, contentWidth - 6) as string[];
    const titleHeight = Math.max(8, titleLines.length * 4.2 + 4);
    ensure(titleHeight + 27);
    pdf.setFillColor(...SURFACE);
    pdf.setDrawColor(...BORDER);
    pdf.roundedRect(margin, y, contentWidth, titleHeight, 1.5, 1.5, "FD");
    pdf.setTextColor(...INK);
    titleLines.forEach((line, lineIndex) => pdf.text(line, margin + 3, y + 5.2 + lineIndex * 4.2));
    y += titleHeight + 4;
    addLabelValue(pk("label.package"), `${idea.format}  |  ${idea.difficulty}  |  ${idea.discoverySurface}`);
    addLabelValue(pk("label.description"), idea.description);
    addLabelValue(pk("label.keywords"), idea.keywords.join(", "));
    addLabelValue(i18n.t("research:export.ideas.honestPromise"), idea.honestPromise);
    addLabelValue(pk("label.payoff"), idea.payoff);
    addLabelValue(pk("label.thumbnailConcept"), idea.thumbnailConcept);
    addLabelValue(pk("label.studioValidation"), `${idea.studioMetric} ${pk("label.experimentRule")}: ${idea.experimentRule}`);
    addLabelValue(i18n.t("research:export.ideas.evidenceClaimIds"), idea.evidenceClaims.map((claim) => claim.id).join(", "));
    y += 3;
  });

  addSection(pk("section.ledger"), pk("section.ledgerSub"));
  data.insights.evidenceClaims.forEach((claim, index) => {
    ensure(24);
    addWrapped(`${index + 1}. ${claim.id}  |  ${i18n.t(`research:insights.evidenceClass.${claim.evidenceClass}`)}  |  ${i18n.t("research:insights.confidence", { level: claim.confidence })}`, {
      size: 9,
      bold: true,
      color: PRIMARY,
      gapAfter: 1,
    });
    addWrapped(claim.claim, { size: 8.5, x: margin + 3, width: contentWidth - 3, gapAfter: 1 });
    addWrapped(`${pk("inline.sources")}: ${claim.sourceVideoIds.join(", ") || i18n.t("research:export.na")}`, { size: 7.5, color: MUTED, x: margin + 3, width: contentWidth - 3, gapAfter: 1 });
    addWrapped(`${pk("inline.limitations")}: ${claim.limitations.join("; ")}`, { size: 7.5, color: MUTED, x: margin + 3, width: contentWidth - 3, gapAfter: 3 });
  });

  addSection(pk("section.videoResults"), pk("section.videoResultsSub"));
  addTable(
    [
      { label: "#", width: 8 },
      { label: pk("table.videoAndChannel"), width: 85 },
      { label: pk("table.published"), width: 28 },
      { label: pk("table.views"), width: 22 },
      { label: pk("table.likesComments"), width: 27 },
      { label: pk("table.duration"), width: 12 },
    ],
    data.videos.map((video, index) => [
      index + 1,
      `${video.title}\n${video.channelTitle}\nhttps://www.youtube.com/watch?v=${video.id}`,
      readableDate(video.publishedAt).replace(/, \d{1,2}:.*$/, ""),
      video.viewCount === undefined ? i18n.t("research:export.na") : formatNumber(video.viewCount),
      `${video.likeCount === undefined ? i18n.t("research:export.na") : formatNumber(video.likeCount)} / ${video.commentCount === undefined ? i18n.t("research:export.na") : formatNumber(video.commentCount)}`,
      video.duration || i18n.t("research:export.na"),
    ]),
  );

  addSection(pk("section.detailedMetadata"), pk("section.detailedMetadataSub"));
  data.videos.forEach((video, index) => {
    pdf.setFont(fontFamily("bold", isFa), "bold");
    pdf.setFontSize(9.5);
    const headerLines = pdf.splitTextToSize(`${index + 1}. ${video.title}`, contentWidth - 6) as string[];
    const headerHeight = Math.max(8, headerLines.length * 4.2 + 4);
    ensure(headerHeight + 18);
    pdf.setFillColor(...SURFACE);
    pdf.setDrawColor(...BORDER);
    pdf.roundedRect(margin, y, contentWidth, headerHeight, 1.5, 1.5, "FD");
    pdf.setTextColor(...INK);
    headerLines.forEach((line, lineIndex) => pdf.text(line, margin + 3, y + 5.2 + lineIndex * 4.2));
    y += headerHeight + 4;
    addLabelValue(pk("label.videoIdentity"), `${pk("field.videoId")}: ${video.id}; ${pk("field.url")}: https://www.youtube.com/watch?v=${video.id}`);
    addLabelValue(pk("label.channel"), `${video.channelTitle}; ${pk("field.channelId")}: ${video.channelId}`);
    addLabelValue(pk("label.publishedAndDuration"), `${readableDate(video.publishedAt)}; ${pk("field.duration")}: ${video.duration || i18n.t("research:export.na")}`);
    addLabelValue(pk("label.publicPerformance"), `${pk("field.views")}: ${text(video.viewCount)}; ${pk("field.likes")}: ${text(video.likeCount)}; ${pk("field.comments")}: ${text(video.commentCount)}`);
    addLabelValue(pk("label.contentMetadata"), `${pk("field.category")}: ${text(video.categoryId)}; ${pk("field.liveStatus")}: ${text(video.liveBroadcastContent)}; ${pk("field.definition")}: ${text(video.definition)}; ${pk("field.captions")}: ${text(video.hasCaptions)}; ${pk("field.defaultLanguage")}: ${text(video.defaultLanguage)}; ${pk("field.audioLanguage")}: ${text(video.defaultAudioLanguage)}`);
    addLabelValue(pk("label.publicStatusFields"), `${pk("field.licensed")}: ${text(video.licensedContent)}; ${pk("field.embeddable")}: ${text(video.embeddable)}; ${pk("field.madeForKids")}: ${text(video.madeForKids)}; ${pk("field.paidPlacement")}: ${text(video.hasPaidProductPlacement)}`);
    addLabelValue(pk("label.tags"), video.tags?.join(", ") || i18n.t("research:export.na"));
    addLabelValue(pk("label.topicCategories"), video.topicCategories?.join("; ") || i18n.t("research:export.na"));
    addLabelValue(pk("label.liveDetails"), video.liveStreamingDetails
      ? Object.entries(video.liveStreamingDetails).map(([key, value]) => `${key}: ${text(value)}`).join("; ")
      : i18n.t("research:export.na"));
    addLabelValue(pk("label.videoDescription"), video.description || i18n.t("research:export.na"));
    addLabelValue(pk("label.thumbnail"), video.thumbnailUrl);
    const channel = video.channelStatistics;
    addLabelValue(pk("label.channelStatistics"), channel
      ? `${pk("field.subscribers")}: ${text(channel.subscriberCount)}; ${pk("field.hiddenSubscribers")}: ${text(channel.hiddenSubscriberCount)}; ${pk("field.videos")}: ${text(channel.videoCount)}; ${pk("field.views")}: ${text(channel.viewCount)}; ${pk("field.published")}: ${text(channel.publishedAt)}; ${pk("field.country")}: ${text(channel.country)}; ${pk("field.customUrl")}: ${text(channel.customUrl)}; ${pk("field.defaultLanguage")}: ${text(channel.defaultLanguage)}`
      : i18n.t("research:export.na"));
    addLabelValue(pk("label.channelKeywords"), channel?.keywords || i18n.t("research:export.na"));
    addLabelValue(pk("label.channelTopicCategories"), channel?.topicCategories?.join("; ") || i18n.t("research:export.na"));
    addLabelValue(pk("label.channelDescription"), channel?.description || i18n.t("research:export.na"));
    addLabelValue(pk("label.channelThumbnail"), channel?.thumbnailUrl || i18n.t("research:export.na"));
    y += 5;
  });

  addSection(pk("section.caveats"));
  addLabelValue(pk("label.method"), data.insights.methodology.basis);
  addLabelValue(pk("label.sample"), `${pk("inline.sampleLine", { count: data.insights.methodology.sampleSize, total: formatNumber(data.totalResults) })}${data.totalResultsIsApproximate ? pk("inline.approxSuffix") : ""}.`);
  data.insights.methodology.limitations.forEach((limitation, index) => addWrapped(`${index + 1}. ${limitation}`, { size: 8.5, gapAfter: 2 }));
  addLabelValue(i18n.t("research:export.sources.provider"), data.provenance.provider);
  addLabelValue(pk("label.filters"), `${pk("inline.uploadDate")}: ${data.filters.uploadDate}; ${pk("inline.duration")}: ${data.filters.duration}; ${pk("inline.sort")}: ${data.filters.sortBy}.`);
  addLabelValue(i18n.t("research:export.summary.snapshotId"), data.snapshotId);
  addLabelValue(pk("label.searchResponse"), `${pk("inline.resultsPerPage")}: ${text(data.resultsPerPage)}; ${pk("inline.regionCode")}: ${text(data.regionCode)}; ${pk("inline.nextPageToken")}: ${text(data.nextPageToken)}`);
  addLabelValue(pk("label.enrichment"), Object.entries(data.enrichment).map(([stage, detail]) => `${stage}: ${detail.status} (${detail.returned}/${detail.requested})`).join("; "));
  if (data.warnings.length > 0) {
    data.warnings.forEach((warning, index) => addWrapped(`${index + 1}. ${warning.stage}: ${warning.message}`, { size: 8.5, color: MUTED, gapAfter: 2 }));
  } else {
    addWrapped(pk("inline.noWarnings"), { size: 8.5, color: MUTED });
  }

  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(...BORDER);
    pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    pdf.setFont(fontFamily("normal", isFa), "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...MUTED);
    pdf.text(pk("footer"), margin, pageHeight - 7);
    pdf.text(pk("page", { current: page, total: totalPages }), pageWidth - margin, pageHeight - 7, { align: "right" });
  }

  return pdf;
}

export async function generateResearchPDF(data: ResearchReportData): Promise<void> {
  try {
    await loadVazirmatnFonts();
  } catch {
    // Fonts are optional: the PDF falls back to helvetica if unavailable.
  }
  buildResearchPDF(data).save(`youtube-research-${safeExportStem(data.query)}.pdf`);
}
