import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning">
              <AlertCircle className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("common:notFound.badge")}</p>
              <h1 className="text-2xl font-bold text-foreground">{t("common:notFound.title")}</h1>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("common:notFound.description")}
          </p>

          <Button asChild>
            <Link href="/">
              <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
              {t("common:notFound.backToHome")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
