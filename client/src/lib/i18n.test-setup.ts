// Pre-import browser stubs. This file MUST be imported BEFORE
// importing ./i18n so that init() can call document APIs without crashing.
const localStorageStore = new Map<string, string>();

if (typeof (globalThis as any).navigator === "undefined" || !("language" in (globalThis as any).navigator)) {
  (globalThis as any).navigator = {
    language: "en-US",
    languages: ["en-US", "en"],
  };
}

(globalThis as any).localStorage = {
  store: localStorageStore,
  getItem: (key: string) => {
    const v = localStorageStore.get(key);
    return v === undefined ? null : JSON.stringify(v);
  },
  setItem: (key: string, val: string) => {
    try {
      localStorageStore.set(key, JSON.parse(val));
    } catch {
      localStorageStore.set(key, val);
    }
  },
  removeItem: (key: string) => {
    localStorageStore.delete(key);
  },
  clear: () => localStorageStore.clear(),
};

// Minimal document stub
const docElementAttrs: Record<string, string> = {};
(globalThis as any).document = {
  documentElement: {
    get dir() {
      return docElementAttrs.dir ?? "";
    },
    set dir(v: string) {
      docElementAttrs.dir = v;
    },
    get lang() {
      return docElementAttrs.lang ?? "";
    },
    set lang(v: string) {
      docElementAttrs.lang = v;
    },
  },
};

export {};
