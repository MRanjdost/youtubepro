import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Search, Video as VideoIcon, Loader2, TrendingUp, Users, Eye, Clock,
  ChevronDown, ChevronUp, Target, Lightbulb, BarChart3,
  HelpCircle, Download, ArrowRight, ExternalLink, RefreshCw, Activity,
  Database, Hash, ListChecks, Sparkles, Compass, CheckCircle2, FlaskConical,
  AlertCircle, KeyRound, WifiOff, Image as ImageIcon, PlayCircle, FileSpreadsheet, Table2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { generateResearchPDF } from "@/lib/pdfGenerator";
import {
  downloadResearchCsv,
  downloadResearchXls,
  type ResearchReportData,
} from "@/lib/research-export";
import { useWorkflow } from "@/lib/workflow-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { VideoCard } from "@/components/video-card";
import { VideoCardSkeleton } from "@/components/video-card-skeleton";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { resolveError } from "@/lib/error-resolver";
import { formatPercent, formatDate } from "@/lib/formatter";
import { EmptyState } from "@/components/empty-state";
import { SearchFilters } from "@/components/search-filters";
import { VideoDetailDialog } from "@/components/video-detail-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { StarryBackground } from "@/components/ui/starry-background";
import type { IdeaGenerationResponse, IdeaPackage, Video, SearchResponse, ResearchInsightsResponse } from "@shared/schema";
import { UploadDateFilter, DurationFilter, SortBy } from "@shared/schema";
import { calculateYouTubeAnalytics } from "@/lib/youtube-analytics";

type ResearchInsights = ResearchInsightsResponse;

type GroundedIdeaResponse = IdeaGenerationResponse;

type AppliedFilters = {
  uploadDate: UploadDateFilter;
  duration: DurationFilter;
  sortBy: SortBy;
};

type ApiWarning = SearchResponse["warnings"][number];
type ResearchSearchResponse = SearchResponse;

type ApiErrorCategory =
  | "missing_key"
  | "invalid_key"
  | "quota"
  | "timeout"
  | "offline"
  | "server"
  | "invalid_response"
  | "unknown";

class ResearchRequestError extends Error {
  status: number;
  code?: string;
  category: ApiErrorCategory;
  retryable: boolean;
  suggestion?: string;

  constructor(options: {
    message: string;
    status: number;
    code?: string;
    category: ApiErrorCategory;
    retryable?: boolean;
    suggestion?: string;
  }) {
    super(options.message);
    this.name = "ResearchRequestError";
    this.status = options.status;
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable ?? options.status >= 500;
    this.suggestion = options.suggestion;
  }
}

function normalizeErrorCategory(status: number, category: unknown, message: string): ApiErrorCategory {
  const normalized = `${String(category || "")} ${message}`.toLowerCase();
  if (normalized.includes("missing") && normalized.includes("key")) return "missing_key";
  if (normalized.includes("invalid") && (normalized.includes("key") || normalized.includes("credential"))) return "invalid_key";
  if (status === 429 || normalized.includes("quota") || normalized.includes("rate limit")) return "quota";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout";
  if (normalized.includes("network")) return "offline";
  if (normalized.includes("invalid_response") || normalized.includes("invalid response") || normalized.includes("schema")) return "invalid_response";
  if (normalized.includes("provider_server")) return "server";
  if (status >= 500) return "server";
  if (status === 401 || status === 403) return "invalid_key";
  return "unknown";
}

async function readApiError(response: Response): Promise<ResearchRequestError> {
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  const message = typeof payload.error === "string" ? payload.error : response.statusText || i18n.t("research:errors.requestFailed");
  return new ResearchRequestError({
    message,
    status: response.status,
    code: typeof payload.code === "string" ? payload.code : undefined,
    category: normalizeErrorCategory(response.status, payload.category, message),
    retryable: typeof payload.retryable === "boolean" ? payload.retryable : response.status >= 500,
    suggestion: typeof payload.suggestion === "string" ? payload.suggestion : undefined,
  });
}

function warningText(warning: ApiWarning): string {
  return warning.message || warning.code || i18n.t("research:errors.enrichmentUnavailable");
}

function scanLabel(value: string, fallback: string): string {
  const cleaned = value.replace(/^gap\s*\d*\s*[-:]\s*/i, "").trim();
  if (!cleaned) return fallback;
  const firstClause = cleaned.split(/[.:;]/)[0]?.trim() || cleaned;
  return firstClause.length > 76 ? `${firstClause.slice(0, 75).trimEnd()}…` : firstClause;
}

function errorPresentation(category: ApiErrorCategory) {
  switch (category) {
    case "missing_key":
      return { title: i18n.t("research:errors.youtubeKeyRequired"), icon: KeyRound };
    case "invalid_key":
      return { title: i18n.t("research:errors.youtubeKeyRejected"), icon: KeyRound };
    case "quota":
      return { title: i18n.t("research:errors.youtubeQuota"), icon: AlertCircle };
    case "timeout":
      return { title: i18n.t("research:errors.youtubeTimeout"), icon: WifiOff };
    case "offline":
      return { title: i18n.t("research:errors.offline"), icon: WifiOff };
    case "server":
      return { title: i18n.t("research:errors.serviceUnavailable"), icon: AlertCircle };
    default:
      return { title: i18n.t("research:errors.searchFailed"), icon: AlertCircle };
  }
}

function aiErrorTitle(t: (key: string) => string, category: ApiErrorCategory | null): string {
  switch (category) {
    case "missing_key": return t("research:errors.geminiKeyRequired");
    case "invalid_key": return t("research:errors.geminiKeyRejected");
    case "quota": return t("research:errors.geminiQuota");
    case "timeout": return t("research:errors.geminiTimeout");
    case "offline": return t("research:errors.offline");
    case "server": return t("research:errors.aiServer");
    default: return t("research:insights.insightsUnavailable");
  }
}

const CHART_COLORS = ["#f28b82", "#7aa2d6", "#73b3a6", "#a78bca", "#d4a85a"];
const BAR_COLORS = ["#ef9a90", "#86a9d5", "#7fb7aa", "#a995c9", "#d2af6d", "#8fa5b8"];

function formatCompact(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

const IDEA_FORMAT_KEYS: Record<string, string> = {
  "YouTube Short (< 60 sec)": "research:ideas.formats.short",
  "Long-form Video (8-15 min)": "research:ideas.formats.longForm",
  "Tutorial/How-to": "research:ideas.formats.tutorial",
  "Product Review": "research:ideas.formats.review",
  "Vlog Style": "research:ideas.formats.vlog",
};

const IDEA_DIFFICULTY_KEYS: Record<string, string> = {
  Easy: "research:ideas.difficulty.easy",
  Medium: "research:ideas.difficulty.medium",
  Hard: "research:ideas.difficulty.hard",
  Advanced: "research:ideas.difficulty.advanced",
};

const SURFACE_KEYS: Record<string, string> = {
  search: "research:ideas.surfaces.search",
  browse: "research:ideas.surfaces.browse",
  suggested: "research:ideas.surfaces.suggested",
  shorts_feed: "research:ideas.surfaces.shorts_feed",
  mixed: "research:ideas.surfaces.mixed",
};

const DURATION_KEYS: Record<string, string> = {
  "Under 4 min": "research:duration.under4",
  "4 to 20 min": "research:duration.between4and20",
  "Over 20 min": "research:duration.over20",
};

const RECENCY_KEYS: Record<string, string> = {
  "Last 7 days": "research:recency.days7",
  "8-30 days": "research:recency.days30",
  "1-12 months": "research:recency.months12",
  "Over 1 year": "research:recency.yearOver",
};

const CADENCE_FALLBACK_KEYS: Record<string, string> = {
  "Insufficient evidence from this snapshot": "research:insights.insufficientEvidence",
};

function ideaLabel(t: (key: string) => string, map: Record<string, string>, value: string): string {
  const key = map[value];
  return key ? t(key) : value;
}

function evidenceClassLabel(evidenceClass: string): string {
  switch (evidenceClass) {
    case "observed": return i18n.t("research:insights.evidenceClass.observed");
    case "inferred": return i18n.t("research:insights.evidenceClass.inferred");
    case "requires_studio": return i18n.t("research:insights.evidenceClass.requires_studio");
    default: return evidenceClass.replace("_", " ");
  }
}

function scaleKeyword(value: string): string {
  if (/high|بالا|زیاد|قوی/i.test(value)) return "بالا";
  if (/low|پایین|کم|ضعیف/i.test(value)) return "پایین";
  if (/medium|متوسط|میانه/i.test(value)) return "متوسط";
  return value.split(" ")[0] || value;
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent><Skeleton className="h-48 w-full" /></CardContent>
        </Card>
        <Card>
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent><Skeleton className="h-48 w-full" /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-6 ai-insights-glow rounded-lg p-1">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-4 w-full" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function IdeasSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Generating grounded ideas">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index}>
          <CardHeader className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ResearchDashboard() {
  const { t } = useTranslation(["research", "ideas"]);
  const [, setLocation] = useLocation();
  const { state: workflowState, setCachedResearch, setIdeaData, clearHighlight, goToStep } = useWorkflow();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [uploadDate, setUploadDate] = useState<UploadDateFilter>(UploadDateFilter.ANY);
  const [duration, setDuration] = useState<DurationFilter>(DurationFilter.ANY);
  const [sortBy, setSortBy] = useState<SortBy>(SortBy.RELEVANCE);
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({
    uploadDate: UploadDateFilter.ANY,
    duration: DurationFilter.ANY,
    sortBy: SortBy.RELEVANCE,
  });
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<number>>(new Set());
  const [evidenceLedgerOpen, setEvidenceLedgerOpen] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xls" | "csv" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [animationKey, setAnimationKey] = useState(0);
  const isProgrammaticFocus = useRef(false);

  const [insights, setInsights] = useState<ResearchInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsErrorCategory, setInsightsErrorCategory] = useState<ApiErrorCategory | null>(null);
  const [ideaPackages, setIdeaPackages] = useState<IdeaPackage[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<IdeaPackage | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [ideasErrorCategory, setIdeasErrorCategory] = useState<ApiErrorCategory | null>(null);
  const insightsFetchedRef = useRef<string>("");
  const ideasFetchedRef = useRef<string>("");
  const [cachedData, setCachedData] = useState<ResearchSearchResponse | null>(null);
  const restoredFromCache = useRef(false);
  const insightAbortRef = useRef<AbortController | null>(null);
  const ideaAbortRef = useRef<AbortController | null>(null);
  const currentSnapshotRef = useRef<string>("");
  const workflowStartTriggerRef = useRef(workflowState.highlightTrigger);

  useEffect(() => {
    if (!restoredFromCache.current && workflowState.cachedResearch && !submittedQuery) {
      restoredFromCache.current = true;
      const cached = workflowState.cachedResearch;
      setSearchQuery(cached.query);
      setSubmittedQuery(cached.query);
      setUploadDate(cached.filters.uploadDate as UploadDateFilter);
      setDuration(cached.filters.duration as DurationFilter);
      setSortBy(cached.filters.sortBy as SortBy);
      setAppliedFilters({
        uploadDate: cached.filters.uploadDate as UploadDateFilter,
        duration: cached.filters.duration as DurationFilter,
        sortBy: cached.filters.sortBy as SortBy,
      });
      if (cached.insights) {
        setInsights(cached.insights as ResearchInsights);
        insightsFetchedRef.current = cached.snapshotId || `legacy-${cached.timestamp}`;
      }
      setCachedData({
        videos: cached.videos,
        totalResults: cached.totalResults,
        resultsPerPage: cached.resultsPerPage,
        regionCode: cached.regionCode,
        nextPageToken: cached.nextPageToken,
        snapshotId: cached.snapshotId || `legacy-${cached.timestamp}`,
        retrievedAt: cached.retrievedAt || new Date(cached.timestamp).toISOString(),
        totalResultsIsApproximate: cached.totalResultsIsApproximate ?? true,
        warnings: cached.warnings || [],
        enrichment: cached.enrichment || {
          search: { status: "complete", requested: cached.videos.length, returned: cached.videos.length },
          videoDetails: { status: "complete", requested: cached.videos.length, returned: cached.videos.length },
          channels: { status: "skipped", requested: 0, returned: 0 },
        },
        provenance: cached.provenance || {
          provider: "youtube-data-api-v3",
          query: cached.query,
          filters: {
            uploadDate: cached.filters.uploadDate as UploadDateFilter,
            duration: cached.filters.duration as DurationFilter,
            sortBy: cached.filters.sortBy as SortBy,
            maxResults: 50,
          },
          orderedVideoIds: cached.videos.map((video) => video.id),
        },
      });
      const restoredSnapshotId = cached.snapshotId || `legacy-${cached.timestamp}`;
      currentSnapshotRef.current = restoredSnapshotId;
      if (
        workflowState.idea?.niche === cached.query
        || workflowState.idea?.evidenceContext?.snapshotId === restoredSnapshotId
      ) {
        const restoredIdeas = workflowState.idea.generatedIdeas || [];
        setIdeaPackages(restoredIdeas);
        setSelectedIdea(workflowState.idea.selectedIdea);
        if (restoredIdeas.length > 0) ideasFetchedRef.current = restoredSnapshotId;
      }
    }
  }, [workflowState.cachedResearch, submittedQuery]);

  useEffect(() => {
    if (workflowState.highlightSearchBox && searchInputRef.current) {
      setAnimationKey(prev => prev + 1);
      isProgrammaticFocus.current = true;
      searchInputRef.current.focus();
      searchInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });

      const timer = setTimeout(() => {
        clearHighlight();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [workflowState.highlightSearchBox, workflowState.highlightTrigger, clearHighlight]);

  useEffect(() => {
    if (workflowStartTriggerRef.current === workflowState.highlightTrigger) return;
    workflowStartTriggerRef.current = workflowState.highlightTrigger;
    if (!workflowState.isWorkflowActive || workflowState.cachedResearch) return;

    insightAbortRef.current?.abort();
    ideaAbortRef.current?.abort();
    setSearchQuery("");
    setSubmittedQuery("");
    setUploadDate(UploadDateFilter.ANY);
    setDuration(DurationFilter.ANY);
    setSortBy(SortBy.RELEVANCE);
    setAppliedFilters({
      uploadDate: UploadDateFilter.ANY,
      duration: DurationFilter.ANY,
      sortBy: SortBy.RELEVANCE,
    });
    setCachedData(null);
    setInsights(null);
    setInsightsError(null);
    setInsightsErrorCategory(null);
    setIdeaPackages([]);
    setSelectedIdea(null);
    setIdeasLoading(false);
    setIdeasError(null);
    setIdeasErrorCategory(null);
    setExportError(null);
    setExpandedQuestions(new Set());
    setEvidenceLedgerOpen(false);
    setMethodologyOpen(false);
    currentSnapshotRef.current = "";
    insightsFetchedRef.current = "";
    ideasFetchedRef.current = "";
    restoredFromCache.current = false;
  }, [workflowState.highlightTrigger, workflowState.isWorkflowActive, workflowState.cachedResearch]);

  const handleSearchFocus = () => {
    if (isProgrammaticFocus.current) {
      isProgrammaticFocus.current = false;
      return;
    }
    if (workflowState.highlightSearchBox) {
      clearHighlight();
    }
  };

  const buildSearchUrl = () => {
    const params = new URLSearchParams({
      query: submittedQuery,
      uploadDate: appliedFilters.uploadDate,
      duration: appliedFilters.duration,
      sortBy: appliedFilters.sortBy,
      maxResults: "50",
    });
    return `/api/youtube/search?${params}`;
  };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<ResearchSearchResponse>({
    queryKey: [
      "/api/youtube/search",
      submittedQuery,
      appliedFilters.uploadDate,
      appliedFilters.duration,
      appliedFilters.sortBy,
    ],
    queryFn: async ({ signal }) => {
      let res: Response;
      try {
        res = await fetch(buildSearchUrl(), { signal, credentials: "include" });
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") throw requestError;
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        throw new ResearchRequestError({
          message: offline ? i18n.t("research:errors.offline") : i18n.t("research:errors.ytSearchUnreachable"),
          status: 0,
          category: offline ? "offline" : "server",
          retryable: true,
        });
      }
      if (!res.ok) {
        throw await readApiError(res);
      }
      return res.json();
    },
    enabled: submittedQuery.length > 0 && !cachedData,
  });

  const sourceData = data || cachedData;
  const snapshotId = sourceData?.snapshotId || [
    submittedQuery,
    appliedFilters.uploadDate,
    appliedFilters.duration,
    appliedFilters.sortBy,
    sourceData?.retrievedAt || "cached",
    sourceData?.videos?.map((video) => video.id).join(",") || "",
  ].join("|");
  const insightRequestKey = snapshotId;

  useEffect(() => {
    if (!sourceData?.videos?.length || !snapshotId) return;
    if (currentSnapshotRef.current === snapshotId) return;
    insightAbortRef.current?.abort();
    ideaAbortRef.current?.abort();
    currentSnapshotRef.current = snapshotId;
    setInsights(null);
    setInsightsError(null);
    setInsightsErrorCategory(null);
    setInsightsLoading(false);
    insightsFetchedRef.current = "";
    setIdeaPackages([]);
    setSelectedIdea(null);
    setIdeasLoading(false);
    setIdeasError(null);
    setIdeasErrorCategory(null);
    ideasFetchedRef.current = "";
  }, [snapshotId, sourceData]);

  useEffect(() => () => {
    insightAbortRef.current?.abort();
    ideaAbortRef.current?.abort();
  }, []);

  const fetchInsights = useCallback(async () => {
    if (!sourceData?.videos || sourceData.videos.length === 0 || insightsLoading || isFetching) return;
    if (insightsFetchedRef.current === insightRequestKey) return;

    const snapshotAnalytics = calculateYouTubeAnalytics(sourceData.videos);

    insightAbortRef.current?.abort();
    const controller = new AbortController();
    insightAbortRef.current = controller;
    const requestedSnapshotId = insightRequestKey;
    setInsightsLoading(true);
    setInsightsError(null);
    setInsightsErrorCategory(null);
    insightsFetchedRef.current = insightRequestKey;
    try {
      const response = await fetch("/api/research/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          query: submittedQuery,
          videos: sourceData.videos,
          snapshotId: requestedSnapshotId,
          retrievedAt: sourceData.retrievedAt,
          provenance: sourceData.provenance,
          analytics: {
            totalVideos: snapshotAnalytics.totalVideos,
            totalViews: snapshotAnalytics.totalViews,
            avgViews: snapshotAnalytics.avgViews,
            medianViews: snapshotAnalytics.medianViews,
            medianDailyViews: snapshotAnalytics.medianDailyViews,
            avgEngagement: snapshotAnalytics.avgEngagement === "N/A"
              ? "N/A"
              : Number(snapshotAnalytics.avgEngagement),
            uniqueChannels: snapshotAnalytics.uniqueChannels,
            durationData: snapshotAnalytics.durationData,
            recencyData: snapshotAnalytics.recencyData,
            topTags: snapshotAnalytics.topTags,
            coverage: snapshotAnalytics.coverage,
          },
          enrichment: sourceData.enrichment,
          warnings: sourceData.warnings,
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const result = await response.json() as ResearchInsights & { snapshotId?: string };
      if (
        controller.signal.aborted ||
        currentSnapshotRef.current !== requestedSnapshotId ||
        result.snapshotId !== requestedSnapshotId
      ) {
        return;
      }
      setInsights(result);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      const normalizedError = requestError instanceof ResearchRequestError
        ? requestError
        : new ResearchRequestError({
            message: requestError instanceof Error ? requestError.message : i18n.t("research:errors.insightGenFailed"),
            status: 0,
            category: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "unknown",
            retryable: true,
          });
      const resolved = resolveError(normalizedError, t("research:analytics.overview"));
      setInsightsError(resolved.suggestion || resolved.title);
      setInsightsErrorCategory(normalizedError.category);
      insightsFetchedRef.current = "";
    } finally {
      if (currentSnapshotRef.current === requestedSnapshotId) setInsightsLoading(false);
    }
  }, [sourceData, submittedQuery, insightsLoading, isFetching, insightRequestKey]);

  useEffect(() => {
    if (sourceData?.videos && sourceData.videos.length > 0 && !isFetching && !insights && !insightsLoading && !insightsError) {
      void fetchInsights();
    }
  }, [sourceData, isFetching, insights, insightsLoading, insightsError, fetchInsights]);

  const fetchIdeas = useCallback(async () => {
    if (!sourceData?.videos.length || !insights || ideasLoading || isFetching) return;
    if (ideasFetchedRef.current === snapshotId) return;

    const evidenceClaims = insights.evidenceClaims || [];
    if (evidenceClaims.length === 0) {
      ideasFetchedRef.current = snapshotId;
      setIdeasError(i18n.t("research:errors.ideaNoEvidence"));
      setIdeasErrorCategory("unknown");
      return;
    }

    ideaAbortRef.current?.abort();
    const controller = new AbortController();
    ideaAbortRef.current = controller;
    const requestedSnapshotId = snapshotId;
    setIdeasLoading(true);
    setIdeasError(null);
    setIdeasErrorCategory(null);
    ideasFetchedRef.current = requestedSnapshotId;

    try {
      const response = await fetch("/api/ideas/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          niche: submittedQuery,
          keywords: insights.trendingSubtopics?.slice(0, 6).join(", ") || "",
          audience: insights.targetAudience?.primaryDemographic || "",
          researchContext: {
            query: submittedQuery,
            snapshotId: requestedSnapshotId,
            sourceVideoIds: sourceData.provenance.orderedVideoIds,
            evidenceClaims,
          },
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const result = await response.json() as GroundedIdeaResponse;
      if (
        controller.signal.aborted
        || currentSnapshotRef.current !== requestedSnapshotId
        || result.snapshotId !== requestedSnapshotId
      ) {
        return;
      }
      setIdeaPackages(result.ideas);
      setSelectedIdea(null);
      setIdeaData({
        selectedIdea: null,
        generatedIdeas: result.ideas,
        niche: submittedQuery,
        audience: insights.targetAudience?.primaryDemographic || "",
      });
    } catch (requestError) {
      if (controller.signal.aborted) return;
      const normalizedError = requestError instanceof ResearchRequestError
        ? requestError
        : new ResearchRequestError({
            message: requestError instanceof Error ? requestError.message : i18n.t("research:errors.ideaGenFailed"),
            status: 0,
            category: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "unknown",
            retryable: true,
          });
      const resolved = resolveError(normalizedError, t("research:analytics.overview"));
      setIdeasError(resolved.suggestion || resolved.title);
      setIdeasErrorCategory(normalizedError.category);
      ideasFetchedRef.current = "";
    } finally {
      if (currentSnapshotRef.current === requestedSnapshotId) setIdeasLoading(false);
    }
  }, [sourceData, insights, ideasLoading, isFetching, snapshotId, submittedQuery, setIdeaData]);

  useEffect(() => {
    if (insights && !insightsLoading && !ideasLoading && ideaPackages.length === 0 && !ideasError) {
      void fetchIdeas();
    }
  }, [insights, insightsLoading, ideasLoading, ideaPackages.length, ideasError, fetchIdeas]);

  const handleSearch = useCallback(async () => {
    if (searchQuery.trim()) {
      const nextQuery = searchQuery.trim();
      const sameSearch = nextQuery === submittedQuery
        && uploadDate === appliedFilters.uploadDate
        && duration === appliedFilters.duration
        && sortBy === appliedFilters.sortBy;
      insightAbortRef.current?.abort();
      ideaAbortRef.current?.abort();
      setCachedData(null);
      setInsights(null);
      setInsightsError(null);
      setInsightsErrorCategory(null);
      setIdeaPackages([]);
      setSelectedIdea(null);
      setIdeasLoading(false);
      setIdeasError(null);
      setIdeasErrorCategory(null);
      setExportError(null);
      insightsFetchedRef.current = "";
      ideasFetchedRef.current = "";
      setAppliedFilters({ uploadDate, duration, sortBy });
      setSubmittedQuery(nextQuery);
      if (sameSearch) await refetch();
    }
  }, [searchQuery, submittedQuery, uploadDate, duration, sortBy, appliedFilters, refetch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleVideoClick = (video: Video) => {
    setSelectedVideo(video);
    setDialogOpen(true);
  };

  const toggleQuestion = (index: number) => {
    setExpandedQuestions(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const buildCurrentReport = (): ResearchReportData | null => {
    const sourceData = data || cachedData;
    if (!sourceData?.videos || !analytics || !insights || ideaPackages.length === 0) return null;
    return {
      query: submittedQuery,
      totalResults: sourceData.totalResults,
      totalResultsIsApproximate: sourceData.totalResultsIsApproximate,
      resultsPerPage: sourceData.resultsPerPage,
      regionCode: sourceData.regionCode,
      nextPageToken: sourceData.nextPageToken,
      snapshotId: sourceData.snapshotId,
      retrievedAt: sourceData.retrievedAt,
      filters: {
        uploadDate: appliedFilters.uploadDate,
        duration: appliedFilters.duration,
        sortBy: appliedFilters.sortBy,
      },
      analytics,
      videos: sourceData.videos,
      insights,
      ideas: ideaPackages,
      provenance: sourceData.provenance,
      enrichment: sourceData.enrichment,
      warnings: sourceData.warnings,
    };
  };

  const handleExport = async (format: "pdf" | "xls" | "csv") => {
    if (exporting) return;
    const report = buildCurrentReport();
    if (!report) {
      {t("research:search.exportPipeline")}
      return;
    }

    setExporting(format);
    setExportError(null);
    try {
      // Yield once so the selected button can paint its format-specific state
      // before synchronous spreadsheet serialization begins.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (format === "pdf") await generateResearchPDF(report);
      else if (format === "xls") downloadResearchXls(report);
      else downloadResearchCsv(report);
    } catch (error) {
      console.error(`Failed to generate ${format.toUpperCase()} export:`, error);
      setExportError(t("research:errors.exportFailed", { format: format.toUpperCase() }));
    } finally {
      setExporting(null);
    }
  };

  const analytics = useMemo(() => {
    const sourceVideos = (data || cachedData)?.videos;
    return sourceVideos && sourceVideos.length > 0
      ? calculateYouTubeAnalytics(sourceVideos)
      : null;
  }, [data, cachedData]);

  const saveResearchToCache = useCallback(() => {
    const sourceData = data || cachedData;
    if (!sourceData?.videos || !analytics) return;

    setCachedResearch({
      query: submittedQuery,
      totalResults: sourceData.totalResults,
      resultsPerPage: sourceData.resultsPerPage,
      regionCode: sourceData.regionCode,
      nextPageToken: sourceData.nextPageToken,
      videos: sourceData.videos,
      insights: insights,
      analytics: {
        totalViews: analytics.totalViews,
        avgViews: analytics.avgViews,
        avgEngagement: analytics.avgEngagement,
        totalVideos: analytics.totalVideos,
        totalEngagement: analytics.totalEngagement,
        viewsDistribution: analytics.viewsDistribution,
        durationData: analytics.durationData,
        topVideo: analytics.topVideo,
        topVideosList: analytics.topVideosList,
      },
      filters: {
        uploadDate: appliedFilters.uploadDate,
        duration: appliedFilters.duration,
        sortBy: appliedFilters.sortBy,
      },
      timestamp: Date.now(),
      snapshotId: sourceData.snapshotId,
      retrievedAt: sourceData.retrievedAt,
      totalResultsIsApproximate: sourceData.totalResultsIsApproximate,
      warnings: sourceData.warnings,
      enrichment: sourceData.enrichment,
      provenance: sourceData.provenance,
    });
  }, [data, cachedData, analytics, insights, submittedQuery, appliedFilters, setCachedResearch]);

  useEffect(() => {
    if (!submittedQuery || isFetching || !sourceData?.videos?.length || !analytics) return;
    saveResearchToCache();
  }, [analytics, isFetching, saveResearchToCache, sourceData, submittedQuery]);

  const handleSelectIdea = (idea: IdeaPackage) => {
    if (!sourceData || !insights?.evidenceClaims?.length) return;
    setSelectedIdea(idea);
    setIdeaData({
      selectedIdea: idea,
      generatedIdeas: ideaPackages,
      niche: submittedQuery,
      audience: insights.targetAudience?.primaryDemographic || "",
      evidenceContext: {
        snapshotId: sourceData.snapshotId,
        sourceVideoIds: sourceData.provenance.orderedVideoIds,
        evidenceClaims: insights.evidenceClaims,
        ideaPackage: idea,
      },
    });
  };

  const handleProceedToScript = () => {
    if (!selectedIdea) return;
    saveResearchToCache();
    handleSelectIdea(selectedIdea);
    goToStep("script");
    setLocation("/script");
  };

  const handleContinueWithoutAI = () => {
    saveResearchToCache();
    setIdeaData({
      selectedIdea: null,
      generatedIdeas: [],
      niche: submittedQuery,
      audience: "",
    });
    goToStep("script");
    setLocation("/script");
  };

  const handleRefreshResearch = async () => {
    insightAbortRef.current?.abort();
    ideaAbortRef.current?.abort();
    setInsights(null);
    setInsightsError(null);
    setInsightsErrorCategory(null);
    setIdeaPackages([]);
    setSelectedIdea(null);
    setIdeasLoading(false);
    setIdeasError(null);
    setIdeasErrorCategory(null);
    setExportError(null);
    insightsFetchedRef.current = "";
    ideasFetchedRef.current = "";
    await refetch();
  };

  const effectiveData = data || cachedData;
  const showLoading = isLoading || isFetching;
  const hasResults = effectiveData?.videos && effectiveData.videos.length > 0;
  const hasSearched = submittedQuery.length > 0;
  const displayedVideos = effectiveData?.videos || [];
  const searchError = error instanceof ResearchRequestError
    ? error
    : isError
      ? new ResearchRequestError({
          message: error instanceof Error ? error.message : i18n.t("research:errors.ytSearchFailed"),
          status: 0,
          category: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "unknown",
          retryable: true,
        })
      : null;
  const partialWarnings = effectiveData?.warnings || [];
  const incompleteEnrichmentStages = effectiveData?.enrichment
    ? Object.entries(effectiveData.enrichment).filter(([, stage]) => stage.status !== "complete")
    : [];
  const hasPartialEnrichment = partialWarnings.length > 0 || incompleteEnrichmentStages.length > 0;
  const exportPipelineLoading = Boolean(
    showLoading
    || insightsLoading
    || ideasLoading
    || (hasResults && !insights && !insightsError)
    || (hasResults && insights && ideaPackages.length === 0 && !ideasError),
  );
  const exportReady = Boolean(
    hasResults
    && analytics
    && insights
    && ideaPackages.length > 0
    && !showLoading
    && !insightsLoading
    && !ideasLoading,
  );
  const exportDisabled = !exportReady || exporting !== null;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col min-h-full relative">
        <StarryBackground />
        <div className="border-b border-border glass-subtle sticky top-0 z-50 relative">
          <div className="dashboard-container space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div
                key={animationKey}
                className={`relative flex-1 transition-all duration-500 ${
                  workflowState.highlightSearchBox
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-md animate-pulse"
                    : ""
                }`}
              >
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="search"
                  aria-label={t("research:search.label")}
                  placeholder={t("research:search.placeholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={handleSearchFocus}
                  className="ps-10 h-11"
                  data-testid="input-search"
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={!searchQuery.trim() || showLoading}
                className="h-11 px-6"
                data-testid="button-search"
              >
                {showLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin me-2" />
                ) : (
                  <Search className="h-4 w-4 me-2" />
                )}
                {t("research:search.button")}
              </Button>
            </div>

            <SearchFilters
              uploadDate={uploadDate}
              duration={duration}
              sortBy={sortBy}
              onUploadDateChange={setUploadDate}
              onDurationChange={setDuration}
              onSortByChange={setSortBy}
            />
            {hasSearched && (
              <p className="text-xs text-muted-foreground">
                {t("research:search.filtersDraft")}
              </p>
            )}
          </div>
        </div>

        <div className="relative z-10 dashboard-container flex-1">
          {searchError && !showLoading && (() => {
            const presentation = errorPresentation(searchError.category);
            const ErrorIcon = presentation.icon;
            const keyError = searchError.category === "missing_key" || searchError.category === "invalid_key";
            return (
              <Alert variant="destructive" className="mb-6" data-testid={`alert-search-${searchError.category}`}>
                <ErrorIcon className="h-4 w-4" />
                <AlertTitle>{presentation.title}</AlertTitle>
                <AlertDescription className="space-y-3">
                  {(() => {
                    const resolved = resolveError(searchError, t("research:analytics.overview"));
                    return <p>{resolved.suggestion || resolved.title}</p>;
                  })()}
                  <div className="flex flex-wrap gap-2">
                    {keyError && (
                      <Button size="sm" variant="outline" onClick={() => setLocation("/settings")}>
                        {t("research:errors.openSettings")}
                      </Button>
                    )}
                    {(searchError.retryable || !keyError) && (
                      <Button size="sm" variant="outline" onClick={() => void refetch()}>
                        {t("research:errors.retrySearch")}
                      </Button>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            );
          })()}
          {showLoading ? (
            <div className="space-y-8">
              <OverviewSkeleton />
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <VideoIcon className="h-5 w-5" />
                  {t("research:search.videosHeading")}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <VideoCardSkeleton key={i} />
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Lightbulb className="h-5 w-5" />
                  {t("research:analytics.aiInsights")}
                </h2>
                <InsightsSkeleton />
              </div>
            </div>
          ) : hasResults ? (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground" data-testid="text-results-count">
                  {t("research:search.results", { count: effectiveData?.totalResults, query: submittedQuery })}.
                  {" "}{t("research:search.analyzing", { count: formatCompact(effectiveData?.videos.length), videos: effectiveData?.videos.length === 1 ? t("research:search.video") : t("research:search.videos") })}
                  {effectiveData?.retrievedAt
                    ? t("research:search.fromDate", { date: formatDate(effectiveData.retrievedAt) })
                    : ""}.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleRefreshResearch}
                    disabled={showLoading}
                    data-testid="button-refresh"
                  >
                    <RefreshCw className="h-4 w-4 me-2" />
                    {t("research:search.refresh")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleExport("pdf")}
                    disabled={exportDisabled}
                    aria-describedby={exportPipelineLoading ? "export-pipeline-status" : undefined}
                    data-testid="button-download-pdf"
                  >
                    {exportPipelineLoading || exporting === "pdf" ? (
                      <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 me-2" />
                    )}
                    {exportPipelineLoading ? t("research:search.exportWaiting") : exporting === "pdf" ? t("research:search.exportBuilding") : t("research:search.downloadPdf")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleExport("xls")}
                    disabled={exportDisabled}
                    aria-describedby={exportPipelineLoading ? "export-pipeline-status" : undefined}
                    data-testid="button-download-xls"
                  >
                    {exportPipelineLoading || exporting === "xls" ? (
                      <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="h-4 w-4 me-2" />
                    )}
                    {exportPipelineLoading ? t("research:search.exportWaitingXls") : exporting === "xls" ? t("research:search.exportBuildingXls") : t("research:search.downloadXls")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleExport("csv")}
                    disabled={exportDisabled}
                    aria-describedby={exportPipelineLoading ? "export-pipeline-status" : undefined}
                    data-testid="button-download-csv"
                  >
                    {exportPipelineLoading || exporting === "csv" ? (
                      <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    ) : (
                      <Table2 className="h-4 w-4 me-2" />
                    )}
                    {exportPipelineLoading ? t("research:search.exportWaitingCsv") : exporting === "csv" ? t("research:search.exportBuildingCsv") : t("research:search.downloadCsv")}
                  </Button>
                  {insightsError && (
                    <Button onClick={handleContinueWithoutAI} className="gap-1" data-testid="button-continue-without-ai">
                      {t("research:insights.continuing")}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>

              {exportPipelineLoading && (
                <p id="export-pipeline-status" className="text-xs text-muted-foreground" role="status" aria-live="polite">
                  {t("research:search.exportPipeline")}
                </p>
              )}

              {exportError && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t("research:search.exportError")}</AlertTitle>
                  <AlertDescription>{exportError}</AlertDescription>
                </Alert>
              )}

              {insightsError && (
                <Alert data-testid={`alert-insights-${insightsErrorCategory || "unknown"}`}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t("research:insights.insightsUnavailable")}</AlertTitle>
                  <AlertDescription>
                    {t("research:insights.insightsDesc")}
                  </AlertDescription>
                </Alert>
              )}

              {hasPartialEnrichment && (
                <Alert data-testid="alert-partial-enrichment">
                  <Database className="h-4 w-4" />
                  <AlertTitle>{t("research:search.partialEnrichment")}</AlertTitle>
                  <AlertDescription>
                    {partialWarnings.length > 0 ? (
                      <ul className="list-disc space-y-1 ps-5">
                        {partialWarnings.map((warning, index) => (
                          <li key={`${warningText(warning)}-${index}`}>{warningText(warning)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        {incompleteEnrichmentStages.map(([name, stage]) => (
                          `${name}: ${stage.returned}/${stage.requested} returned`
                        )).join("; ")}.
                      </p>
                    )}
                    <p className="mt-2">Unavailable fields remain N/A and are excluded from derived rates.</p>
                  </AlertDescription>
                </Alert>
              )}

              {analytics && (
                <section className="scroll-mt-40 space-y-5" aria-labelledby="research-overview-heading">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 id="research-overview-heading" className="text-lg font-semibold flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        {t("research:analytics.overview")}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("research:analytics.overviewSubtitle")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="border-success-subtle bg-success-subtle text-success">
                        {t("research:analytics.observedPublicData")}
                      </Badge>
                      <Badge variant="outline" className="border-info-subtle bg-info-subtle text-info">
                        {t("research:analytics.channelsCount", { count: analytics.uniqueChannels })}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <Eye className="h-4 w-4" />
                          <span className="text-xs font-medium">{t("research:analytics.sampleViews")}</span>
                        </div>
                        <p className="text-2xl font-bold" data-testid="stat-total-views">
                          {formatCompact(analytics.totalViews)}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{t("research:analytics.sumAcross")}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <TrendingUp className="h-4 w-4" />
                          <span className="text-xs font-medium">{t("research:analytics.medianViews")}</span>
                        </div>
                        <p className="text-2xl font-bold" data-testid="stat-avg-views">
                          {formatCompact(analytics.medianViews)}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{t("research:analytics.lessDistorted")}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <Activity className="h-4 w-4" />
                          <span className="text-xs font-medium">{t("research:analytics.medianViewsDay")}</span>
                        </div>
                        <p className="text-2xl font-bold" data-testid="stat-median-views-day">
                          {formatCompact(analytics.medianDailyViews)}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{t("research:analytics.ageAdjusted")}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <Users className="h-4 w-4" />
                          <span className="text-xs font-medium">{t("research:analytics.visibleInteraction")}</span>
                        </div>
                        <p className="text-2xl font-bold" data-testid="stat-avg-engagement">
                          {analytics.avgEngagement === "N/A" ? "N/A" : formatPercent(Number(analytics.avgEngagement) / 100)}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t("research:analytics.likesComments", { engaged: analytics.coverage.engagement, total: analytics.totalVideos })}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <TrendingUp className="h-4 w-4" />
                          <span className="text-xs font-medium">{t("research:analytics.averageViews")}</span>
                        </div>
                        <p className="text-2xl font-bold" data-testid="stat-avg-views">
                          {formatCompact(analytics.avgViews)}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{t("research:analytics.usefulWithMedian")}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <VideoIcon className="h-4 w-4" />
                          <span className="text-xs font-medium">{t("research:analytics.videosAnalyzed")}</span>
                        </div>
                        <p className="text-2xl font-bold" data-testid="stat-videos-analyzed">
                          {analytics.totalVideos}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{t("research:analytics.maxPerCall")}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.75fr)]">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          {t("research:analytics.topVideos")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {analytics.topVideosList.map((video, index) => {
                            const maxViews = analytics.topVideosList[0]?.viewCount || 1;
                            const barWidth = ((video.viewCount || 0) / maxViews) * 100;
                            return (
                              <a
                                key={video.id}
                                href={`https://www.youtube.com/watch?v=${video.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block group"
                                data-testid={`top-video-bar-${index}`}
                              >
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-muted-foreground w-4">{index + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate group-hover:text-info transition-colors flex items-center gap-1">
                                      {video.title}
                                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </p>
                                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted/70">
                                      <div
                                        className="h-full rounded-full transition-opacity group-hover:opacity-80"
                                        style={{ width: `${barWidth}%`, backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }}
                                      />
                                    </div>
                                  </div>
                                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                                    {video.viewCount === undefined ? "N/A" : formatCompact(video.viewCount)}
                                  </span>
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="self-start">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          {t("research:analytics.durationMix")}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">{t("research:analytics.durationSubtitle")}</p>
                      </CardHeader>
                      <CardContent className="grid items-center gap-4 sm:grid-cols-[170px_1fr] xl:grid-cols-1 2xl:grid-cols-[170px_1fr]">
                        <div className="mx-auto h-[170px] w-[170px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={analytics.durationData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={46}
                                outerRadius={72}
                                paddingAngle={2}
                                stroke="hsl(var(--card))"
                                strokeWidth={3}
                              >
                                {analytics.durationData.map((_, index) => (
                                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(value: number) => [t("research:analytics.tooltipVideos", { count: value }), t("research:analytics.tooltipSample")]}
                                contentStyle={{
                                  background: "hsl(var(--popover))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: 8,
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-3">
                          {analytics.durationData.map((item, index) => {
                            const percentage = analytics.totalVideos > 0
                              ? Math.round((item.value / analytics.totalVideos) * 100)
                              : 0;
                            return (
                              <div key={item.name} className="flex items-center gap-3">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">{ideaLabel(t, DURATION_KEYS, item.name)}</p>
                                  <p className="text-xs text-muted-foreground">{t("research:analytics.ofSample", { percentage })}</p>
                                </div>
                                <span className="text-sm font-semibold">{item.value}</span>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.75fr)]">
                    <Card className="self-start">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Activity className="h-4 w-4" />
                          {t("research:analytics.momentumLeaders")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {analytics.velocityLeaders.map(({ video, viewsPerDay }, index) => (
                          <a
                            key={video.id}
                            href={`https://www.youtube.com/watch?v=${video.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/10 p-3 transition-colors hover:border-[hsl(var(--info)/.35)] hover:bg-[hsl(var(--info)/.05)]"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-info-subtle text-xs font-semibold text-info">{index + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{video.title}</p>
                              <p className="text-xs text-muted-foreground">{video.channelTitle}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">{formatCompact(Math.round(viewsPerDay))}</p>
                              <p className="text-[11px] text-muted-foreground">{t("research:analytics.viewsPerDay")}</p>
                            </div>
                          </a>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          {t("research:analytics.viewsPerDayNote")}
                        </p>
                        {analytics.breakoutLeaders.length > 0 && (
                          <div className="space-y-2 border-t border-border pt-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t("research:analytics.breakout")}
                            </p>
                            {analytics.breakoutLeaders.slice(0, 3).map(({ video, viewsPerSubscriber }) => (
                              <div key={video.id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="truncate">{video.title}</span>
                                <Badge variant="outline">{viewsPerSubscriber.toFixed(2)}x</Badge>
                              </div>
                            ))}
                            <p className="text-xs text-muted-foreground">
                              {t("research:analytics.usesRounded")}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <div className="space-y-5">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          {t("research:analytics.publicationRecency")}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">{t("research:analytics.freshnessNote")}</p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {analytics.recencyData.map((item, index) => {
                          const percentage = analytics.totalVideos > 0
                            ? Math.round((item.value / analytics.totalVideos) * 100)
                            : 0;
                          return (
                            <div key={item.name} className="space-y-1.5">
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <span>{ideaLabel(t, RECENCY_KEYS, item.name)}</span>
                                <span className="text-muted-foreground">{item.value} <span className="text-xs">({percentage}%)</span></span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-muted/70">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${percentage}%`, backgroundColor: BAR_COLORS[(index + 1) % BAR_COLORS.length] }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Database className="h-4 w-4" />
                          {t("research:analytics.dataCoverage")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-x-4 gap-y-3 2xl:grid-cols-2">
                        {[
                          [t("research:analytics.views"), analytics.coverage.views],
                          [t("research:analytics.completeEngagement"), analytics.coverage.engagement],
                          [t("research:analytics.publicSubscribers"), analytics.coverage.subscribers],
                          [t("research:analytics.publicTags"), analytics.coverage.tags],
                          [t("research:analytics.captionsAvailable"), analytics.coverage.captions],
                          [t("research:analytics.hdDefinition"), analytics.coverage.hd],
                        ].map(([label, count]) => {
                          const numericCount = Number(count);
                          const percentage = analytics.totalVideos > 0
                            ? Math.round((numericCount / analytics.totalVideos) * 100)
                            : 0;
                          return (
                            <div key={String(label)} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span>{label}</span>
                                <span className="text-muted-foreground">{numericCount}/{analytics.totalVideos}</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-success" style={{ width: `${percentage}%` }} />
                              </div>
                            </div>
                          );
                        })}
                        <p className="text-xs text-muted-foreground 2xl:col-span-2">
                          {t("research:analytics.unavailableExcluded")}
                        </p>
                      </CardContent>
                    </Card>
                    </div>
                  </div>

                  <div>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Hash className="h-4 w-4" />
                          {t("research:analytics.recurringTags")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {analytics.topTags.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {analytics.topTags.map((tag) => (
                              <Badge key={tag.label} variant="secondary">
                                {tag.label} <span className="ms-1 text-muted-foreground">{tag.count}</span>
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{t("research:analytics.noTags")}</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </section>
              )}

              <section className="scroll-mt-40 space-y-4 border-t border-border/70 pt-7" aria-labelledby="research-videos-heading">
                <div>
                  <h2 id="research-videos-heading" className="text-lg font-semibold flex items-center gap-2">
                    <VideoIcon className="h-5 w-5" />
                    {t("research:analytics.videoCount", { count: displayedVideos.length })}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("research:analytics.sourceSubtitle")}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {displayedVideos.map((video) => (
                    <VideoCard
                      key={video.id}
                      video={video}
                      onClick={handleVideoClick}
                    />
                  ))}
                </div>
              </section>

              <section className="scroll-mt-40 space-y-4 border-t border-border/70 pt-7" aria-labelledby="research-insights-heading">
                <div>
                  <h2 id="research-insights-heading" className="text-lg font-semibold flex items-center gap-2">
                    <Lightbulb className="h-5 w-5" />
                    {t("research:analytics.aiInsights")}
                    {insightsLoading && (
                      <Badge variant="secondary" className="ms-2 ai-insights-glow">
                        <Loader2 className="h-3 w-3 animate-spin me-1" />
                        {t("research:insights.generatingBadge")}
                      </Badge>
                    )}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("research:analytics.aiInsightsSub")}
                  </p>
                </div>

                {insightsLoading ? (
                  <InsightsSkeleton />
                ) : insights ? (
                  <div className="space-y-6">
                    <Card className="border-info-subtle bg-info-subtle">
                      <CardContent className="p-5">
                        <div className="flex items-start gap-3">
                          <Sparkles className="mt-0.5 h-5 w-5 text-info" />
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{t("research:insights.strategicReadout")}</h3>
                              <Badge variant="outline">{t("research:insights.aiInference")}</Badge>
                              {insights.methodology?.sampleSize !== undefined && (
                                <Badge variant="secondary">{t("research:insights.sampleSizeCount", { count: insights.methodology.sampleSize })}</Badge>
                              )}
                            </div>
                            <p className="text-sm leading-relaxed">
                              {insights.summary || t("research:insights.summaryFallback")}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("research:insights.aiInsightsOverviewAria")}>
                      {[
                        { label: t("research:insights.questions"), value: insights.peopleAlsoAsk?.length || 0, icon: HelpCircle, color: "text-info bg-info-subtle" },
                        { label: t("research:insights.opportunities"), value: insights.contentGaps?.length || 0, icon: Lightbulb, color: "text-warning bg-warning-subtle" },
                        { label: t("research:insights.themes"), value: insights.trendingSubtopics?.length || 0, icon: TrendingUp, color: "text-success bg-success-subtle" },
                        { label: t("research:insights.nextMoves"), value: insights.recommendedActions?.length || 0, icon: ListChecks, color: "text-primary bg-primary/10" },
                      ].map(({ label, value, icon: Icon, color }) => (
                        <div key={label} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-4">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${color}`}>
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div>
                            <p className="text-2xl font-semibold tabular-nums">{value}</p>
                            <p className="text-xs text-muted-foreground">{label}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {insights.queryIntent && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Compass className="h-4 w-4 text-info" />
                            {t("research:insights.researchLens")}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {t("research:insights.researchLensSub")}
                          </p>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          {[
                            [t("research:insights.primaryIntent"), insights.queryIntent.primaryIntent],
                            [t("research:insights.viewerNeed"), insights.queryIntent.viewerNeed],
                            [t("research:insights.likelySurface"), insights.queryIntent.discoverySurface],
                            [t("research:insights.credibility"), insights.queryIntent.credibilityNote],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-lg border border-border/70 bg-muted/15 p-4">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                              <p className="mt-2 text-sm leading-relaxed">{value}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}

                    {insights.evidenceSignals && (
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Activity className="h-4 w-4 text-info" aria-hidden="true" />
                            {t("research:insights.evidenceBalance")}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">{t("research:insights.evidenceBalanceSub")}</p>
                        </CardHeader>
                        <CardContent className="grid gap-3 lg:grid-cols-3">
                        {[
                          {
                            title: t("research:insights.observed"),
                            description: t("research:insights.observedDesc"),
                            items: insights.evidenceSignals.observed,
                            icon: CheckCircle2,
                            color: "border-success-subtle bg-success-subtle",
                            accent: "bg-success",
                            text: "text-success",
                          },
                          {
                            title: t("research:insights.inferred"),
                            description: t("research:insights.inferredDesc"),
                            items: insights.evidenceSignals.inferred,
                            icon: Lightbulb,
                            color: "border-warning-subtle bg-warning-subtle",
                            accent: "bg-warning",
                            text: "text-warning",
                          },
                          {
                            title: t("research:insights.requiresStudio"),
                            description: t("research:insights.requiresStudioDesc"),
                            items: insights.evidenceSignals.requiresStudio,
                            icon: FlaskConical,
                            color: "border-info-subtle bg-info-subtle",
                            accent: "bg-info",
                            text: "text-info",
                          },
                        ].map(({ title, description, items, icon: Icon, color, accent, text }) => (
                          <div key={title} className={`rounded-xl border p-4 ${color}`}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <span className={`flex h-9 w-9 items-center justify-center rounded-full bg-background/70 ${text}`}>
                                  <Icon className="h-4 w-4" aria-hidden="true" />
                                </span>
                                <div>
                                  <p className="font-semibold">{title}</p>
                                  <p className="text-xs text-muted-foreground">{description}</p>
                                </div>
                              </div>
                              <span className={`text-3xl font-semibold tabular-nums ${text}`}>{items?.length || 0}</span>
                            </div>
                            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background/70" aria-hidden="true">
                              <div
                                className={`h-full rounded-full ${accent}`}
                                style={{ width: `${Math.max(12, Math.min(100, (items?.length || 0) * 24))}%` }}
                              />
                            </div>
                            <details className="mt-3 text-sm text-foreground">
                              <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">{t("research:insights.hideDetails")}</summary>
                              <ul className="mt-3 space-y-2">
                                {items?.map((item, index) => (
                                  <li key={index} className="flex items-start gap-2">
                                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${accent}`} aria-hidden="true" />
                                    <span>{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          </div>
                        ))}
                        </CardContent>
                      </Card>
                    )}

                    {insights.evidenceClaims && insights.evidenceClaims.length > 0 && (
                      <Collapsible open={evidenceLedgerOpen} onOpenChange={setEvidenceLedgerOpen}>
                        <Card>
                          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                            <div>
                              <CardTitle className="flex items-center gap-2 text-base">
                                <Database className="h-4 w-4" aria-hidden="true" />
                                {t("research:insights.evidenceLedger")}
                                <Badge variant="secondary">{t("research:insights.claimsCount", { count: insights.evidenceClaims.length })}</Badge>
                              </CardTitle>
                              <p className="mt-1 text-xs text-muted-foreground">{t("research:insights.ledgerSubtitle")}</p>
                            </div>
                            <CollapsibleTrigger asChild>
                              <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2">
                                {evidenceLedgerOpen ? t("research:insights.hideDetails") : t("research:insights.viewEvidence")}
                                {evidenceLedgerOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>
                          </CardHeader>
                          <CollapsibleContent>
                            <CardContent className="space-y-3 border-t border-border/70 pt-5">
                          {insights.evidenceClaims.map((claim) => (
                            <article key={claim.id} className="rounded-lg border border-border/70 bg-muted/10 p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{evidenceClassLabel(claim.evidenceClass)}</Badge>
                                <Badge variant="secondary">{t("research:insights.confidence", { level: claim.confidence })}</Badge>
                                <span className="font-mono text-[11px] text-muted-foreground">{claim.id}</span>
                              </div>
                              <p className="mt-3 text-sm leading-relaxed">{claim.claim}</p>
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                {claim.sourceVideoIds.length > 0 ? (
                                  claim.sourceVideoIds.map((videoId) => {
                                    const sourceVideo = sourceData?.videos.find((video) => video.id === videoId);
                                    return (
                                      <a
                                        key={videoId}
                                        href={`https://www.youtube.com/watch?v=${videoId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="rounded-full border border-info-subtle bg-info-subtle px-2.5 py-1 text-info hover:underline"
                                      >
                                        {sourceVideo?.title || videoId}
                                      </a>
                                    );
                                  })
                                ) : (
                                  <span className="rounded-full border border-warning-subtle bg-warning-subtle px-2.5 py-1 text-warning">
                                    {t("research:insights.aggregateInference", { id: claim.snapshotId.slice(0, 10) })}
                                  </span>
                                )}
                              </div>
                              <p className="mt-3 text-xs text-muted-foreground">
                                {t("research:insights.limitation", { text: claim.limitations.join(" ") })}
                              </p>
                            </article>
                          ))}
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    )}

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <HelpCircle className="h-4 w-4" />
                          {t("research:insights.audienceQuestions")}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {t("research:insights.audienceQuestionsSub")}
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {insights.peopleAlsoAsk?.map((item, index) => (
                          <Collapsible
                            key={index}
                            open={expandedQuestions.has(index)}
                            onOpenChange={() => toggleQuestion(index)}
                          >
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                className="w-full justify-between text-left h-auto py-3 px-4"
                                data-testid={`button-question-${index}`}
                              >
                                <span className="font-medium">{item.question}</span>
                                {expandedQuestions.has(index) ? (
                                  <ChevronUp className="h-4 w-4 shrink-0" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 shrink-0" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="px-4 pb-3">
                              <p className="text-sm text-muted-foreground">{item.answer}</p>
                            </CollapsibleContent>
                          </Collapsible>
                        ))}
                      </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Target className="h-4 w-4" />
                            {t("research:insights.likelyAudience")}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">{t("research:insights.likelyAudienceSub")}</p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-1">{t("research:insights.primaryDemographic")}</p>
                            <p className="text-sm">{insights.targetAudience?.primaryDemographic}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-1">{t("research:insights.ageRange")}</p>
                            <Badge variant="secondary">{insights.targetAudience?.ageRange}</Badge>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-2">{t("research:insights.interests")}</p>
                            <div className="flex flex-wrap gap-2">
                              {insights.targetAudience?.interests?.map((interest, i) => (
                                <Badge key={i} variant="outline">{interest}</Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-2">{t("research:insights.painPoints")}</p>
                            <ul className="text-sm space-y-1">
                              {insights.targetAudience?.painPoints?.map((point, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-warning">•</span>
                                  {point}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" />
                            {t("research:insights.nicheAnalysis")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-sm font-medium text-muted-foreground mb-1">{t("research:insights.competitionSignal")}</p>
                              <Badge
                                variant="outline"
                                className={/high|بالا|زیاد|قوی/i.test(insights.nicheAnalysis?.competitionLevel || "")
                                  ? "border-warning-subtle bg-warning-subtle text-warning"
                                  : "border-info-subtle bg-info-subtle text-info"}
                              >
                                {scaleKeyword(insights.nicheAnalysis?.competitionLevel || "")}
                              </Badge>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-muted-foreground mb-1">{t("research:insights.freshnessSignal")}</p>
                              <Badge variant="outline" className="border-success-subtle bg-success-subtle text-success">
                                {scaleKeyword(insights.nicheAnalysis?.growthTrend || "")}
                              </Badge>
                            </div>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-2">{t("research:insights.observedCadence")}</p>
                            <div className="flex flex-wrap gap-2">
                              {insights.nicheAnalysis?.bestPostingTimes?.map((time, i) => (
                                <Badge key={i} variant="outline">{ideaLabel(t, CADENCE_FALLBACK_KEYS, time)}</Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-2">{t("research:insights.recommendedFormats")}</p>
                            <ul className="text-sm space-y-1">
                              {insights.nicheAnalysis?.recommendedFormats?.map((format, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-info">•</span>
                                  {format}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-1">{t("research:insights.monetization")}</p>
                            <p className="text-sm">{insights.nicheAnalysis?.monetizationPotential}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Lightbulb className="h-4 w-4" />
                            {t("research:insights.opportunityHypotheses")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-2">
                            {insights.contentGaps?.map((gap, i) => (
                              <li key={i} className="rounded-lg border border-border/70 bg-muted/10 px-3 py-2 text-sm">
                                <details>
                                  <summary className="cursor-pointer select-none font-medium">
                                    <span className="me-2 text-info">{i + 1}.</span>
                                    {scanLabel(gap, t("research:insights.opportunityFallback", { index: i + 1 }))}
                                  </summary>
                                  <p className="mt-2 ps-6 leading-relaxed text-muted-foreground">{gap}</p>
                                </details>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" />
                            {t("research:insights.recurringSubtopics")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap gap-2">
                            {insights.trendingSubtopics?.map((topic, i) => (
                              <Badge key={i} variant="secondary" className="text-sm">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {insights.recommendedActions && insights.recommendedActions.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <ListChecks className="h-4 w-4" />
                            {t("research:insights.recommendedNextMoves")}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {t("research:insights.nextMovesSub")}
                          </p>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-4 md:grid-cols-3">
                            {insights.recommendedActions.map((action, index) => (
                              <div key={`${action.title}-${index}`} className="relative rounded-lg border border-border p-4">
                                <div className="mb-3 flex items-center justify-between gap-2">
                                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-info-subtle text-sm font-bold text-info">
                                    {index + 1}
                                  </span>
                                  <Badge variant="outline">{action.format}</Badge>
                                </div>
                                <h4 className="font-semibold">{action.title}</h4>
                                <details className="mt-3 rounded-lg bg-muted/25 px-3 py-2">
                                  <summary className="cursor-pointer select-none text-xs font-medium text-info">{t("research:insights.whyThisMove")}</summary>
                                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{action.rationale}</p>
                                </details>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {insights.methodology && (
                      <Collapsible open={methodologyOpen} onOpenChange={setMethodologyOpen}>
                        <Card className="bg-muted/20">
                          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                            <div>
                              <CardTitle className="flex items-center gap-2 text-base">
                                <Database className="h-4 w-4" />
                                {t("research:insights.evidenceAndLimits")}
                              </CardTitle>
                              <p className="mt-1 text-xs text-muted-foreground">{t("research:insights.methodSubtitle")}</p>
                            </div>
                            <CollapsibleTrigger asChild>
                              <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-2">
                                {methodologyOpen ? t("research:insights.hide") : t("research:insights.reviewLimits")}
                                {methodologyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>
                          </CardHeader>
                          <CollapsibleContent>
                            <CardContent className="grid gap-4 border-t border-border/70 pt-5 md:grid-cols-[1fr_2fr]">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("research:insights.basis")}</p>
                            <p className="mt-1 text-sm">{insights.methodology.basis}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("research:insights.limitations")}</p>
                            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                              {insights.methodology.limitations.map((limitation, index) => (
                                <li key={index} className="flex gap-2">
                                  <span className="text-warning">•</span>
                                  <span>{limitation}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    )}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Lightbulb className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="font-semibold mb-2">
                        {insightsError ? aiErrorTitle(t, insightsErrorCategory) : t("research:insights.insightsReady")}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        {insightsError || t("research:insights.insightsReadySub")}
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {(insightsErrorCategory === "missing_key" || insightsErrorCategory === "invalid_key") && (
                          <Button variant="outline" onClick={() => setLocation("/settings")}>{t("research:errors.openSettings")}</Button>
                        )}
                        <Button
                          onClick={() => {
                            setInsightsError(null);
                            setInsightsErrorCategory(null);
                            void fetchInsights();
                          }}
                          disabled={insightsLoading}
                        >
                          {insightsLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin me-2" />
                          ) : (
                            <Lightbulb className="h-4 w-4 me-2" />
                          )}
                          {insightsError ? t("research:insights.retryInsights") : t("research:insights.generateInsights")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </section>

              <section
                id="ideas"
                className="scroll-mt-40 space-y-4 border-t border-border/70 pt-7"
                aria-labelledby="research-ideas-heading"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 id="research-ideas-heading" className="flex items-center gap-2 text-lg font-semibold">
                      <Sparkles className="h-5 w-5 text-info" aria-hidden="true" />
                      {t("research:ideas.heading")}
                      {ideasLoading && (
                        <Badge variant="secondary" role="status" aria-live="polite">
                          <Loader2 className="me-1 h-3 w-3 animate-spin" aria-hidden="true" />
                          {t("research:ideas.generating")}
                        </Badge>
                      )}
                    </h2>
                    <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                      {t("research:ideas.subtitle")}
                    </p>
                  </div>
                  {selectedIdea && (
                    <Button onClick={handleProceedToScript} className="gap-2" data-testid="button-proceed-script">
                      <PlayCircle className="h-4 w-4" aria-hidden="true" />
                      {t("research:ideas.proceedScript")}
                    </Button>
                  )}
                </div>

                {ideasLoading ? (
                  <IdeasSkeleton />
                ) : ideasError ? (
                  <Alert data-testid={`alert-ideas-${ideasErrorCategory || "unknown"}`}>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{t("research:ideas.unavailable")}</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>{ideasError}</p>
                      <div className="flex flex-wrap gap-2">
                        {(ideasErrorCategory === "missing_key" || ideasErrorCategory === "invalid_key") && (
                          <Button size="sm" variant="outline" onClick={() => setLocation("/settings")}>{t("research:errors.openSettings")}</Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setIdeasError(null);
                            setIdeasErrorCategory(null);
                            ideasFetchedRef.current = "";
                            void fetchIdeas();
                          }}
                        >
                          {t("research:ideas.retry")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleContinueWithoutAI}>
                          {t("research:insights.continuing")}
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : ideaPackages.length > 0 ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {ideaPackages.map((idea, index) => {
                        const isSelected = selectedIdea?.title === idea.title;
                        return (
                          <button
                            key={`${idea.title}-${index}`}
                            type="button"
                            onClick={() => handleSelectIdea(idea)}
                            aria-pressed={isSelected}
                            className={`rounded-xl border bg-card p-5 text-left text-card-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                              isSelected
                                ? "border-primary/60 bg-primary/5"
                                : "border-card-border hover:border-primary/35 hover:bg-muted/20"
                            }`}
                            data-testid={`button-grounded-idea-${index}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("research:ideas.ideaNumber", { index: index + 1 })}</p>
                                <h3 className="mt-1 font-semibold leading-snug">{idea.title}</h3>
                              </div>
                              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                                isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                              }`} aria-hidden="true">
                                {isSelected && <CheckCircle2 className="h-4 w-4" />}
                              </span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <Badge variant="outline">{ideaLabel(t, IDEA_FORMAT_KEYS, idea.format)}</Badge>
                              <Badge variant="secondary">{ideaLabel(t, SURFACE_KEYS, idea.discoverySurface)}</Badge>
                              <Badge variant="outline">{ideaLabel(t, IDEA_DIFFICULTY_KEYS, idea.difficulty)}</Badge>
                            </div>

                            <p className="mt-4 text-sm text-muted-foreground">{idea.description}</p>

                            <div className="mt-4 space-y-3 border-t border-border/70 pt-4 text-sm">
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-info">{t("research:ideas.honestPromise")}</p>
                                <p className="mt-1">{idea.honestPromise}</p>
                              </div>
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("research:ideas.payoff")}</p>
                                <p className="mt-1">{idea.payoff}</p>
                              </div>
                              <div className="flex items-start gap-2">
                                <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                                <p>{idea.thumbnailConcept}</p>
                              </div>
                              <div className="rounded-lg bg-info-subtle p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-info">{t("research:ideas.studioTest")}</p>
                                <p className="mt-1">{idea.studioMetric}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{idea.experimentRule}</p>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-1.5" aria-label={t("research:ideas.evidenceUsed")}>
                              {Array.from(new Set(idea.evidenceClaims.map((claim) => claim.evidenceClass))).map((evidenceClass) => (
                                <Badge key={evidenceClass} variant="outline" className="text-[11px]">
                                  {evidenceClassLabel(evidenceClass)}
                                </Badge>
                              ))}
                              <Badge variant="secondary" className="text-[11px]">
                                {t("research:ideas.sourceVideos", { count: new Set(idea.evidenceClaims.flatMap((claim) => claim.sourceVideoIds)).size })}
                              </Badge>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">
                          {selectedIdea ? t("research:ideas.selected", { title: selectedIdea.title }) : t("research:ideas.selectOne")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t("research:ideas.savedNote")}
                        </p>
                      </div>
                      <Button onClick={handleProceedToScript} disabled={!selectedIdea} className="shrink-0 gap-2">
                        {t("research:ideas.proceedScript")}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </>
                ) : insightsLoading ? (
                  <Card>
                    <CardContent className="py-10 text-center" role="status" aria-live="polite">
                      <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-info" aria-hidden="true" />
                      <p className="font-medium">{t("research:ideas.waitingValidation")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t("research:ideas.waitingSub")}</p>
                    </CardContent>
                  </Card>
                ) : !insights ? (
                  <Card>
                    <CardContent className="py-10 text-center">
                      <Lightbulb className="mx-auto mb-3 h-7 w-7 text-muted-foreground" aria-hidden="true" />
                      <p className="font-medium">{t("research:ideas.requireInsights")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t("research:ideas.requireSub")}</p>
                      {insightsError && (
                        <Button variant="outline" className="mt-4" onClick={handleContinueWithoutAI}>{t("research:insights.continuing")}</Button>
                      )}
                    </CardContent>
                  </Card>
                ) : null}
              </section>
            </div>
          ) : searchError ? null : hasSearched ? (
            <EmptyState
              icon={VideoIcon}
              title={t("research:emptyState.noVideos")}
              description={t("research:emptyState.noVideosSub", { query: submittedQuery })}
            />
          ) : (
            <EmptyState
              icon={Search}
              title={t("research:emptyState.startResearch")}
              description={t("research:emptyState.startSub")}
            />
          )}
        </div>

        <VideoDetailDialog
          video={selectedVideo}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </div>
    </ScrollArea>
  );
}
