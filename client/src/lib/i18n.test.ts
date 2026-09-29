import "./i18n.test-setup";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import i18n from "./i18n";

describe("i18n infrastructure", () => {
  before(async () => {
    // i18n.ts already calls init via side effects, but if not initialized
    // we ensure it here.
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  test("i18n.instance is initialized", () => {
    assert.ok(i18n.isInitialized, "i18n should be initialized");
  });

  test("i18n.language is defined", () => {
    assert.ok(i18n.language, "i18n.language should be defined");
  });

  test("en common.app.name resolves correctly", () => {
    assert.equal(i18n.t("app.name", { lng: "en", ns: "common" }), "YouTube Pro");
  });
  test("fa common.app.name resolves correctly", () => {
    assert.equal(i18n.t("app.name", { lng: "fa", ns: "common" }), "یوتیوب پرو");
  });

  test("changeLanguage to fa updates language", async () => {
    await i18n.changeLanguage("fa");
    assert.equal(i18n.language, "fa");
  });

  test("changeLanguage back to en updates language", async () => {
    await i18n.changeLanguage("en");
    assert.equal(i18n.language, "en");
  });

  test("document direction is rtl for fa", async () => {
    await i18n.changeLanguage("fa");
    assert.equal((globalThis.document as any).documentElement.dir, "rtl");
    assert.equal((globalThis.document as any).documentElement.lang, "fa");
  });

  test("document direction is ltr for en", async () => {
    await i18n.changeLanguage("en");
    assert.equal((globalThis.document as any).documentElement.dir, "ltr");
    assert.equal((globalThis.document as any).documentElement.lang, "en");
  });

  const navKeys = [
    "nav.research",
    "nav.ideas",
    "nav.script",
    "nav.thumbnail",
    "nav.settings",
    "nav.navigation",
    "nav.workflows",
    "nav.tools",
    "nav.recentWorkflows",
  ];

  describe("settings keys resolve in both en and fa", () => {
    const settingsSections = [
      "settings:sections.gemini.title",
      "settings:sections.gemini.youtubeKey",
      "settings:sections.customText.title",
      "settings:sections.customImage.title",
      "settings:sections.proxy.title",
      "settings:messages.saveSuccess",
    ];
    for (const key of settingsSections) {
      test(`${key} en non-empty`, () => {
        const v = i18n.t(key, { lng: "en", ns: "settings" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
      test(`${key} fa non-empty`, () => {
        const v = i18n.t(key, { lng: "fa", ns: "settings" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
    }
  });

  describe("research namespace resolves in both en and fa", () => {
    const researchKeys = [
      "search:label",
      "analytics:overview",
      "insights:heading",
      "emptyState:startResearch",
    ];
    for (const key of researchKeys) {
      test(`en ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "en", ns: "research" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
      test(`fa ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "fa", ns: "research" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
    }
  });

  describe("script namespace resolves in both en and fa", () => {
    const scriptKeys = [
      "script:title",
      "script:subtitle",
      "script:form.topic",
      "script:form.generate",
      "script:emptyState.title",
      "script:teleprompter.play",
      "script:errors.quota",
    ];
    for (const key of scriptKeys) {
      test(`en ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "en", ns: "script" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
      test(`fa ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "fa", ns: "script" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
    }
  });

  describe("ideas namespace resolves in both en and fa", () => {
    const ideasKeys = [
      "ideas:heading",
      "ideas:subtitle",
      "ideas:honestPromise",
    ];
    for (const key of ideasKeys) {
      test(`en ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "en", ns: "ideas" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
      test(`fa ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "fa", ns: "ideas" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
    }
  });

  describe("thumbnail namespace resolves in both en and fa", () => {
    const thumbnailKeys = [
      "title",
      "subtitle",
      "form:topicLabel",
      "form:topicPlaceholder",
      "form:presetLabel",
      "form:presetCustom",
      "form:mainTextLabel",
      "form:mainTextPlaceholder",
      "form:descriptionLabel",
      "form:descriptionPlaceholder",
      "form:descriptionHint",
      "form:referencesTitle",
      "form:referencesDescription",
      "form:dragImages",
      "form:chooseFiles",
      "form:preparingImages",
      "form:rightsLabel",
      "form:advancedTrigger",
      "form:subTextLabel",
      "form:subTextPlaceholder",
      "form:autoBlendLabel",
      "form:autoBlendDescription",
      "form:variationPlaceholder",
      "form:variationTrigger",
      "form:variationGenerate",
      "modelStatus:checkButton",
      "modelStatus:loadingAria",
      "contextBanner:loaded",
      "contextBanner:promise",
      "formCard:title",
      "formCard:description",
      "preview:title",
      "preview:loading",
      "preview:alt",
      "preview:download",
      "preview:newVersion",
      "preview:downloaded",
      "preview:generatedWith",
      "preview:defaultModel",
      "preview:empty:title",
      "preview:empty:description",
      "actions:createThumbnail",
      "actions:creatingThumbnail",
      "advanced:visualStyle",
      "advanced:composition",
      "advanced:cameraAngle",
      "advanced:lighting",
      "advanced:colorScheme",
      "advanced:textPosition",
      "reference:imageAlt",
      "reference:roleAria",
      "reference:removeAria",
      "presets:tutorial",
      "presets:comparison",
      "presets:result",
      "presets:case-study",
      "presets:news",
      "presets:list",
      "presets:review",
      "styleOptions:bold",
      "styleOptions:minimal",
      "styleOptions:gaming",
      "styleOptions:vlog",
      "styleOptions:tutorial",
      "styleOptions:cinematic",
      "styleOptions:tech",
      "styleOptions:lifestyle",
      "compositionOptions:centered",
      "compositionOptions:rule-of-thirds",
      "compositionOptions:close-up",
      "compositionOptions:wide-shot",
      "compositionOptions:split-screen",
      "compositionOptions:diagonal",
      "cameraAngleOptions:eye-level",
      "cameraAngleOptions:low-angle",
      "cameraAngleOptions:high-angle",
      "cameraAngleOptions:dutch-angle",
      "cameraAngleOptions:overhead",
      "cameraAngleOptions:three-quarter",
      "lightingOptions:natural",
      "lightingOptions:dramatic",
      "lightingOptions:golden-hour",
      "lightingOptions:studio",
      "lightingOptions:neon",
      "lightingOptions:backlit",
      "lightingOptions:soft",
      "colorSchemeOptions:vibrant",
      "colorSchemeOptions:muted",
      "colorSchemeOptions:warm",
      "colorSchemeOptions:cool",
      "colorSchemeOptions:monochrome",
      "colorSchemeOptions:complementary",
      "colorSchemeOptions:brand-colors",
      "textPositionOptions:left",
      "textPositionOptions:right",
      "textPositionOptions:center",
      "textPositionOptions:top",
      "textPositionOptions:bottom",
      "textPositionOptions:none",
      "imageRoleOptions:subject",
      "imageRoleOptions:style",
      "imageRoleOptions:background",
      "imageRoleOptions:composition",
      "errors:retry",
      "errors:openSettings",
    ];
    for (const key of thumbnailKeys) {
      test(`en ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "en", ns: "thumbnail" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
      test(`fa ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "fa", ns: "thumbnail" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
    }
  });

  describe("layout and workflow keys resolve in both en and fa", () => {
    const newKeys = [
      "layout.skipToContent",
      "layout.toggleSidebar",
      "nav.tools",
      "nav.recentWorkflows",
      "workflow.untitled",
      "workflow.status.current",
      "workflow.status.upcoming",
      "workflow.status.completed",
      "time.secondsAgo",
      "time.minutesAgo",
      "time.minutesAgo_one",
      "time.hoursAgo",
      "time.hoursAgo_one",
    ];
    for (const key of newKeys) {
      test(`en ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "en", ns: "common" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
      test(`fa ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "fa", ns: "common" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
    }
  });

  describe("navigation keys resolve identically across en/fa", () => {
    for (const key of navKeys) {
      test(`en ${key} resolves to a non-empty string`, () => {
        const enVal = i18n.t(key, { lng: "en", ns: "common" });
        assert.equal(typeof enVal, "string");
        assert.ok(enVal.length > 0, `${key} (en) should be non-empty`);
      });

      test(`fa ${key} resolves to a non-empty string`, () => {
        const faVal = i18n.t(key, { lng: "fa", ns: "common" });
        assert.equal(typeof faVal, "string");
        assert.ok(faVal.length > 0, `${key} (fa) should be non-empty`);
      });

      test(`en and fa ${key} do not return missing-key fallback`, () => {
        const enVal = i18n.t(key, { lng: "en", ns: "common" });
        const faVal = i18n.t(key, { lng: "fa", ns: "common" });
        assert.notEqual(enVal, key, `${key} (en) should not be a missing-key fallback`);
        assert.notEqual(faVal, key, `${key} (fa) should not be a missing-key fallback`);
      });
    }
  });

  describe("errors namespace resolves in both en and fa", () => {
    const errorKeys = [
      "errors:youtube.YOUTUBE_NETWORK.title",
      "errors:youtube.YOUTUBE_NETWORK.suggestion",
      "errors:gemini.GEMINI_SCRIPT_GENERATION_PROVIDER_FAILURE.title",
      "errors:gemini.GEMINI_SCRIPT_GENERATION_PROVIDER_FAILURE.suggestion",
      "errors:custom.CUSTOM_IMAGE_GENERATION_PROVIDER_FAILURE.title",
      "errors:validation.THUMBNAIL_REQUEST_INVALID.title",
      "errors:generic.title",
      "errors:generic.network",
    ];
    for (const key of errorKeys) {
      test(`en ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "en", ns: "errors" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
      test(`fa ${key} non-empty`, () => {
        const v = i18n.t(key, { lng: "fa", ns: "errors" });
        assert.ok(typeof v === "string" && v.length > 0, `${key} should resolve`);
      });
    }
  });
});
