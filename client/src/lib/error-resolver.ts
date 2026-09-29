import i18n from "./i18n";

export interface ResolvedError {
  title: string;
  suggestion: string;
}

const NAMESPACE = "errors";

function buildKey(ns: string, code: string, field: "title" | "suggestion"): string {
  return `${NAMESPACE}:${ns}.${code}.${field}`;
}

function hasKey(key: string, lng: string): boolean {
  try {
    return i18n.exists(key, { lng, ns: NAMESPACE });
  } catch {
    return false;
  }
}

function getTranslation(key: string, lng: string): string {
  return i18n.t(key, { lng, ns: NAMESPACE });
}

function tryResolveCode(code: string, lng: string): ResolvedError | null {
  const namespaces = ["youtube", "gemini", "custom", "validation"] as const;

  for (const ns of namespaces) {
    const titleKey = buildKey(ns, code, "title");
    if (hasKey(titleKey, lng)) {
      return {
        title: getTranslation(titleKey, lng),
        suggestion: getTranslation(buildKey(ns, code, "suggestion"), lng),
      };
    }
  }
  return null;
}

function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return typeof obj === "object" && obj !== null && key in obj;
}

function stringProperty(obj: unknown, key: string): string | undefined {
  return hasProperty(obj, key) && typeof obj[key] === "string" ? obj[key] as string : undefined;
}

function detectGenericCategory(error: unknown): "network" | "timeout" | "unauthorized" | null {
  if (error instanceof TypeError && error.message.includes("NetworkError")) return "network";
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof Response) {
    if (error.status === 401 || error.status === 403) return "unauthorized";
    if (error.status === 0) return "network";
  }
  const message = stringProperty(error, "message")?.toLowerCase() || "";
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) return "network";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("unauthorized") || message.includes("401") || message.includes("403")) return "unauthorized";
  return null;
}

export function resolveError(
  error: unknown,
  fallbackContext?: string,
  lng: string = i18n.language || "en"
): ResolvedError {
  const code =
    stringProperty(error, "code") ||
    stringProperty(hasProperty(error, "response") ? error.response : undefined, "code") ||
    (hasProperty(error, "response") && hasProperty(error.response, "data")
      ? stringProperty(error.response.data, "code")
      : undefined) ||
    (hasProperty(error, "response") && hasProperty(error.response, "data") && hasProperty(error.response.data, "error")
      ? stringProperty(error.response.data.error, "code")
      : undefined) ||
    (hasProperty(error, "error") ? stringProperty(error.error, "code") : undefined);

  if (code && typeof code === "string") {
    const resolved = tryResolveCode(code, lng);
    if (resolved) return resolved;
  }

  const genericCategory = detectGenericCategory(error);
  if (genericCategory) {
    return {
      title: getTranslation(`${NAMESPACE}:generic.${genericCategory}`, lng),
      suggestion: getTranslation(`${NAMESPACE}:generic.description`, lng),
    };
  }

  const fallbackTitle = fallbackContext
    ? `${fallbackContext} error`
    : getTranslation(`${NAMESPACE}:generic.title`, lng);

  const message =
    stringProperty(error, "message") ||
    (hasProperty(error, "response") && hasProperty(error.response, "data")
      ? stringProperty(error.response.data, "message")
      : undefined) ||
    (hasProperty(error, "error") ? stringProperty(error.error, "message") : undefined);

  // WHY: Client-generated RequestFailure objects (localFailure in thumbnail.tsx) already carry a
  // pre-localized "error" title and "suggestion" description, but their "code" is not always present
  // in errors.json. Surface those fields directly instead of the generic text so the real failure
  // (e.g. the Pollinations HTTP detail) is visible to the user instead of "unexpected error".
  const localTitle = stringProperty(error, "error");
  const localSuggestion = stringProperty(error, "suggestion");

  return {
    title: localTitle || fallbackTitle,
    suggestion: localSuggestion || message || getTranslation(`${NAMESPACE}:generic.description`, lng),
  };
}