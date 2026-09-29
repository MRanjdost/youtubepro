import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import i18n from "@/lib/i18n";

type LanguageCode = "en" | "fa";

const LANGUAGE_CODES: LanguageCode[] = ["en", "fa"];

const SHORT_LABELS: Record<LanguageCode, string> = {
  en: "EN",
  fa: "فا",
};

export function LanguageSwitcher() {
  const { t, i18n: i18nInstance } = useTranslation("common");
  const current = i18nInstance.language || i18n.language || "en";
  const active: LanguageCode = LANGUAGE_CODES.includes(current as LanguageCode)
    ? (current as LanguageCode)
    : "en";

  const handleSelect = (code: string) => {
    if (code !== current) {
      i18n.changeLanguage(code);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-testid="button-language-switcher"
          aria-label={t("language.select")}
        >
          <Languages className="h-5 w-5" />
          <span className="sr-only">{t("language.select")}: {t(`language.${active}`)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {LANGUAGE_CODES.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => handleSelect(code)}
            data-testid={`menu-item-language-${code}`}
            className="flex items-center justify-between"
          >
            <span>{t(`language.${code}`)}</span>
            <span
              className={
                "text-xs " +
                (active === code
                  ? "font-semibold text-primary"
                  : "text-muted-foreground")
              }
            >
              {SHORT_LABELS[code]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
