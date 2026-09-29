/**
 * Research export: builds typed report data and safe export filenames for the
 * PDF, CSV, and spreadsheet download paths.
 */
import type {
  IdeaPackage,
  ResearchInsightsResponse,
  SearchResponse,
  Video,
} from "@shared/schema";
import type { calculateYouTubeAnalytics } from "@/lib/youtube-analytics";
import i18n from "@/lib/i18n";

export type ResearchAnalytics = ReturnType<typeof calculateYouTubeAnalytics>;

export interface ResearchReportData {
  query: string;
  totalResults: number;
  totalResultsIsApproximate: boolean;
  resultsPerPage?: number;
  regionCode?: string;
  nextPageToken?: string;
  snapshotId: string;
  retrievedAt: string;
  filters: {
    uploadDate: string;
    duration: string;
    sortBy: string;
  };
  analytics: ResearchAnalytics;
  videos: Video[];
  insights: ResearchInsightsResponse;
  ideas: IdeaPackage[];
  provenance: SearchResponse["provenance"];
  enrichment: SearchResponse["enrichment"];
  warnings: SearchResponse["warnings"];
}

type Cell = string | number | boolean | null | undefined;

function rk(key: string, vars?: Record<string, string | number>): string {
  return i18n.t(`research:export.${key}`, vars);
}

interface ExportTable {
  name: string;
  columns: string[];
  rows: Cell[][];
}

function readable(value: Cell): string {
  if (value === null || value === undefined || value === "") return rk("na");
  if (typeof value === "boolean") return value ? rk("yes") : rk("no");
  return String(value);
}

function joined(values?: readonly string[]): string {
  return values && values.length > 0 ? values.join(" | ") : "N/A";
}

function videoInteractionRate(video: Video): string {
  if (!video.viewCount || video.likeCount === undefined || video.commentCount === undefined) return "N/A";
  return `${(((video.likeCount + video.commentCount) / video.viewCount) * 100).toFixed(2)}%`;
}

export function safeExportStem(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "research";
}

export function buildResearchExportTables(data: ResearchReportData): ExportTable[] {
  const { analytics, insights } = data;
  const summary: ExportTable = {
    name: rk("summary.name"),
    columns: [rk("summary.field"), rk("summary.value")],
    rows: [
      [rk("summary.report"), rk("summary.reportName")],
      [rk("summary.query"), data.query],
      [rk("summary.retrieved"), data.retrievedAt],
      [rk("summary.snapshotId"), data.snapshotId],
      [rk("summary.estimatedResults"), data.totalResults],
      [rk("summary.resultsApproximate"), data.totalResultsIsApproximate],
      [rk("summary.resultsPerPage"), data.resultsPerPage],
      [rk("summary.regionCode"), data.regionCode],
      [rk("summary.nextPageToken"), data.nextPageToken],
      [rk("summary.videosAnalyzed"), analytics.totalVideos],
      [rk("summary.uniqueChannels"), analytics.uniqueChannels],
      [rk("summary.sampleViews"), analytics.totalViews],
      [rk("summary.averageViews"), analytics.avgViews],
      [rk("summary.medianViews"), analytics.medianViews],
      [rk("summary.medianViewsPerDay"), analytics.medianDailyViews],
      [rk("summary.interactionRate"), analytics.avgEngagement === "N/A" ? "N/A" : `${analytics.avgEngagement}%`],
      [rk("summary.uploadFilter"), data.filters.uploadDate],
      [rk("summary.durationFilter"), data.filters.duration],
      [rk("summary.sortOrder"), data.filters.sortBy],
      [rk("summary.executiveSummary"), insights.summary],
    ],
  };

  const overview: ExportTable = {
    name: rk("overview.name"),
    columns: [rk("overview.section"), rk("overview.label"), rk("overview.value"), rk("overview.definition")],
    rows: [
      ...analytics.durationData.map((item) => [rk("overview.durationDistribution"), item.name, item.value, rk("overview.returnedVideos")]),
      ...analytics.recencyData.map((item) => [rk("overview.publicationRecency"), item.name, item.value, rk("overview.returnedVideos")]),
      ...analytics.topTags.map((item) => [rk("overview.recurringTags"), item.label, item.count, rk("overview.distinctTags")]),
      [rk("overview.dataCoverage"), rk("overview.views"), analytics.coverage.views, rk("overview.ofN", { count: analytics.totalVideos })],
      [rk("overview.dataCoverage"), rk("overview.completeEngagement"), analytics.coverage.engagement, rk("overview.ofN", { count: analytics.totalVideos })],
      [rk("overview.dataCoverage"), rk("overview.publicSubscribers"), analytics.coverage.subscribers, rk("overview.ofN", { count: analytics.totalVideos })],
      [rk("overview.dataCoverage"), rk("overview.captionsAvailable"), analytics.coverage.captions, rk("overview.ofN", { count: analytics.totalVideos })],
      [rk("overview.dataCoverage"), rk("overview.publicTags"), analytics.coverage.tags, rk("overview.ofN", { count: analytics.totalVideos })],
      [rk("overview.dataCoverage"), rk("overview.hdDefinition"), analytics.coverage.hd, rk("overview.ofN", { count: analytics.totalVideos })],
      ...analytics.velocityLeaders.map(({ video, viewsPerDay }, index) => [
        rk("overview.momentumLeaders"),
        `${index + 1}. ${video.title}`,
        Math.round(viewsPerDay),
        rk("overview.vpdNote"),
      ]),
      ...analytics.breakoutLeaders.map(({ video, viewsPerSubscriber }, index) => [
        rk("overview.breakout"),
        `${index + 1}. ${video.title}`,
        Number(viewsPerSubscriber.toFixed(2)),
        rk("overview.breakoutNote"),
      ]),
    ],
  };

  const videos: ExportTable = {
    name: rk("videos.name"),
    columns: [
      rk("videos.rank"), rk("videos.videoId"), rk("videos.title"), rk("videos.channel"), rk("videos.channelId"), rk("videos.published"), rk("videos.duration"),
      rk("videos.views"), rk("videos.likes"), rk("videos.comments"), rk("videos.interaction"), rk("videos.tags"), rk("videos.categoryId"),
      rk("videos.liveStatus"), rk("videos.captions"), rk("videos.definition"), rk("videos.licensed"), rk("videos.embeddable"),
      rk("videos.madeForKids"), rk("videos.paidPlacement"), rk("videos.defaultLanguage"), rk("videos.audioLanguage"),
      rk("videos.topicCategories"), rk("videos.liveActualStart"), rk("videos.liveActualEnd"), rk("videos.liveScheduledStart"),
      rk("videos.liveConcurrent"), rk("videos.channelSubscribers"), rk("videos.subscribersHidden"), rk("videos.channelVideos"),
      rk("videos.channelViews"), rk("videos.channelPublished"), rk("videos.channelCountry"), rk("videos.channelCustomUrl"),
      rk("videos.channelDefaultLanguage"), rk("videos.channelKeywords"), rk("videos.channelTopicCategories"),
      rk("videos.channelThumbnailUrl"), rk("videos.channelDescription"), rk("videos.thumbnailUrl"), rk("videos.youtubeUrl"), rk("videos.description"),
    ],
    rows: data.videos.map((video, index) => [
      index + 1,
      video.id,
      video.title,
      video.channelTitle,
      video.channelId,
      video.publishedAt,
      video.duration,
      video.viewCount,
      video.likeCount,
      video.commentCount,
      videoInteractionRate(video),
      joined(video.tags),
      video.categoryId,
      video.liveBroadcastContent,
      video.hasCaptions,
      video.definition,
      video.licensedContent,
      video.embeddable,
      video.madeForKids,
      video.hasPaidProductPlacement,
      video.defaultLanguage,
      video.defaultAudioLanguage,
      joined(video.topicCategories),
      video.liveStreamingDetails?.actualStartTime,
      video.liveStreamingDetails?.actualEndTime,
      video.liveStreamingDetails?.scheduledStartTime,
      video.liveStreamingDetails?.concurrentViewers,
      video.channelStatistics?.subscriberCount,
      video.channelStatistics?.hiddenSubscriberCount,
      video.channelStatistics?.videoCount,
      video.channelStatistics?.viewCount,
      video.channelStatistics?.publishedAt,
      video.channelStatistics?.country,
      video.channelStatistics?.customUrl,
      video.channelStatistics?.defaultLanguage,
      video.channelStatistics?.keywords,
      joined(video.channelStatistics?.topicCategories),
      video.channelStatistics?.thumbnailUrl,
      video.channelStatistics?.description,
      video.thumbnailUrl,
      `https://www.youtube.com/watch?v=${video.id}`,
      video.description,
    ]),
  };

  const aiInsights: ExportTable = {
    name: rk("ai.name"),
    columns: [rk("ai.section"), rk("ai.item"), rk("ai.detail")],
    rows: [
      [rk("ai.executiveSummary"), rk("ai.summary"), insights.summary],
      [rk("ai.queryIntent"), rk("ai.primaryIntent"), insights.queryIntent.primaryIntent],
      [rk("ai.queryIntent"), rk("ai.viewerNeed"), insights.queryIntent.viewerNeed],
      [rk("ai.queryIntent"), rk("ai.discoverySurface"), insights.queryIntent.discoverySurface],
      [rk("ai.queryIntent"), rk("ai.credibilityNote"), insights.queryIntent.credibilityNote],
      ...insights.evidenceSignals.observed.map((value, index) => [rk("ai.evidenceSignals"), rk("ai.observed", { index: index + 1 }), value]),
      ...insights.evidenceSignals.inferred.map((value, index) => [rk("ai.evidenceSignals"), rk("ai.inferred", { index: index + 1 }), value]),
      ...insights.evidenceSignals.requiresStudio.map((value, index) => [rk("ai.evidenceSignals"), rk("ai.requiresStudio", { index: index + 1 }), value]),
      ...insights.peopleAlsoAsk.flatMap((item, index) => [
        [rk("ai.viewerQuestions"), rk("ai.question", { index: index + 1 }), item.question],
        [rk("ai.viewerQuestions"), rk("ai.answer", { index: index + 1 }), item.answer],
      ]),
      [rk("ai.audience"), rk("ai.primaryDemographic"), insights.targetAudience.primaryDemographic],
      [rk("ai.audience"), rk("ai.ageRange"), insights.targetAudience.ageRange],
      [rk("ai.audience"), rk("ai.interests"), joined(insights.targetAudience.interests)],
      [rk("ai.audience"), rk("ai.painPoints"), joined(insights.targetAudience.painPoints)],
      [rk("ai.audience"), rk("ai.contentPreferences"), joined(insights.targetAudience.contentPreferences)],
      [rk("ai.niche"), rk("ai.competitionLevel"), insights.nicheAnalysis.competitionLevel],
      [rk("ai.niche"), rk("ai.growthTrend"), insights.nicheAnalysis.growthTrend],
      [rk("ai.niche"), rk("ai.postingTimes"), joined(insights.nicheAnalysis.bestPostingTimes)],
      [rk("ai.niche"), rk("ai.formats"), joined(insights.nicheAnalysis.recommendedFormats)],
      [rk("ai.niche"), rk("ai.monetization"), insights.nicheAnalysis.monetizationPotential],
      ...insights.contentGaps.map((value, index) => [rk("ai.contentGaps"), rk("ai.gap", { index: index + 1 }), value]),
      ...insights.trendingSubtopics.map((value, index) => [rk("ai.subtopics"), rk("ai.subtopic", { index: index + 1 }), value]),
      ...insights.recommendedActions.flatMap((item, index) => [
        [rk("ai.actions"), rk("ai.action", { index: index + 1 }), item.title],
        [rk("ai.actions"), rk("ai.rationale", { index: index + 1 }), item.rationale],
        [rk("ai.actions"), rk("ai.format", { index: index + 1 }), item.format],
      ]),
      [rk("ai.methodology"), rk("ai.sampleSize"), insights.methodology.sampleSize],
      [rk("ai.methodology"), rk("ai.basis"), insights.methodology.basis],
      ...insights.methodology.limitations.map((value, index) => [rk("ai.methodology"), rk("ai.limitation", { index: index + 1 }), value]),
    ],
  };

  const evidence: ExportTable = {
    name: rk("evidence.name"),
    columns: [rk("evidence.id"), rk("evidence.class"), rk("evidence.claim"), rk("evidence.confidence"), rk("evidence.sourceVideoIds"), rk("evidence.limitations"), rk("evidence.snapshotId")],
    rows: insights.evidenceClaims.map((claim) => [
      claim.id,
      claim.evidenceClass,
      claim.claim,
      claim.confidence,
      joined(claim.sourceVideoIds),
      joined(claim.limitations),
      claim.snapshotId,
    ]),
  };

  const ideas: ExportTable = {
    name: rk("ideas.name"),
    columns: [
      rk("ideas.idea"), rk("ideas.title"), rk("ideas.description"), rk("ideas.keywords"), rk("ideas.format"), rk("ideas.difficulty"), rk("ideas.discoverySurface"),
      rk("ideas.honestPromise"), rk("ideas.payoff"), rk("ideas.thumbnailConcept"), rk("ideas.studioMetric"), rk("ideas.experimentRule"),
      rk("ideas.evidenceClaimIds"), rk("ideas.sourceVideoIds"),
    ],
    rows: data.ideas.map((idea, index) => [
      index + 1,
      idea.title,
      idea.description,
      joined(idea.keywords),
      idea.format,
      idea.difficulty,
      idea.discoverySurface,
      idea.honestPromise,
      idea.payoff,
      idea.thumbnailConcept,
      idea.studioMetric,
      idea.experimentRule,
      joined(idea.evidenceClaims.map((claim) => claim.id)),
      joined(Array.from(new Set(idea.evidenceClaims.flatMap((claim) => claim.sourceVideoIds)))),
    ]),
  };

  const provenance: ExportTable = {
    name: rk("sources.name"),
    columns: [rk("sources.section"), rk("sources.field"), rk("sources.value")],
    rows: [
      [rk("sources.provenance"), rk("sources.provider"), data.provenance.provider],
      [rk("sources.provenance"), rk("sources.query"), data.provenance.query],
      [rk("sources.provenance"), rk("sources.orderedVideoIds"), joined(data.provenance.orderedVideoIds)],
      ...Object.entries(data.enrichment).flatMap(([stage, detail]) => [
        [rk("sources.enrichment"), rk("sources.status", { stage }), detail.status],
        [rk("sources.enrichment"), rk("sources.requested", { stage }), detail.requested],
        [rk("sources.enrichment"), rk("sources.returned", { stage }), detail.returned],
      ]),
      ...data.warnings.map((warning, index) => [
        rk("sources.warnings"),
        `${index + 1}. ${warning.code}`,
        `${warning.stage}: ${warning.message}`,
      ]),
    ],
  };

  return [summary, overview, videos, aiInsights, evidence, ideas, provenance];
}

function csvCell(value: Cell): string {
  const text = readable(value).replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildResearchCsv(data: ResearchReportData): string {
  const rows: Cell[][] = [[rk("table"), rk("row"), rk("summary.field"), rk("summary.value")]];
  for (const table of buildResearchExportTables(data)) {
    table.rows.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        rows.push([table.name, rowIndex + 1, table.columns[columnIndex], readable(value)]);
      });
    });
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

function xml(value: Cell): string {
  return readable(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlCell(value: Cell, header = false): string {
  const numeric = typeof value === "number" && Number.isFinite(value);
  const style = header ? ' ss:StyleID="Header"' : "";
  return `<Cell${style}><Data ss:Type="${numeric ? "Number" : "String"}">${xml(value)}</Data></Cell>`;
}

export function buildResearchXls(data: ResearchReportData): string {
  const worksheets = buildResearchExportTables(data).map((table) => {
    const header = `<Row>${table.columns.map((column) => xmlCell(column, true)).join("")}</Row>`;
    const rows = table.rows.map((row) => `<Row>${row.map((value) => xmlCell(value)).join("")}</Row>`).join("");
    const columns = table.columns.map((column, index) => {
      const longest = Math.max(column.length, ...table.rows.slice(0, 100).map((row) => readable(row[index]).length));
      return `<Column ss:AutoFitWidth="0" ss:Width="${Math.min(320, Math.max(70, longest * 6))}"/>`;
    }).join("");
    return `<Worksheet ss:Name="${xml(table.name.slice(0, 31))}"><Table>${columns}${header}${rows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Font ss:FontName="Arial" ss:Size="10"/></Style><Style ss:ID="Header"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#B9563F" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style></Styles>${worksheets}</Workbook>`;
}

function download(contents: BlobPart, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadResearchCsv(data: ResearchReportData): void {
  download(
    buildResearchCsv(data),
    "text/csv;charset=utf-8",
    `youtube-research-${safeExportStem(data.query)}.csv`,
  );
}

export function downloadResearchXls(data: ResearchReportData): void {
  download(
    buildResearchXls(data),
    "application/vnd.ms-excel;charset=utf-8",
    `youtube-research-${safeExportStem(data.query)}.xls`,
  );
}
