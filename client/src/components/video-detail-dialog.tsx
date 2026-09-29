import type { Video } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { formatViews, formatPercent, formatDate, formatDuration } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, ThumbsUp, MessageSquare, Calendar, Clock, ExternalLink, Tag } from "lucide-react";

interface VideoDetailDialogProps {
  video: Video | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VideoDetailDialog({ video, open, onOpenChange }: VideoDetailDialogProps) {
  const { t } = useTranslation("research");
  if (!video) return null;

  const youtubeUrl = `https://www.youtube.com/watch?v=${video.id}`;
  const channelUrl = `https://www.youtube.com/channel/${video.channelId}`;
  const engagementRate = video.viewCount && video.likeCount !== undefined && video.commentCount !== undefined
    ? ((video.likeCount + video.commentCount) / video.viewCount) * 100
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight pe-8" data-testid="text-dialog-title">
            {video.title}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6">
            <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
              <img
                src={video.thumbnailUrl}
                alt={video.title}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <a className="font-medium text-foreground hover:text-primary" href={channelUrl} target="_blank" rel="noopener noreferrer">
                    {video.channelTitle}
                  </a>
                  {video.channelStatistics?.subscriberCount !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      {t("videoDetail.subscribers", { count: formatViews(video.channelStatistics.subscriberCount) })}
                    </p>
                  )}
                </div>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="link-watch-youtube"
                  >
                    <ExternalLink className="h-4 w-4 me-2" aria-hidden="true" />
                    {t("videoDetail.watchOnYoutube")}
                  </a>
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="flex flex-col items-center p-3 rounded-lg bg-muted/50">
                  <Eye className="h-5 w-5 text-muted-foreground mb-1" aria-hidden="true" />
                  <span className="text-lg font-semibold">{formatViews(video.viewCount)}</span>
                  <span className="text-xs text-muted-foreground">{t("videoDetail.views")}</span>
                </div>
                <div className="flex flex-col items-center p-3 rounded-lg bg-muted/50">
                  <ThumbsUp className="h-5 w-5 text-muted-foreground mb-1" aria-hidden="true" />
                  <span className="text-lg font-semibold">{formatViews(video.likeCount)}</span>
                  <span className="text-xs text-muted-foreground">{t("videoDetail.likes")}</span>
                </div>
                <div className="flex flex-col items-center p-3 rounded-lg bg-muted/50">
                  <MessageSquare className="h-5 w-5 text-muted-foreground mb-1" aria-hidden="true" />
                  <span className="text-lg font-semibold">{formatViews(video.commentCount)}</span>
                  <span className="text-xs text-muted-foreground">{t("videoDetail.comments")}</span>
                </div>
                <div className="flex flex-col items-center p-3 rounded-lg bg-muted/50">
                  <Clock className="h-5 w-5 text-muted-foreground mb-1" aria-hidden="true" />
                  <span className="text-lg font-semibold">{formatDuration(video.duration) || t("common:na")}</span>
                  <span className="text-xs text-muted-foreground">{t("videoDetail.duration")}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                <span>{t("videoDetail.publishedOn", { date: formatDate(video.publishedAt, "yyyy-MM-dd") })}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {engagementRate !== null && (
                  <Badge variant="outline">{t("videoDetail.engagement", { rate: formatPercent(engagementRate / 100) })}</Badge>
                )}
                {video.definition && <Badge variant="secondary">{video.definition.toUpperCase()}</Badge>}
                {video.hasCaptions !== undefined && (
                  <Badge variant="secondary">{video.hasCaptions ? t("videoDetail.captions") : t("videoDetail.noCaptions")}</Badge>
                )}
                {(video.defaultAudioLanguage || video.defaultLanguage) && (
                  <Badge variant="secondary">{video.defaultAudioLanguage || video.defaultLanguage}</Badge>
                )}
                {video.hasPaidProductPlacement && (
                  <Badge variant="outline">{t("videoDetail.paidPromotion")}</Badge>
                )}
              </div>

              {video.description && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">{t("videoDetail.description")}</h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
                    {video.description}
                  </p>
                </div>
              )}

              {video.tags && video.tags.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <h4 className="font-medium text-sm">{t("videoDetail.tags")}</h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {video.tags.slice(0, 10).map((tag, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {video.tags.length > 10 && (
                      <Badge variant="outline" className="text-xs">
                        {t("videoDetail.moreTags", { count: video.tags.length - 10 })}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
