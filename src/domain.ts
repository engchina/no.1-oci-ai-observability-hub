import type {
  ActivityItem,
  AppState,
  OfficialCostItem,
  OraclePricingProduct,
  OraclePricingResponse,
  OraclePricingSkuRow,
  OciSettings,
  PricingRule,
  UsageRecord
} from "./types";

const ORACLE_PRICING_SOURCE_URL = "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/";
export const DEFAULT_OCI_REGION = "us-chicago-1";
export const buildGenerativeAiBaseUrl = (region: string) => {
  const normalizedRegion = region.trim() || DEFAULT_OCI_REGION;
  return `https://inference.generativeai.${normalizedRegion}.oci.oraclecloud.com/20231130/actions/v1`;
};
export const DEFAULT_ENTERPRISE_AI_BASE_URL = buildGenerativeAiBaseUrl(DEFAULT_OCI_REGION);
export const DEFAULT_CHAT_MODEL_ID = "xai.grok-4.3";
export const DEFAULT_EMBEDDING_MODEL_ID = "cohere.embed-v4.0";

const LEGACY_DEFAULT_CHAT_MODEL_IDS = new Set([
  "meta.llama-3.3-70b-instruct"
]);
const LEGACY_DEFAULT_EMBEDDING_MODEL_IDS = new Set([
  "cohere.embed-english-v3.0",
  "cohere.embed-multilingual-v3.0"
]);

export const emptySettings: OciSettings = {
  tenancyOcid: "",
  userOcid: "",
  fingerprint: "",
  homeRegion: DEFAULT_OCI_REGION,
  aiRegion: DEFAULT_OCI_REGION,
  privateKeyPem: "",
  passphrase: "",
  defaultCompartmentOcid: "",
  defaultChatModelId: DEFAULT_CHAT_MODEL_ID,
  defaultEmbeddingModelId: DEFAULT_EMBEDDING_MODEL_ID,
  defaultRerankModelId: "cohere.rerank-v4.0-fast",
  enterpriseAiBaseUrl: DEFAULT_ENTERPRISE_AI_BASE_URL,
  enterpriseAiProjectOcid: "",
  enterpriseAiApiKey: ""
};

export const defaultPricingRules: PricingRule[] = [
  {
    id: "oci-default-character",
    name: "OCI Generative AI オンデマンド文字単価",
    modelPattern: "cohere|meta|llama|grok|xai|embed|rerank|oci",
    requestUsd: 0,
    inputCharacterUsd: 0,
    outputCharacterUsd: 0,
    inputTokenUsd: 0,
    cachedInputTokenUsd: 0,
    outputTokenUsd: 0,
    searchUnitUsd: 0,
    eventUsd: 0,
    storageGbHourUsd: 0,
    imageUsd: 0,
    dedicatedUnitHourUsd: 0,
    connectionMinuteUsd: 0,
    source: "manual",
    active: true
  }
];

export const defaultState: AppState = {
  settings: emptySettings,
  pricingRules: defaultPricingRules,
  usageRecords: [],
  officialCosts: [],
  activityLog: []
};

const toFiniteNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePricingRule = (rule: PricingRule): PricingRule => ({
  ...rule,
  requestUsd: toFiniteNumber(rule.requestUsd),
  inputCharacterUsd: toFiniteNumber(rule.inputCharacterUsd),
  outputCharacterUsd: toFiniteNumber(rule.outputCharacterUsd),
  inputTokenUsd: toFiniteNumber(rule.inputTokenUsd),
  cachedInputTokenUsd: toFiniteNumber(rule.cachedInputTokenUsd),
  outputTokenUsd: toFiniteNumber(rule.outputTokenUsd),
  searchUnitUsd: toFiniteNumber(rule.searchUnitUsd),
  eventUsd: toFiniteNumber(rule.eventUsd),
  storageGbHourUsd: toFiniteNumber(rule.storageGbHourUsd),
  imageUsd: toFiniteNumber(rule.imageUsd),
  dedicatedUnitHourUsd: toFiniteNumber(rule.dedicatedUnitHourUsd),
  connectionMinuteUsd: toFiniteNumber(rule.connectionMinuteUsd),
  minimumPromptTokens: rule.minimumPromptTokens,
  maximumPromptTokens: rule.maximumPromptTokens,
  source: rule.source ?? "manual",
  oraclePartNumbers: rule.oraclePartNumbers ?? [],
  oracleMetricNames: rule.oracleMetricNames ?? [],
  oracleServiceCategories: rule.oracleServiceCategories ?? [],
  oracleSkuRows: rule.oracleSkuRows ?? []
});

const normalizeUsageRecord = (record: UsageRecord): UsageRecord => ({
  ...record,
  requestCount: record.requestCount === undefined ? 1 : toFiniteNumber(record.requestCount),
  promptTokens: toFiniteNumber(record.promptTokens),
  cachedInputTokens: toFiniteNumber(record.cachedInputTokens),
  completionTokens: toFiniteNumber(record.completionTokens),
  searchUnits: toFiniteNumber(record.searchUnits),
  eventCount: toFiniteNumber(record.eventCount),
  storageGbHours: toFiniteNumber(record.storageGbHours),
  imageCount: toFiniteNumber(record.imageCount),
  dedicatedUnitHours: toFiniteNumber(record.dedicatedUnitHours),
  connectionMinutes: toFiniteNumber(record.connectionMinutes),
  inputCharacters: toFiniteNumber(record.inputCharacters),
  outputCharacters: toFiniteNumber(record.outputCharacters),
  latencyMs: toFiniteNumber(record.latencyMs),
  estimatedCostUsd: toFiniteNumber(record.estimatedCostUsd),
  officialAllocatedCostUsd: toFiniteNumber(record.officialAllocatedCostUsd)
});

const migrateDefaultModelId = (
  modelId: string,
  defaultModelId: string,
  legacyModelIds: Set<string>
) => {
  const normalized = modelId.trim();
  if (!normalized || legacyModelIds.has(normalized.toLowerCase())) {
    return defaultModelId;
  }
  return normalized;
};

const normalizeSettings = (settings: Partial<OciSettings> | null | undefined): OciSettings => {
  const merged = { ...emptySettings, ...(settings ?? {}) };
  const legacyRegion = (settings?.region ?? "").trim();
  const homeRegion = (merged.homeRegion || legacyRegion || DEFAULT_OCI_REGION).trim();
  const aiRegion = (merged.aiRegion || legacyRegion || DEFAULT_OCI_REGION).trim();
  return {
    ...merged,
    homeRegion,
    aiRegion,
    region: undefined,
    defaultChatModelId: migrateDefaultModelId(
      merged.defaultChatModelId,
      DEFAULT_CHAT_MODEL_ID,
      LEGACY_DEFAULT_CHAT_MODEL_IDS
    ),
    defaultEmbeddingModelId: migrateDefaultModelId(
      merged.defaultEmbeddingModelId,
      DEFAULT_EMBEDDING_MODEL_ID,
      LEGACY_DEFAULT_EMBEDDING_MODEL_IDS
    ),
    enterpriseAiBaseUrl: merged.enterpriseAiBaseUrl || buildGenerativeAiBaseUrl(aiRegion),
    enterpriseAiProjectOcid: merged.enterpriseAiProjectOcid || merged.defaultProjectOcid || "",
    enterpriseAiApiKey: merged.enterpriseAiApiKey || ""
  };
};

export const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
};

export const nowIso = () => new Date().toISOString();

export const mergeState = (raw: Partial<AppState> | null | undefined): AppState => ({
  ...defaultState,
  ...raw,
  settings: normalizeSettings(raw?.settings),
  pricingRules: raw?.pricingRules?.length ? raw.pricingRules.map(normalizePricingRule) : defaultPricingRules,
  usageRecords: raw?.usageRecords?.map(normalizeUsageRecord) ?? [],
  officialCosts: filterGenerativeAiOfficialCosts(raw?.officialCosts ?? []),
  activityLog: raw?.activityLog ?? []
});

export const addActivity = (state: AppState, message: string): AppState => ({
  ...state,
  activityLog: [
    { id: createId("log"), at: nowIso(), message },
    ...state.activityLog
  ].slice(0, 40)
});

export const formatUsd = (amount: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount > 0 && amount < 0.00001 ? 9 : amount > 0 && amount < 0.01 ? 6 : 2,
    maximumFractionDigits: amount > 0 && amount < 0.00001 ? 9 : amount > 0 && amount < 0.01 ? 6 : 2
  }).format(amount || 0);

export const formatNumber = (amount: number) =>
  new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(amount || 0);

export const formatDateTime = (value: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
};

const matchesPromptTokenRange = (
  rule: PricingRule,
  record: Pick<UsageRecord, "promptTokens">
) => {
  if (rule.minimumPromptTokens !== undefined && record.promptTokens < rule.minimumPromptTokens) {
    return false;
  }
  if (rule.maximumPromptTokens !== undefined && record.promptTokens >= rule.maximumPromptTokens) {
    return false;
  }
  return true;
};

export const findPricingRule = (
  rules: PricingRule[],
  record: Pick<UsageRecord, "modelId" | "promptTokens">
) =>
  rules.find((rule) => {
    if (!rule.active) return false;
    if (!matchesPromptTokenRange(rule, record)) return false;
    try {
      return new RegExp(rule.modelPattern, "i").test(record.modelId);
    } catch {
      return record.modelId.toLowerCase().includes(rule.modelPattern.toLowerCase());
    }
  }) ??
  rules.find((rule) => rule.active && rule.source !== "oracle-pricing-api" && matchesPromptTokenRange(rule, record)) ??
  defaultPricingRules[0];

export const estimateCost = (record: Pick<
  UsageRecord,
  | "modelId"
  | "requestCount"
  | "promptTokens"
  | "cachedInputTokens"
  | "completionTokens"
  | "searchUnits"
  | "eventCount"
  | "storageGbHours"
  | "imageCount"
  | "dedicatedUnitHours"
  | "connectionMinutes"
  | "inputCharacters"
  | "outputCharacters"
>, rules: PricingRule[]) => {
  const rule = findPricingRule(rules, record);
  return (
    record.requestCount * rule.requestUsd +
    record.inputCharacters * rule.inputCharacterUsd +
    record.outputCharacters * rule.outputCharacterUsd +
    record.promptTokens * rule.inputTokenUsd +
    record.cachedInputTokens * rule.cachedInputTokenUsd +
    record.completionTokens * rule.outputTokenUsd +
    record.searchUnits * rule.searchUnitUsd +
    record.eventCount * rule.eventUsd +
    record.storageGbHours * rule.storageGbHourUsd +
    record.imageCount * rule.imageUsd +
    record.dedicatedUnitHours * rule.dedicatedUnitHourUsd +
    record.connectionMinutes * rule.connectionMinuteUsd
  );
};

export const summarize = (records: UsageRecord[], officialCosts: OfficialCostItem[]) => {
  const estimatedCost = records.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
  const allocatedCost = records.reduce((sum, record) => sum + record.officialAllocatedCostUsd, 0);
  const officialCost = officialCosts.reduce((sum, item) => sum + item.computedAmountUsd, 0);
  const requestCount = records.reduce((sum, record) => sum + record.requestCount, 0);
  const promptTokens = records.reduce((sum, record) => sum + record.promptTokens, 0);
  const cachedInputTokens = records.reduce((sum, record) => sum + record.cachedInputTokens, 0);
  const completionTokens = records.reduce((sum, record) => sum + record.completionTokens, 0);
  const searchUnits = records.reduce((sum, record) => sum + record.searchUnits, 0);
  const eventCount = records.reduce((sum, record) => sum + record.eventCount, 0);
  const storageGbHours = records.reduce((sum, record) => sum + record.storageGbHours, 0);
  const imageCount = records.reduce((sum, record) => sum + record.imageCount, 0);
  const dedicatedUnitHours = records.reduce((sum, record) => sum + record.dedicatedUnitHours, 0);
  const connectionMinutes = records.reduce((sum, record) => sum + record.connectionMinutes, 0);
  const inputCharacters = records.reduce((sum, record) => sum + record.inputCharacters, 0);
  const outputCharacters = records.reduce((sum, record) => sum + record.outputCharacters, 0);
  const errors = records.filter((record) => record.status !== "成功").length;
  const reconciled = records.filter((record) => record.billingReconciled).length;

  return {
    estimatedCost,
    allocatedCost,
    officialCost,
    requestCount,
    promptTokens,
    cachedInputTokens,
    completionTokens,
    searchUnits,
    eventCount,
    storageGbHours,
    imageCount,
    dedicatedUnitHours,
    connectionMinutes,
    inputCharacters,
    outputCharacters,
    errors,
    reconciled,
    unreconciledCost: Math.max(officialCost - allocatedCost, 0)
  };
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cleanOracleDisplayName = (value: string) =>
  value
    .replace(/^Oracle Cloud Infrastructure\s+Generative AI/i, "OCI Generative AI")
    .replace(/\s+/g, " ")
    .trim();

const readPayAsYouGoPrice = (product: OraclePricingProduct, currencyCode: string) => {
  const localizations = [
    ...(product.currencyCodeLocalizations ?? []),
    ...(product.prices ?? [])
  ];
  const preferred = localizations.find((item) => item.currencyCode?.toUpperCase() === currencyCode.toUpperCase()) ?? localizations[0];
  const price = preferred?.prices?.find((item) => item.model === "PAY_AS_YOU_GO") ?? preferred?.prices?.[0];
  const value = Number(price?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const readBillingUnitCount = (metricName: string) => {
  const normalized = metricName.replace(/,/g, "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return 1;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const isOracleGenerativeAiPrice = (product: OraclePricingProduct) => {
  const category = product.serviceCategory ?? "";
  return [
    /^OCI Generative AI - Models$/i,
    /^OCI Generative AI - Search and Retrieval$/i,
    /^Generative AI - xAI - Agent Tools$/i,
    /^OCI Generative AI Agents$/i
  ].some((pattern) => pattern.test(category));
};

const normalizeOracleRuleBaseName = (value: string) =>
  value
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

const modelPatternFromName = (name: string) => {
  const normalized = name.toLowerCase();
  const knownPatterns: Array<[RegExp, string]> = [
    [/gpt-oss-120b/, "gpt[-._ ]?oss[-._ ]?120b|openai.*120b"],
    [/gpt-oss-20b/, "gpt[-._ ]?oss[-._ ]?20b|openai.*20b"],
    [/gemini 2\.5 flash lite/, "gemini[-._ ]?2\\.5[-._ ]?flash[-._ ]?lite"],
    [/gemini 2\.5 flash/, "gemini[-._ ]?2\\.5[-._ ]?flash"],
    [/gemini 2\.5 pro/, "gemini[-._ ]?2\\.5[-._ ]?pro"],
    [/grok 4\.3/, "grok[-._ ]?4\\.3"],
    [/grok 4\.2/, "grok[-._ ]?4\\.2"],
    [/grok 4 fast/, "grok[-._ ]?4[-._ ]?fast"],
    [/grok.*code.*fast.*1|grok-code-fast-1/, "grok[-._ ]?(4[-._ ]?)?code[-._ ]?fast[-._ ]?1|grok-code-fast-1"],
    [/grok 3 mini fast/, "grok[-._ ]?3[-._ ]?mini[-._ ]?fast"],
    [/grok 3 fast/, "grok[-._ ]?3[-._ ]?fast"],
    [/grok 3 mini/, "grok[-._ ]?3[-._ ]?mini"],
    [/grok 3 or grok 4/, "grok[-._ ]?[34]"],
    [/llama 4 scout/, "llama[-._ ]?4[-._ ]?scout|meta.*scout"],
    [/llama 4 maverick/, "llama[-._ ]?4[-._ ]?maverick|meta.*maverick"],
    [/llama 3\.1 405b/, "llama[-._ ]?3\\.1.*405b|meta.*405b"],
    [/llama 3\.2 90b vision/, "llama[-._ ]?3\\.2.*90b.*vision|meta.*90b"],
    [/large meta/, "meta|llama"],
    [/large cohere/, "cohere\\.(command-r-plus|command-r|command)|large.*cohere|cohere.*large"],
    [/small cohere/, "cohere\\.command-light|small.*cohere|cohere.*small"],
    [/embed cohere/, "cohere\\.embed|embed.*cohere|cohere.*embed"],
    [/rerank 4 pro/, "rerank[-._ ]?4[-._ ]?pro|cohere.*rerank.*pro|rerank.*pro"],
    [/rerank 4 fast/, "rerank[-._ ]?4[-._ ]?fast|cohere.*rerank.*fast|rerank.*fast"],
    [/text to speech/, "text[-._ ]?to[-._ ]?speech|tts"]
  ];
  const known = knownPatterns.find(([pattern]) => pattern.test(normalized));
  if (known) return known[1];

  const words = normalized
    .replace(/[^a-z0-9.]+/g, " ")
    .split(" ")
    .filter((word) => word && !["oci", "oracle", "cloud", "infrastructure", "generative", "ai", "tokens", "input", "output", "search", "units"].includes(word));
  return words.length ? words.map(escapeRegExp).join(".*") : escapeRegExp(name);
};

const tokenTier = (suffix: string) => {
  const match = suffix.match(/(less than|greater than)\s+(\d+)\s*K/i);
  if (!match) return { key: "default", label: "", minimumPromptTokens: undefined, maximumPromptTokens: undefined };
  const value = Number(match[2]) * 1000;
  if (match[1].toLowerCase() === "less than") {
    return {
      key: `lt-${value}`,
      label: `${match[2]}K未満`,
      minimumPromptTokens: undefined,
      maximumPromptTokens: value
    };
  }
  return {
    key: `gt-${value}`,
    label: `${match[2]}K以上`,
    minimumPromptTokens: value,
    maximumPromptTokens: undefined
  };
};

interface TokenRuleDraft {
  baseName: string;
  tierLabel: string;
  minimumPromptTokens?: number;
  maximumPromptTokens?: number;
  inputTokenUsd: number;
  cachedInputTokenUsd: number;
  outputTokenUsd: number;
  partNumbers: string[];
  metricNames: string[];
  serviceCategories: string[];
  skuRows: OraclePricingSkuRow[];
}

const addUnique = (items: string[], value: string | undefined) => {
  if (value && !items.includes(value)) items.push(value);
};

const buildOraclePricingRule = (overrides: Partial<PricingRule> & Pick<PricingRule, "id" | "name" | "modelPattern">): PricingRule => ({
  requestUsd: 0,
  inputCharacterUsd: 0,
  outputCharacterUsd: 0,
  inputTokenUsd: 0,
  cachedInputTokenUsd: 0,
  outputTokenUsd: 0,
  searchUnitUsd: 0,
  eventUsd: 0,
  storageGbHourUsd: 0,
  imageUsd: 0,
  dedicatedUnitHourUsd: 0,
  connectionMinuteUsd: 0,
  active: true,
  source: "oracle-pricing-api",
  sourceUrl: ORACLE_PRICING_SOURCE_URL,
  ...overrides
});

const oraclePricingRuleId = (product: OraclePricingProduct, name: string) =>
  `oracle-price-${(product.partNumber ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const buildOracleSkuRow = (
  product: OraclePricingProduct,
  currencyCode: string,
  unitPrice: number,
  usageUnitPrice: number
): OraclePricingSkuRow => ({
  partNumber: product.partNumber ?? "",
  displayName: product.displayName ?? "",
  metricName: product.metricName ?? "",
  serviceCategory: product.serviceCategory ?? "",
  unitPrice,
  unitCount: readBillingUnitCount(product.metricName ?? ""),
  usageUnitPrice,
  currencyCode
});

export const buildOfficialPricingRules = (
  response: OraclePricingResponse,
  currencyCode = "USD"
): PricingRule[] => {
  const products = (response.items ?? []).filter(isOracleGenerativeAiPrice);
  const tokenDrafts = new Map<string, TokenRuleDraft>();
  const unitRules: PricingRule[] = [];

  products.forEach((product) => {
    const displayName = product.displayName ?? "";
    const metricName = product.metricName ?? "";
    const price = readPayAsYouGoPrice(product, currencyCode);
    if (!displayName || price <= 0) return;

    const unitCount = readBillingUnitCount(metricName);
    const unitPrice = price / unitCount;
    const skuRow = buildOracleSkuRow(product, currencyCode, price, unitPrice);
    const cleanedName = cleanOracleDisplayName(displayName);

    if (/Tokens/i.test(metricName)) {
      const match = cleanedName.match(/^(.*?)(?:\s*-\s*)(Cached Input Tokens|Input Tokens|Output Tokens)\b(.*)$/i);
      if (!match) return;

      const baseName = normalizeOracleRuleBaseName(match[1]);
      const tier = tokenTier(match[3] ?? "");
      const key = `${baseName}|${tier.key}`;
      const draft = tokenDrafts.get(key) ?? {
        baseName,
        tierLabel: tier.label,
        minimumPromptTokens: tier.minimumPromptTokens,
        maximumPromptTokens: tier.maximumPromptTokens,
        inputTokenUsd: 0,
        cachedInputTokenUsd: 0,
        outputTokenUsd: 0,
        partNumbers: [],
        metricNames: [],
        serviceCategories: [],
        skuRows: []
      };

      if (/^Input Tokens$/i.test(match[2])) {
        draft.inputTokenUsd = draft.inputTokenUsd > 0 ? Math.min(draft.inputTokenUsd, unitPrice) : unitPrice;
      }
      if (/Cached Input Tokens/i.test(match[2])) {
        draft.cachedInputTokenUsd = draft.cachedInputTokenUsd > 0 ? Math.min(draft.cachedInputTokenUsd, unitPrice) : unitPrice;
      }
      if (/Output Tokens/i.test(match[2])) {
        draft.outputTokenUsd = unitPrice;
      }
      addUnique(draft.partNumbers, product.partNumber);
      addUnique(draft.metricNames, metricName);
      addUnique(draft.serviceCategories, product.serviceCategory);
      draft.skuRows.push(skuRow);
      tokenDrafts.set(key, draft);
      return;
    }

    if (/Search Units?/i.test(metricName)) {
      const baseName = normalizeOracleRuleBaseName(cleanedName);
      unitRules.push(buildOraclePricingRule({
        id: oraclePricingRuleId(product, baseName),
        name: `${baseName}（Oracle公式）`,
        modelPattern: modelPatternFromName(baseName),
        searchUnitUsd: unitPrice,
        currencyCode,
        oraclePartNumbers: product.partNumber ? [product.partNumber] : [],
        oracleMetricNames: [metricName],
        oracleServiceCategories: product.serviceCategory ? [product.serviceCategory] : [],
        oracleSkuRows: [skuRow],
        oracleLastUpdated: response.lastUpdated
      }));
      return;
    }

    if (/Requests?/i.test(metricName)) {
      const baseName = normalizeOracleRuleBaseName(cleanedName);
      unitRules.push(buildOraclePricingRule({
        id: oraclePricingRuleId(product, baseName),
        name: `${baseName}（Oracle公式）`,
        modelPattern: modelPatternFromName(baseName),
        requestUsd: unitPrice,
        currencyCode,
        oraclePartNumbers: product.partNumber ? [product.partNumber] : [],
        oracleMetricNames: [metricName],
        oracleServiceCategories: product.serviceCategory ? [product.serviceCategory] : [],
        oracleSkuRows: [skuRow],
        oracleLastUpdated: response.lastUpdated
      }));
      return;
    }

    if (/Events?/i.test(metricName)) {
      const baseName = normalizeOracleRuleBaseName(cleanedName);
      unitRules.push(buildOraclePricingRule({
        id: oraclePricingRuleId(product, baseName),
        name: `${baseName}（Oracle公式）`,
        modelPattern: modelPatternFromName(baseName),
        eventUsd: unitPrice,
        currencyCode,
        oraclePartNumbers: product.partNumber ? [product.partNumber] : [],
        oracleMetricNames: [metricName],
        oracleServiceCategories: product.serviceCategory ? [product.serviceCategory] : [],
        oracleSkuRows: [skuRow],
        oracleLastUpdated: response.lastUpdated
      }));
      return;
    }

    if (/Gigabyte Storage Per Hour/i.test(metricName)) {
      const baseName = normalizeOracleRuleBaseName(cleanedName);
      unitRules.push(buildOraclePricingRule({
        id: oraclePricingRuleId(product, baseName),
        name: `${baseName}（Oracle公式）`,
        modelPattern: modelPatternFromName(baseName),
        storageGbHourUsd: unitPrice,
        currencyCode,
        oraclePartNumbers: product.partNumber ? [product.partNumber] : [],
        oracleMetricNames: [metricName],
        oracleServiceCategories: product.serviceCategory ? [product.serviceCategory] : [],
        oracleSkuRows: [skuRow],
        oracleLastUpdated: response.lastUpdated
      }));
      return;
    }

    if (/Image/i.test(metricName)) {
      const baseName = normalizeOracleRuleBaseName(cleanedName);
      unitRules.push(buildOraclePricingRule({
        id: oraclePricingRuleId(product, baseName),
        name: `${baseName}（Oracle公式）`,
        modelPattern: modelPatternFromName(baseName),
        imageUsd: unitPrice,
        currencyCode,
        oraclePartNumbers: product.partNumber ? [product.partNumber] : [],
        oracleMetricNames: [metricName],
        oracleServiceCategories: product.serviceCategory ? [product.serviceCategory] : [],
        oracleSkuRows: [skuRow],
        oracleLastUpdated: response.lastUpdated
      }));
      return;
    }

    if (/AI Unit Per Hour|Cluster Hour/i.test(metricName)) {
      const baseName = normalizeOracleRuleBaseName(cleanedName);
      unitRules.push(buildOraclePricingRule({
        id: oraclePricingRuleId(product, baseName),
        name: `${baseName}（Oracle公式）`,
        modelPattern: modelPatternFromName(baseName),
        dedicatedUnitHourUsd: unitPrice,
        currencyCode,
        oraclePartNumbers: product.partNumber ? [product.partNumber] : [],
        oracleMetricNames: [metricName],
        oracleServiceCategories: product.serviceCategory ? [product.serviceCategory] : [],
        oracleSkuRows: [skuRow],
        oracleLastUpdated: response.lastUpdated
      }));
      return;
    }

    if (/Connection Time Minute/i.test(metricName)) {
      const baseName = normalizeOracleRuleBaseName(cleanedName);
      unitRules.push(buildOraclePricingRule({
        id: oraclePricingRuleId(product, baseName),
        name: `${baseName}（Oracle公式）`,
        modelPattern: modelPatternFromName(baseName),
        connectionMinuteUsd: unitPrice,
        currencyCode,
        oraclePartNumbers: product.partNumber ? [product.partNumber] : [],
        oracleMetricNames: [metricName],
        oracleServiceCategories: product.serviceCategory ? [product.serviceCategory] : [],
        oracleSkuRows: [skuRow],
        oracleLastUpdated: response.lastUpdated
      }));
      return;
    }

    if (/Transactions|Characters/i.test(metricName)) {
      const isTransaction = /Transactions/i.test(metricName);
      const isAgentTransaction = /OCI Generative AI Agents/i.test(product.serviceCategory ?? "");
      const isEmbed = /embed/i.test(cleanedName);
      const isTextToSpeech = /text to speech/i.test(cleanedName);
      const baseName = normalizeOracleRuleBaseName(cleanedName);
      unitRules.push(buildOraclePricingRule({
        id: oraclePricingRuleId(product, cleanedName),
        name: `${baseName}（Oracle公式）`,
        modelPattern: modelPatternFromName(baseName),
        requestUsd: isTransaction && isAgentTransaction ? unitPrice : 0,
        inputCharacterUsd: isAgentTransaction ? 0 : unitPrice,
        outputCharacterUsd: isEmbed || isTextToSpeech || isAgentTransaction ? 0 : unitPrice,
        currencyCode,
        oraclePartNumbers: product.partNumber ? [product.partNumber] : [],
        oracleMetricNames: [metricName],
        oracleServiceCategories: product.serviceCategory ? [product.serviceCategory] : [],
        oracleSkuRows: [skuRow],
        oracleLastUpdated: response.lastUpdated
      }));
    }
  });

  const tokenRules = Array.from(tokenDrafts.values())
    .filter((draft) => draft.inputTokenUsd > 0 || draft.cachedInputTokenUsd > 0 || draft.outputTokenUsd > 0)
    .map<PricingRule>((draft) => buildOraclePricingRule({
      id: `oracle-price-${draft.partNumbers.join("-").toLowerCase()}`,
      name: `${draft.baseName}${draft.tierLabel ? ` ${draft.tierLabel}` : ""}（Oracle公式）`,
      modelPattern: modelPatternFromName(draft.baseName),
      inputTokenUsd: draft.inputTokenUsd,
      cachedInputTokenUsd: draft.cachedInputTokenUsd,
      outputTokenUsd: draft.outputTokenUsd,
      minimumPromptTokens: draft.minimumPromptTokens,
      maximumPromptTokens: draft.maximumPromptTokens,
      currencyCode,
      oraclePartNumbers: draft.partNumbers,
      oracleMetricNames: draft.metricNames,
      oracleServiceCategories: draft.serviceCategories,
      oracleSkuRows: draft.skuRows,
      oracleLastUpdated: response.lastUpdated
    }));

  return [...tokenRules, ...unitRules].sort((a, b) => pricingSpecificityScore(b) - pricingSpecificityScore(a));
};

const pricingSpecificityScore = (rule: PricingRule) => {
  const thresholdScore = rule.minimumPromptTokens !== undefined || rule.maximumPromptTokens !== undefined ? 200 : 0;
  const genericPenalty = /^(meta|llama)$|large.*cohere|small.*cohere/i.test(rule.modelPattern) ? 80 : 0;
  return rule.modelPattern.length + thresholdScore - genericPenalty;
};

export const recalculateUsageCosts = (records: UsageRecord[], rules: PricingRule[]) =>
  records.map((record) => ({
    ...record,
    estimatedCostUsd: estimateCost(record, rules),
    billingReconciled: false,
    officialAllocatedCostUsd: 0
  }));

const readString = (value: unknown) => (typeof value === "string" ? value : "");
const readNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const GENERATIVE_AI_SKU_PATTERNS = [
  /^OCI\s+Generative\s+AI(?:\s+Agents?)?\b/i,
  /^Oracle\s+Cloud\s+Infrastructure\s+Generative\s+(?:AI|x)(?:\s+Agents?)?\b/i,
  /^Oracle\s+Cloud\s+Infrastructure\s*生成AI\b/i
];
const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const readFirstString = (item: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = readString(item[key]);
    if (value) return value;
  }
  return "";
};
const findTaggedString = (value: unknown, normalizedKeys: string[]): string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && normalizedKeys.includes(normalizeKey(key))) {
      return child;
    }
    const nested = findTaggedString(child, normalizedKeys);
    if (nested) return nested;
  }
  return "";
};
const readTaggedString = (item: Record<string, unknown>, keys: string[]) => {
  const normalizedKeys = keys.map(normalizeKey);
  for (const container of [item.freeformTags, item.definedTags, item.tags]) {
    const value = findTaggedString(container, normalizedKeys);
    if (value) return value;
  }
  return "";
};
const readProjectName = (item: Record<string, unknown>) =>
  readFirstString(item, ["projectName", "project", "projectDisplayName", "generativeAiProjectName"]) ||
  readTaggedString(item, ["project", "projectName", "generativeAiProject"]);
const readProjectOcid = (item: Record<string, unknown>) =>
  readFirstString(item, ["projectOcid", "projectId", "generativeAiProjectOcid", "generativeAiProjectId"]) ||
  readTaggedString(item, ["projectOcid", "projectId", "generativeAiProjectOcid", "generativeAiProjectId"]);

export const parseOfficialCostJson = (text: string): OfficialCostItem[] => {
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : parsed.items ?? parsed.data ?? [];
  if (!Array.isArray(items)) {
    throw new Error("OCI Usage API の items 配列を確認できませんでした。");
  }

  return items.map((item: Record<string, unknown>, index: number) => ({
    id: createId(`official-${index}`),
    timeStarted: readString(item.timeUsageStarted ?? item.timeStarted),
    timeEnded: readString(item.timeUsageEnded ?? item.timeEnded),
    service: readString(item.service ?? item.serviceName ?? "OCI Generative AI On-Demand"),
    skuName: readString(item.skuName ?? item.skuPartNumber),
    region: readString(item.region),
    compartmentOcid: readString(item.compartmentId ?? item.compartmentOcid),
    projectName: readProjectName(item),
    projectOcid: readProjectOcid(item),
    resourceOcid: readString(item.resourceId ?? item.resourceOcid),
    usageQuantity: readNumber(item.usageQuantity ?? item.quantity),
    usageUnit: readString(item.unit ?? item.usageUnit),
    computedAmountUsd: readNumber(item.computedAmount ?? item.computedAmountUsd ?? item.cost),
    source: "OCI Usage API"
  }));
};

export const isGenerativeAiOfficialCostItem = (item: OfficialCostItem) => {
  const skuName = readString(item.skuName).trim();
  return Boolean(skuName && GENERATIVE_AI_SKU_PATTERNS.some((pattern) => pattern.test(skuName)));
};

export const filterGenerativeAiOfficialCosts = (items: OfficialCostItem[]) =>
  items.filter(isGenerativeAiOfficialCostItem);

export const reconcileOfficialCosts = (state: AppState): AppState => {
  const records = state.usageRecords.map((record) => ({ ...record, officialAllocatedCostUsd: 0, billingReconciled: false }));

  state.officialCosts.forEach((cost) => {
    const matches = records.filter((record) => {
      const sameProjectOcid = cost.projectOcid && record.projectOcid === cost.projectOcid;
      const sameProjectName = cost.projectName && record.projectName.toLowerCase() === cost.projectName.toLowerCase();
      const sameResource = cost.resourceOcid && (record.projectOcid === cost.resourceOcid || record.modelId === cost.resourceOcid);
      const sameCompartment = cost.compartmentOcid && record.compartmentOcid === cost.compartmentOcid;
      const sameRegion = cost.region && record.region === cost.region;
      return sameProjectOcid || sameProjectName || sameResource || (sameCompartment && sameRegion);
    });

    const targetRecords = matches.length ? matches : records;
    const estimatedTotal = targetRecords.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
    const fallbackWeight = targetRecords.length ? cost.computedAmountUsd / targetRecords.length : 0;

    targetRecords.forEach((record) => {
      const weight = estimatedTotal > 0 ? record.estimatedCostUsd / estimatedTotal : 0;
      record.officialAllocatedCostUsd += estimatedTotal > 0 ? cost.computedAmountUsd * weight : fallbackWeight;
      record.billingReconciled = true;
    });
  });

  return addActivity({ ...state, usageRecords: records }, "公式コストを使用量レコードへ按分しました。");
};

export const validateSettings = (settings: OciSettings) => {
  const missing = [
    ["テナンシ OCID", settings.tenancyOcid],
    ["ユーザー OCID", settings.userOcid],
    ["フィンガープリント", settings.fingerprint],
    ["Home Region", settings.homeRegion],
    ["AI実行リージョン", settings.aiRegion],
    ["秘密鍵 PEM", settings.privateKeyPem]
  ].filter(([, value]) => !value);

  const messages = missing.map(([label]) => `${label} が未入力です。`);
  if (settings.privateKeyPem && !settings.privateKeyPem.includes("BEGIN")) {
    messages.push("秘密鍵 PEM の形式を確認してください。");
  }
  if (!settings.defaultChatModelId) {
    messages.push("既定チャットモデルIDが未入力です。");
  }
  if (!settings.defaultEmbeddingModelId) {
    messages.push("既定EmbeddingモデルIDが未入力です。");
  }
  if (!settings.defaultRerankModelId) {
    messages.push("既定RerankモデルIDが未入力です。");
  }
  if (!settings.enterpriseAiBaseUrl) {
    messages.push("Enterprise AI Base URLが未入力です。");
  } else {
    try {
      const url = new URL(settings.enterpriseAiBaseUrl);
      if (url.protocol !== "https:") {
        messages.push("Enterprise AI Base URLは https:// から始まるURLを入力してください。");
      }
    } catch {
      messages.push("Enterprise AI Base URLの形式を確認してください。");
    }
  }
  return {
    ready: messages.length === 0,
    messages: messages.length ? messages : ["OCI API 設定は保存されています。"]
  };
};

export const buildActivityItem = (message: string): ActivityItem => ({
  id: createId("log"),
  at: nowIso(),
  message
});
