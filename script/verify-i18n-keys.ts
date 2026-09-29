import * as fs from "fs";
import * as path from "path";

const EN_DIR = "client/src/locales/en";
const FA_DIR = "client/src/locales/fa";
const SRC_DIR = "client/src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getKeys(obj: any): string[] {
  const keys: string[] = [];
  const walk = (o: any, prefix: string) => {
    for (const k of Object.keys(o)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (o[k] !== null && typeof o[k] === "object" && !Array.isArray(o[k])) {
        walk(o[k], full);
      } else {
        keys.push(full);
      }
    }
  };
  walk(obj, "");
  return keys;
}

function walkFiles(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// Interpolation variables present in a translated string.
function varsOf(s: string): string[] {
  return [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
}

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

// Known dynamic prefix families built by concatenating a variable suffix.
// Prefixes are matched with startsWith(), so keys under these are used.
const DYNAMIC_PREFIXES = [
  "common:nav.",
  "common:workflow.status.",
  "controller-guide:items.",
  "common:language.",
  "thumbnail:options.",
  "thumbnail:presets.",
  "research:ideas.",
  "research:duration.",
  "research:recency.",
  "research:insights.insufficientEvidence",
];

// error-resolver builds keys like errors:<provider>.<CODE>.<title|suggestion>
// for every provider/code pair; treat the whole errors namespace as dynamic.
const DYNAMIC_NAMESPACES = ["errors"];

const TEST_FILE = path.join(SRC_DIR, "lib", "i18n.test.ts");

function fileNamespaces(content: string): string[] {
  const nss = new Set<string>();
  for (const m of content.matchAll(/useTranslation\(\s*\[\s*([^\]]*?)\s*\]\s*\)/g)) {
    for (const x of m[1].matchAll(/"([^"]+)"|'([^']+)'/g)) nss.add(x[1] || x[2]);
  }
  for (const m of content.matchAll(/useTranslation\(\s*["']([^"']+)["']\s*\)/g)) nss.add(m[1]);
  return [...nss];
}

function collectKeys(content: string): { literals: Set<string>; prefixes: Set<string> } {
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  for (const m of content.matchAll(/\bt\(\s*"([^"]+)"\s*[,)]/g)) literals.add(m[1]);
  for (const m of content.matchAll(/\bt\(\s*'([^']+)'\s*[,)]/g)) literals.add(m[1]);
  for (const m of content.matchAll(/\bt\(\s*`([^`]*)`\s*[,)]/g)) literals.add(m[1]);
  for (const m of content.matchAll(/\bt\(\s*`([^`]*)\$\{/g)) prefixes.add(m[1]);
  for (const m of content.matchAll(/\bi18n\.t\(\s*"([^"]+)"\s*/g)) literals.add(m[1]);
  for (const m of content.matchAll(/\bi18n\.t\(\s*'([^']+)'\s*/g)) literals.add(m[1]);
  for (const m of content.matchAll(/\bi18n\.t\(\s*`([^`]*)\$\{/g)) prefixes.add(m[1]);
  return { literals, prefixes };
}

function detectOrphans(namespaces: string[], defined: Record<string, Set<string>>): string[] {
  const files = [
    ...walkFiles(SRC_DIR, ".tsx"),
    ...walkFiles(SRC_DIR, ".ts"),
  ].filter((f) => !f.includes(".test."));

  const USED = new Set<string>();
  const PREFIXES = new Set<string>([...DYNAMIC_PREFIXES]);

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const nss = fileNamespaces(content);
    const { literals, prefixes } = collectKeys(content);
    for (const k of literals) {
      if (k.includes(":")) {
        USED.add(k);
      } else {
        const resolvedNss = nss.length > 0 ? nss : ["common"];
        for (const ns of resolvedNss) {
          if (defined[ns]?.has(k)) USED.add(`${ns}:${k}`);
        }
      }
    }
    for (const p of prefixes) {
      if (p.includes(":")) {
        PREFIXES.add(p);
      } else {
        const resolvedNss = nss.length > 0 ? nss : ["common"];
        for (const ns of resolvedNss) PREFIXES.add(`${ns}:${p}`);
      }
    }
    // string literals used as labels/keys passed to t(variableKey)
    for (const m of content.matchAll(/["']([^"']+)["']/g)) {
      const s = m[1];
      const nsPrefix = s.includes(":") ? s.split(":")[0] : null;
      const barePart = nsPrefix ? s.slice(nsPrefix.length + 1) : s;
      if (/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+$/.test(barePart)) {
        if (nsPrefix) {
          if (defined[nsPrefix]?.has(barePart)) USED.add(s);
        } else if (nss.length > 0) {
          for (const ns of nss) {
            if (defined[ns]?.has(barePart)) USED.add(`${ns}:${barePart}`);
          }
        }
      }
    }
  }

  // test references count as usage (i18n.test.ts asserts resolution).
  // Colon-form test keys like "styleOptions:bold" (or "form:topicLabel") are used
  // with ns:"thumbnail": translate them to the dotted key under a known namespace
  // when the colon part is not itself a registered namespace.
  if (fs.existsSync(TEST_FILE)) {
    const content = fs.readFileSync(TEST_FILE, "utf8");
    const { literals } = collectKeys(content);
    const allLiterals = new Set(literals);
    for (const m of content.matchAll(/["']([^"']+)["']/g)) {
      const s = m[1].replace(/["']$/, "");
      if ((s.includes(":") || s.includes(".")) && /[a-z]/.test(s)) allLiterals.add(s);
    }
    for (const k of allLiterals) {
      if (k.includes(":")) {
        USED.add(k);
        const colonPart = k.split(":")[0];
        if (!namespaces.includes(colonPart)) {
          const dotForm = k.replace(":", ".");
          for (const ns of namespaces) {
            if (defined[ns]?.has(dotForm)) USED.add(`${ns}:${dotForm}`);
          }
        }
      } else {
        for (const ns of namespaces) {
          if (defined[ns]?.has(k)) USED.add(`${ns}:${k}`);
        }
      }
    }
  }

  const orphans: string[] = [];
  for (const ns of namespaces) {
    for (const k of [...defined[ns]].sort()) {
      const full = `${ns}:${k}`;
      const used = USED.has(full) || DYNAMIC_NAMESPACES.includes(ns) ||
        [...PREFIXES].some((p) => p === full || (p.endsWith(".") && full.startsWith(p)));
      if (!used) orphans.push(`${ns}:${k}`);
    }
  }
  return orphans;
}

// ---------------------------------------------------------------------------
// Duplicate detection (same parent path, repeated key name in raw JSON text)
// ---------------------------------------------------------------------------

// Enumerate every object key with its full dotted path by scanning raw JSON text.
// Flags the same full path appearing more than once (JSON.parse keeps the last,
// so an earlier value would be silently dropped).
function detectDuplicatePaths(raw: string, ns: string): string[] {
  // Tokenize raw JSON into structural tokens: K:<key>, {, }, [, ], STR, NUM, TRUE/FALSE/NULL
  // then reconstruct each key's full dotted path to detect repeated full paths.
  const dups: string[] = [];
  const paths = new Set<string>();
  const tokens: string[] = [];
  let i = 0;
  const len = raw.length;
  while (i < len) {
    const c = raw[i];
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < len && raw[j] !== '"') {
        if (raw[j] === "\\") { s += raw[j] + (raw[j + 1] || ""); j += 2; }
        else { s += raw[j]; j++; }
      }
      i = j + 1;
      while (i < len && (raw[i] === " " || raw[i] === "\n" || raw[i] === "\r" || raw[i] === "\t")) i++;
      if (raw[i] === ":") {
        tokens.push(`K:${s}`);
        i++;
      } else {
        tokens.push("STR");
      }
    } else if (c === "{") {
      tokens.push("{");
      i++;
    } else if (c === "}") {
      tokens.push("}");
      i++;
    } else if (c === "[") {
      tokens.push("[");
      i++;
    } else if (c === "]") {
      tokens.push("]");
      i++;
    } else if (/[-\d]/.test(c)) {
      let j = i;
      while (j < len && /[-\d.eE+]/.test(raw[j])) j++;
      tokens.push("NUM");
      i = j;
    } else if (c === "t" && raw.startsWith("true", i)) { tokens.push("TRUE"); i += 4; }
    else if (c === "f" && raw.startsWith("false", i)) { tokens.push("FALSE"); i += 5; }
    else if (c === "n" && raw.startsWith("null", i)) { tokens.push("NULL"); i += 4; }
    else { i++; }
  }

  const pathStack: string[] = [];
  for (const t of tokens) {
    if (t === "{") {
      pathStack.push("");
    } else if (t === "}") {
      pathStack.pop();
    } else if (t.startsWith("K:")) {
      const name = t.slice(2);
      const full = [...pathStack, name].filter(Boolean).join(".");
      if (paths.has(full)) dups.push(`${ns}.${full}`);
      paths.add(full);
      pathStack[pathStack.length - 1] = name;
    }
  }
  return dups;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const enFiles = fs.readdirSync(EN_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const faFiles = fs.readdirSync(FA_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));

let discrepancies = 0;

const definedEn: Record<string, Set<string>> = {};
for (const ns of enFiles) {
  definedEn[ns] = new Set(getKeys(JSON.parse(fs.readFileSync(path.join(EN_DIR, ns + ".json"), "utf8"))));
}
const definedFa: Record<string, Set<string>> = {};
for (const ns of faFiles) {
  definedFa[ns] = new Set(getKeys(JSON.parse(fs.readFileSync(path.join(FA_DIR, ns + ".json"), "utf8"))));
}

// 1) Structural parity
for (const ns of enFiles) {
  if (!faFiles.includes(ns)) {
    console.error(`[i18n] Missing FA namespace: ${ns}`);
    discrepancies++;
    continue;
  }
  const enKeys = [...definedEn[ns]];
  const faKeys = [...definedFa[ns]];
  const inEnNotFa = enKeys.filter(k => !faKeys.includes(k));
  const inFaNotEn = faKeys.filter(k => !enKeys.includes(k));
  if (inEnNotFa.length > 0) {
    console.error(`[i18n] Namespace "${ns}" has keys in en missing in fa (${inEnNotFa.length}):`);
    for (const k of inEnNotFa.slice(0, 10)) console.error(`  - ${k}`);
    if (inEnNotFa.length > 10) console.error(`  ... and ${inEnNotFa.length - 10} more`);
    discrepancies++;
  }
  if (inFaNotEn.length > 0) {
    console.error(`[i18n] Namespace "${ns}" has keys in fa missing in en (${inFaNotEn.length}):`);
    for (const k of inFaNotEn.slice(0, 10)) console.error(`  - ${k}`);
    if (inFaNotEn.length > 10) console.error(`  ... and ${inFaNotEn.length - 10} more`);
    discrepancies++;
  }
}

for (const ns of faFiles) {
  if (!enFiles.includes(ns)) {
    console.error(`[i18n] Missing EN namespace: ${ns}`);
    discrepancies++;
  }
}

// 2) Duplicate key names at the same JSON path
for (const ns of enFiles) {
  const rawEn = fs.readFileSync(path.join(EN_DIR, ns + ".json"), "utf8");
  const rawFa = fs.readFileSync(path.join(FA_DIR, ns + ".json"), "utf8");
  for (const d of detectDuplicatePaths(rawEn, ns)) {
    console.error(`[i18n] Duplicate key path in en ${d} (same full JSON path defined twice; later value wins)`);
    discrepancies++;
  }
  for (const d of detectDuplicatePaths(rawFa, ns)) {
    console.error(`[i18n] Duplicate key path in fa ${d} (same full JSON path defined twice; later value wins)`);
    discrepancies++;
  }
}

// 3) Interpolation variable parity
for (const ns of enFiles) {
  const enData = JSON.parse(fs.readFileSync(path.join(EN_DIR, ns + ".json"), "utf8"));
  const faData = JSON.parse(fs.readFileSync(path.join(FA_DIR, ns + ".json"), "utf8"));
  const enMap: Record<string, string> = {};
  for (const k of getKeys(enData)) enMap[k] = pathVal(enData, k);
  const faMap: Record<string, string> = {};
  for (const k of getKeys(faData)) faMap[k] = pathVal(faData, k);
  for (const k of Object.keys(enMap)) {
    const ev = varsOf(String(enMap[k]));
    const fv = varsOf(String(faMap[k]));
    if (ev.length !== fv.length || ev.some((v, i) => v !== fv[i])) {
      console.error(`[i18n] Interpolation mismatch ${ns}.${k}: en={${ev.join(",")}} fa={${fv.join(",")}}`);
      discrepancies++;
    }
  }
}

// 4) Orphan detection (must run AFTER deletions so the repo stays clean)
const orphans = detectOrphans(enFiles, definedEn);
const orphansByNs: Record<string, string[]> = {};
for (const o of orphans) {
  const [ns, key] = o.split(/:(.+)/);
  (orphansByNs[ns] = orphansByNs[ns] || []).push(key);
}
for (const ns of enFiles) {
  if (orphansByNs[ns]?.length) {
    console.error(`[i18n] Orphan keys in ${ns} (defined but never referenced in src or tests): ${orphansByNs[ns].length}`);
    for (const k of orphansByNs[ns]) console.error(`  - ${k}`);
    discrepancies++;
  }
}

function pathVal(obj: any, dotted: string): string | undefined {
  let v: any = obj;
  for (const seg of dotted.split(".")) {
    if (v === null || v === undefined || typeof v !== "object") return undefined;
    v = v[seg];
  }
  return typeof v === "string" ? v : undefined;
}

if (discrepancies === 0) {
  console.log("[i18n] Structure, interpolation, and usage checks passed for en and fa namespaces.");
  process.exit(0);
} else {
  console.error(`[i18n] i18n verification FAILED with ${discrepancies} discrepancy(s).`);
  process.exit(1);
}