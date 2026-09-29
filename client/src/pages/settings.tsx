import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveError } from "@/lib/error-resolver";
import { ExternalLink, Eye, EyeOff, KeyRound, Loader2, RotateCcw, Save, ShieldCheck, Globe, Wifi, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ModelOption {
  id: string;
  label: string;
  description: string;
}

interface ApiKeyStatus {
  youtube: boolean;
  gemini: boolean;
  customTextProvider?: string;
  customTextBaseUrl?: string;
  customTextApiKey?: boolean;
  customTextModel?: string;
  customImageProvider?: string;
  customImageBaseUrl?: string;
  customImageApiKey?: boolean;
  customImageModel?: string;
  httpsProxy?: string;
  hasProxy?: boolean;
  models: {
    text: string;
    image: string;
    textOptions: ModelOption[];
    imageOptions: ModelOption[];
  };
}

interface KeyFieldProps {
  id: string;
  label: string;
  description: string;
  configured: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  providerUrl: string;
  providerLabel: string;
  children?: ReactNode;
}

function KeyField({
  id,
  label,
  description,
  configured,
  inputRef,
  providerUrl,
  providerLabel,
  children,
}: KeyFieldProps) {
  const { t } = useTranslation("settings");
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label htmlFor={id} className="text-base">{label}</Label>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge
          variant="outline"
          className={configured
            ? "border-green-500/40 bg-green-500/10 text-green-500"
            : "text-muted-foreground"}
        >
          {configured ? t("sections.gemini.configured") : t("sections.gemini.notConfigured")}
        </Badge>
      </div>

      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          name={id}
          type={showKey ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder={configured ? t("sections.gemini.configured") : (id === "youtube-api-key" ? t("sections.gemini.youtubeKeyPlaceholder") : t("sections.gemini.geminiKeyPlaceholder"))}
          className="pe-11 font-mono"
          data-testid={`input-${id}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute end-0 top-0"
          onClick={() => setShowKey((visible) => !visible)}
          aria-label={showKey ? `Hide ${label}` : `Show ${label}`}
        >
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>

      {children}

      <a
        href={providerUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        {providerLabel}
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

interface ProviderConfigSectionProps {
  title: string;
  description: string;
  initialProvider?: string;
  initialBaseUrl?: string;
  initialApiKey: boolean;
  initialModel?: string;
  apiKeyInputId: string;
  providerTestId: string;
  baseUrlTestId: string;
  apiKeyTestId: string;
  modelTestId: string;
  resetTestId: string;
  apiKeyPlaceholder: string;
  modelPlaceholder: string;
  // WHY: only the image provider section offers Pollinations (free, no key); the text
  // section must not show it, so it stays an opt-in prop rather than a global option.
  supportPollinations?: boolean;
  onReset: () => void;
  onChange: (state: {
    provider: string | null;
    baseUrl: string | null;
    apiKey: string | null;
    model: string | null;
  }) => void;
}

function ProviderConfigSection({
  title,
  description,
  initialProvider,
  initialBaseUrl,
  initialApiKey,
  initialModel,
  apiKeyInputId,
  providerTestId,
  baseUrlTestId,
  apiKeyTestId,
  modelTestId,
  resetTestId,
  apiKeyPlaceholder,
  modelPlaceholder,
  supportPollinations,
  onReset,
  onChange,
}: ProviderConfigSectionProps) {
  const { t } = useTranslation("settings");
  // WHY: gemini and openai-compatible are the two default choices; pollinations is offered only
  // where the caller opts in (the image section), and only when it was already saved as the provider.
  const baseProvider = initialProvider === "openai-compatible"
    ? "openai-compatible"
    : supportPollinations && initialProvider === "pollinations"
      ? "pollinations"
      : "gemini";
  const [provider, setProvider] = useState<"gemini" | "openai-compatible" | "pollinations">(baseProvider);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl ?? "");
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(initialModel ?? "");

  useEffect(() => {
    setProvider(baseProvider);
    setBaseUrl(initialBaseUrl ?? "");
    setModel(initialModel ?? "");
  }, [baseProvider, initialBaseUrl, initialModel]);

  const emitChange = (
    nextProvider: "gemini" | "openai-compatible" | "pollinations",
    nextBaseUrl: string,
    nextApiKey: string,
    nextModel: string,
  ) => {
    onChange({
      provider: nextProvider !== initialProvider ? nextProvider : null,
      baseUrl: nextBaseUrl !== (initialBaseUrl ?? "") ? nextBaseUrl : null,
      apiKey: nextApiKey || null,
      model: nextModel !== (initialModel ?? "") ? nextModel : null,
    });
  };

  // WHY: pollinations counts as a custom (non-Gemini) provider, so it shows the active badge and
  // the reset button, but it needs no base URL, API key, or model inputs of its own.
  const isCustom = provider === "openai-compatible" || provider === "pollinations";

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/50 p-4" data-testid={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-medium">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={isCustom
              ? "border-green-500/40 bg-green-500/10 text-green-500"
              : "text-muted-foreground"}
          >
            {isCustom ? t("settings:sections.customText.providerActive") : t("sections.gemini.title")}
          </Badge>
          {isCustom && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReset}
              data-testid={resetTestId}
            >
              <RotateCcw className="me-1.5 h-3.5 w-3.5" />
              {t("sections.customText.resetButton")}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${title}-provider`}>{t("sections.customText.provider")}</Label>
        <Select
          value={provider}
          onValueChange={(value) => {
            const next = value as "gemini" | "openai-compatible" | "pollinations";
            setProvider(next);
            emitChange(next, baseUrl, apiKeyRef.current?.value || "", model);
          }}
        >
          <SelectTrigger id={`${title}-provider`} data-testid={providerTestId}>
            <SelectValue placeholder={t("sections.customText.chooseProvider")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gemini">{t("sections.gemini.title")}</SelectItem>
            {supportPollinations && (
              <SelectItem value="pollinations">{t("fields.customImageProviderPollinations")}</SelectItem>
            )}
            <SelectItem value="openai-compatible">OpenAI-compatible (OpenRouter, custom endpoint)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {isCustom
            ? provider === "pollinations"
              ? t("settings:sections.customImage.pollinationsHint")
              : t("settings:sections.customText.overrideHint")
            : t("settings:sections.customText.geminiHint")}
        </p>
      </div>

      {/* WHY: only openai-compatible has base-url/API-key/model inputs; pollinations is keyless. */}
      {provider === "openai-compatible" && (
        <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={apiKeyInputId}>Custom {title} API key</Label>
            <div className="relative">
              <Input
                ref={apiKeyRef}
                id={apiKeyInputId}
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder={apiKeyPlaceholder}
                className="pe-11 font-mono"
                data-testid={apiKeyTestId}
                onChange={(event) =>
                  emitChange(provider, baseUrl, event.target.value, model)
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute end-0 top-0"
                onClick={() => setShowKey((visible) => !visible)}
                aria-label={showKey ? `Hide ${title} API key` : `Show ${title} API key`}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {initialApiKey
                ? "A key is already configured. Leave blank to keep the current value."
                : "Enter an API key for the custom provider."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${title}-base-url`}>{t("sections.customText.baseUrl")}</Label>
            <Input
              id={`${title}-base-url`}
              type="url"
              autoComplete="off"
              placeholder="https://openrouter.ai/api/v1"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                emitChange(provider, event.target.value, apiKeyRef.current?.value || "", model);
              }}
              data-testid={baseUrlTestId}
            />
            <p className="text-xs text-muted-foreground">
              OpenAI-compatible endpoint (e.g. OpenRouter, LiteLLM, or self-hosted).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${title}-model`}>{t("sections.customText.model")}</Label>
            <Input
              id={`${title}-model`}
              type="text"
              autoComplete="off"
              placeholder={modelPlaceholder}
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                emitChange(provider, baseUrl, apiKeyRef.current?.value || "", event.target.value);
              }}
              data-testid={modelTestId}
            />
            <p className="text-xs text-muted-foreground">
              {initialModel
                ? `Current model: ${initialModel}.`
                : "Free-text model identifier (e.g. anthropic/claude-3-5-sonnet)."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface ProviderDirty {
  provider: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

const EMPTY_DIRTY: ProviderDirty = { provider: null, baseUrl: null, apiKey: null, model: null };

export default function SettingsPage() {
  const { t } = useTranslation(["settings", "common"]);
  const [status, setStatus] = useState<ApiKeyStatus>({
    youtube: false,
    gemini: false,
    models: { text: "", image: "", textOptions: [], imageOptions: [] },
  });
  const [geminiTextModel, setGeminiTextModel] = useState("");
  const [geminiImageModel, setGeminiImageModel] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const youtubeKeyRef = useRef<HTMLInputElement>(null);
  const geminiKeyRef = useRef<HTMLInputElement>(null);
  const [textDirty, setTextDirty] = useState<ProviderDirty>(EMPTY_DIRTY);
  const [imageDirty, setImageDirty] = useState<ProviderDirty>(EMPTY_DIRTY);
  const [textResetRequested, setTextResetRequested] = useState(false);
  const [imageResetRequested, setImageResetRequested] = useState(false);
  const proxyUrlRef = useRef<HTMLInputElement>(null);
  const [proxyResetRequested, setProxyResetRequested] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const response = await fetch("/api/settings/status", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load settings.");
        const nextStatus = data as ApiKeyStatus;
        setStatus(nextStatus);
        setGeminiTextModel(nextStatus.models.text);
        setGeminiImageModel(nextStatus.models.image);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message || "Unable to load settings.");
      } finally {
        setIsLoading(false);
      }
    };

    loadStatus();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const youtubeApiKey = youtubeKeyRef.current?.value.trim() || "";
    const geminiApiKey = geminiKeyRef.current?.value.trim() || "";
    const modelsChanged = geminiTextModel !== status.models.text
      || geminiImageModel !== status.models.image;

    const hasTextChanges = textDirty.provider !== null
      || textDirty.baseUrl !== null
      || textDirty.apiKey !== null
      || textDirty.model !== null
      || textResetRequested;
    const hasImageChanges = imageDirty.provider !== null
      || imageDirty.baseUrl !== null
      || imageDirty.apiKey !== null
      || imageDirty.model !== null
      || imageResetRequested;

    if (!youtubeApiKey && !geminiApiKey && !modelsChanged && !hasTextChanges && !hasImageChanges && !proxyResetRequested && !(proxyUrlRef.current?.value.trim())) {
      toast({
        title: t("settings:messages.noChanges"),
        description: t("settings:messages.noChangesHint"),
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...(youtubeApiKey ? { youtubeApiKey } : {}),
        ...(geminiApiKey ? { geminiApiKey } : {}),
        geminiTextModel,
        geminiImageModel,
      };
      if (textResetRequested) {
        payload.resetCustomText = true;
      } else {
        if (textDirty.provider !== null) payload.customTextProvider = textDirty.provider;
        if (textDirty.baseUrl !== null) payload.customTextBaseUrl = textDirty.baseUrl;
        if (textDirty.apiKey !== null) payload.customTextApiKey = textDirty.apiKey;
        if (textDirty.model !== null) payload.customTextModel = textDirty.model;
      }
      if (imageResetRequested) {
        payload.resetCustomImage = true;
      } else {
        if (imageDirty.provider !== null) payload.customImageProvider = imageDirty.provider;
        if (imageDirty.baseUrl !== null) payload.customImageBaseUrl = imageDirty.baseUrl;
        if (imageDirty.apiKey !== null) payload.customImageApiKey = imageDirty.apiKey;
        if (imageDirty.model !== null) payload.customImageModel = imageDirty.model;
      }
      if (proxyResetRequested) {
        payload.resetProxy = true;
      } else {
        const proxyValue = proxyUrlRef.current?.value.trim() || "";
        if (proxyValue) payload.httpsProxy = proxyValue;
        else payload.resetProxy = true;
      }

      const response = await apiRequest("PUT", "/api/settings/api-keys", payload) as { success: boolean; status: ApiKeyStatus };

      setStatus(response.status);
      setGeminiTextModel(response.status.models.text);
      setGeminiImageModel(response.status.models.image);
      if (youtubeKeyRef.current) youtubeKeyRef.current.value = "";
      if (geminiKeyRef.current) geminiKeyRef.current.value = "";
      setTextDirty(EMPTY_DIRTY);
      setImageDirty(EMPTY_DIRTY);
      setTextResetRequested(false);
      setImageResetRequested(false);
      toast({
        title: t("settings:messages.saveSuccess"),
        description: "The local server is using the updated provider settings.",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const resolved = resolveError(error, t("settings:title"));
      toast({
        title: t("settings:messages.saveError"),
        description: resolved.suggestion || message || "Check the key and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6 md:p-8">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <KeyRound className="h-5 w-5" />
          <span className="text-sm font-medium">{t("settings:headerBadge")}</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold">{t("settings:title")}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {t("settings:subtitle")}
        </p>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{t("settings:storedLocally")}</AlertTitle>
        <AlertDescription>
          {t("settings:warning")}
        </AlertDescription>
      </Alert>

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>{t("settings:messages.settingsUnavailable")}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("settings:sections.gemini.title")}</CardTitle>
          <CardDescription>
            {t("settings:sections.gemini.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center text-muted-foreground">
              <Loader2 className="me-2 h-5 w-5 animate-spin" />
              {t("settings:messages.loading") || "Loading connection status"}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <KeyField
                id="youtube-api-key"
                label={t("settings:sections.gemini.youtubeKey")}
                description={t("settings:sections.gemini.description")}
                configured={status.youtube}
                inputRef={youtubeKeyRef}
                providerUrl="https://console.cloud.google.com/apis/credentials"
                providerLabel={t("settings:sections.gemini.openCloud")}
              />
              <KeyField
                id="gemini-api-key"
                label={t("settings:sections.gemini.geminiKey")}
                description={t("settings:sections.gemini.description")}
                configured={status.gemini}
                inputRef={geminiKeyRef}
                providerUrl="https://aistudio.google.com/apikey"
                providerLabel={t("settings:sections.gemini.openStudio")}
              >
                <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="gemini-text-model">{t("settings:sections.gemini.textModel")}</Label>
                    <Select value={geminiTextModel} onValueChange={setGeminiTextModel}>
                      <SelectTrigger id="gemini-text-model" data-testid="select-gemini-text-model">
                        <SelectValue placeholder={t("settings:messages.chooseModel")} />
                      </SelectTrigger>
                      <SelectContent>
                        {status.models.textOptions.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {status.models.textOptions.find((model) => model.id === geminiTextModel)?.description}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gemini-image-model">{t("settings:sections.gemini.imageModel")}</Label>
                    <Select value={geminiImageModel} onValueChange={setGeminiImageModel}>
                      <SelectTrigger id="gemini-image-model" data-testid="select-gemini-image-model">
                        <SelectValue placeholder={t("settings:messages.chooseModel")} />
                      </SelectTrigger>
                      <SelectContent>
                        {status.models.imageOptions.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {status.models.imageOptions.find((model) => model.id === geminiImageModel)?.description}
                    </p>
                  </div>
                </div>

                <a
                  href="https://ai.google.dev/gemini-api/docs/models"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  {t("settings:messages.geminiModelCatalog")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </KeyField>

              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">{t("settings:sections.customText.title")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("settings:sections.customText.description")}
                  </p>
                </div>

                <ProviderConfigSection
                  title={t("settings:sections.customText.title")}
                  description={t("settings:sections.customText.description")}
                  initialProvider={status.customTextProvider}
                  initialBaseUrl={status.customTextBaseUrl}
                  initialApiKey={status.customTextApiKey === true}
                  initialModel={status.customTextModel}
                  apiKeyInputId="custom-text-api-key"
                  providerTestId="select-custom-text-provider"
                  baseUrlTestId="input-custom-text-base-url"
                  apiKeyTestId="input-custom-text-api-key"
                  modelTestId="input-custom-text-model"
                  resetTestId="button-reset-custom-text"
                  apiKeyPlaceholder={t("settings:sections.customText.apiKeyPlaceholder")}
                  modelPlaceholder={t("settings:sections.customText.modelPlaceholder")}
                  onReset={() => {
                    setTextResetRequested(true);
                    setTextDirty(EMPTY_DIRTY);
                  }}
                  onChange={(next) => {
                    setTextResetRequested(false);
                    setTextDirty(next);
                  }}
                />

                <ProviderConfigSection
                  title={t("settings:sections.customImage.heading")}
                  description={t("settings:sections.customImage.subheading")}
                  initialProvider={status.customImageProvider}
                  initialBaseUrl={status.customImageBaseUrl}
                  initialApiKey={status.customImageApiKey === true}
                  initialModel={status.customImageModel}
                  apiKeyInputId="custom-image-api-key"
                  providerTestId="select-custom-image-provider"
                  baseUrlTestId="input-custom-image-base-url"
                  apiKeyTestId="input-custom-image-api-key"
                  modelTestId="input-custom-image-model"
                  resetTestId="button-reset-custom-image"
                  apiKeyPlaceholder="•••••••• (configured — overwrite to replace)"
                  modelPlaceholder="custom-image-model-v1"
                  supportPollinations
                  onReset={() => {
                    setImageResetRequested(true);
                    setImageDirty(EMPTY_DIRTY);
                  }}
                  onChange={(next) => {
                    setImageResetRequested(false);
                    setImageDirty(next);
                  }}
                />
              </div>

              <Card className="border-border/60 shadow-sm" data-testid="card-network-proxy">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                      <Globe className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle>{t("settings:sections.proxy.title")}</CardTitle>
                      <CardDescription>
                        {t("settings:sections.proxy.description")}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge
                      variant="outline"
                      className={status.hasProxy
                        ? "border-green-500/40 bg-green-500/10 text-green-500"
                        : "text-muted-foreground"}
                    >
                      {status.hasProxy ? (
                        <><Wifi className="me-1 h-3 w-3" /> {t("settings:sections.proxy.active")}</>
                      ) : (
                        <><WifiOff className="me-1 h-3 w-3" /> {t("settings:sections.proxy.direct")}</>
                      )}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {status.httpsProxy ? `Proxy: ${status.httpsProxy}` : t("settings:sections.proxy.noProxy")}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="proxy-url">{t("settings:sections.proxy.url")}</Label>
                    <div className="relative">
                      <Input
                        ref={proxyUrlRef}
                        id="proxy-url"
                        type="url"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="http://127.0.0.1:10809"
                        defaultValue={status.httpsProxy || ""}
                        className="font-mono"
                        data-testid="input-proxy-url"
                        onChange={() => setProxyResetRequested(false)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Example: <code>http://127.0.0.1:10809</code> or <code>http://proxy.company.net:8080</code>.
                      {t("settings:proxy.help")}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        setProxyResetRequested(false);
                        const payload: Record<string, unknown> = {};
                        const proxyValue = proxyUrlRef.current?.value.trim() || "";
                        if (proxyValue) payload.httpsProxy = proxyValue;
                        else payload.resetProxy = true;
                        // Submit through the same form mutation (re-use pending idea: wire via handleSubmit by adding proxy fields to payload)
                        // We'll dispatch through a direct mutation call here to keep it simple
                        (async () => {
                          try {
                            setIsSaving(true);
                            const response = await apiRequest("PUT", "/api/settings/api-keys", payload) as { success: boolean; status: ApiKeyStatus };
                            setStatus(response.status);
                            setProxyResetRequested(false);
                            if (proxyUrlRef.current) proxyUrlRef.current.value = response.status.httpsProxy || "";
                            toast({ title: t("settings:messages.proxySaved"), description: response.status.hasProxy ? t("settings:messages.proxySavedHint") : t("settings:messages.directRestored") });
                          } catch (error: unknown) {
                            const message = error instanceof Error ? error.message : String(error);
                            toast({ title: t("settings:messages.proxySaveError"), description: message, variant: "destructive" });
                          } finally {
                            setIsSaving(false);
                          }
                        })();
                      }}
                      data-testid="button-save-proxy"
                      disabled={isSaving}
                    >
                      <Save className="me-1.5 h-3.5 w-3.5" />
                      {t("settings:sections.proxy.saveButton")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setProxyResetRequested(true);
                        if (proxyUrlRef.current) proxyUrlRef.current.value = "";
                        (async () => {
                          try {
                            setIsSaving(true);
                            const response = await apiRequest("PUT", "/api/settings/api-keys", { resetProxy: true }) as { success: boolean; status: ApiKeyStatus };
                            setStatus(response.status);
                            if (proxyUrlRef.current) proxyUrlRef.current.value = "";
                            toast({ title: t("settings:messages.proxyReset"), description: t("settings:messages.proxyResetHint") });
                          } catch (error: unknown) {
                            const message = error instanceof Error ? error.message : String(error);
                            toast({ title: t("settings:messages.proxyResetError"), description: message, variant: "destructive" });
                          } finally {
                            setIsSaving(false);
                          }
                        })();
                      }}
                      data-testid="button-reset-proxy"
                      disabled={isSaving}
                    >
                      <WifiOff className="me-1.5 h-3.5 w-3.5" />
                      {t("settings:sections.proxy.resetButton")}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={isSaving || Boolean(loadError)} data-testid="button-save-api-settings">
                  {isSaving ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="me-2 h-4 w-4" />
                  )}
                  {t("settings:messages.saveAndApply")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
