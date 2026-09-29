import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "../locales/en/common.json";
import enSettings from "../locales/en/settings.json";
import enResearch from "../locales/en/research.json";
import enScript from "../locales/en/script.json";
import enThumbnail from "../locales/en/thumbnail.json";
import enIdeas from "../locales/en/ideas.json";
import enErrors from "../locales/en/errors.json";
import enControllerGuide from "../locales/en/controller-guide.json";

import faCommon from "../locales/fa/common.json";
import faSettings from "../locales/fa/settings.json";
import faResearch from "../locales/fa/research.json";
import faScript from "../locales/fa/script.json";
import faThumbnail from "../locales/fa/thumbnail.json";
import faIdeas from "../locales/fa/ideas.json";
import faErrors from "../locales/fa/errors.json";
import faControllerGuide from "../locales/fa/controller-guide.json";

function updateDocumentDirection(lang: string) {
  const lng = lang || "en";
  if (typeof document !== "undefined") {
    if (lng === "fa") {
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "fa";
    } else {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = lng;
    }
  }
  // Persist to localStorage for next visit
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("app-lang", lng);
    }
  } catch {
    // Ignore storage errors in private mode
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        research: enResearch,
        script: enScript,
        thumbnail: enThumbnail,
        ideas: enIdeas,
        errors: enErrors,
        "controller-guide": enControllerGuide,
      },
      fa: {
        common: faCommon,
        settings: faSettings,
        research: faResearch,
        script: faScript,
        thumbnail: faThumbnail,
        ideas: faIdeas,
        errors: faErrors,
        "controller-guide": faControllerGuide,
      },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "fa"],
    defaultNS: "common",
    ns: ["common", "settings", "research", "script", "thumbnail", "ideas", "errors", "controller-guide"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "app-lang",
    },
    react: { useSuspense: false },
  });

i18n.on("languageChanged", (lng) => {
  updateDocumentDirection(lng);
});

updateDocumentDirection(i18n.language || "en");

export default i18n;
