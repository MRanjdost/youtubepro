import type { Video } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, Calendar, ThumbsUp, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate, formatViews, formatDuration } from "@/lib/formatter";

interface VideoCardProps {
  video: Video;
  onClick?: (video: Video) => void;
}

export function VideoCard({ video, onClick }: VideoCardProps) {
  const { t } = useTranslation(["research", "common"]);
  const isInteractive = Boolean(onClick);
  const openVideo = () => onClick?.(video);

  return (
    <Card
      className={`group overflow-hidden border-card-border bg-card transition-colors duration-300 ${
        isInteractive
          ? "cursor-pointer hover:border-primary/50 hover-elevate focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          : ""
      }`}
      onClick={isInteractive ? openVideo : undefined}
      onKeyDown={isInteractive ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openVideo();
        }
      } : undefined}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? t("videoCard.openDetails", { title: video.title }) : undefined}
      data-testid={`card-video-${video.id}`}
    >
      <div className="relative aspect-video bg-muted overflow-hidden">
        <img
          src={video.thumbnailUrl}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {video.duration && (
          <Badge
            variant="secondary"
            className="absolute bottom-2 end-2 bg-black/80 text-white text-xs font-mono"
          >
            {formatDuration(video.duration)}
          </Badge>
        )}
      </div>

      <div className="p-4 space-y-3">
        <h3
          className="font-semibold text-base leading-tight line-clamp-2 text-card-foreground group-hover:text-primary transition-colors"
          data-testid={`text-video-title-${video.id}`}
        >
          {video.title}
        </h3>

        <p
          className="text-sm text-muted-foreground line-clamp-1"
          data-testid={`text-video-channel-${video.id}`}
        >
          {video.channelTitle}
        </p>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span data-testid={`text-video-views-${video.id}`}>
              {video.viewCount === undefined || video.viewCount === null
                ? t("common:na")
                : t("videoCard.views", { count: formatViews(video.viewCount) })}
            </span>
          </span>

          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{formatDate(video.publishedAt, "yyyy-MM-dd")}</span>
          </span>
        </div>

        {(video.likeCount !== undefined || video.commentCount !== undefined) && (
          <div className="flex items-center gap-4 pt-2 border-t border-border text-xs text-muted-foreground">
            {video.likeCount !== undefined && (
              <span className="flex items-center gap-1">
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                {formatViews(video.likeCount)}
              </span>
            )}
            {video.commentCount !== undefined && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {formatViews(video.commentCount)}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
