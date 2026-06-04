export type ViewId = "dashboard" | "usage" | "official" | "ai" | "settings";

export type UsageStatus = "成功" | "クライアントエラー" | "サーバーエラー" | "確認待ち";

export interface OciSettings {
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  homeRegion: string;
  aiRegion: string;
  region?: string;
  privateKeyPem: string;
  passphrase: string;
  defaultCompartmentOcid: string;
  defaultChatModelId: string;
  defaultEmbeddingModelId: string;
  defaultRerankModelId: string;
  enterpriseAiBaseUrl: string;
  enterpriseAiProjectOcid: string;
  enterpriseAiApiKey: string;
  enterpriseAiProjectName?: string;
  defaultProjectName?: string;
  defaultProjectOcid?: string;
}

export interface PricingRule {
  id: string;
  name: string;
  modelPattern: string;
  requestUsd: number;
  inputCharacterUsd: number;
  outputCharacterUsd: number;
  inputTokenUsd: number;
  cachedInputTokenUsd: number;
  outputTokenUsd: number;
  searchUnitUsd: number;
  eventUsd: number;
  storageGbHourUsd: number;
  imageUsd: number;
  dedicatedUnitHourUsd: number;
  connectionMinuteUsd: number;
  minimumPromptTokens?: number;
  maximumPromptTokens?: number;
  active: boolean;
  source?: "manual" | "oracle-pricing-api";
  sourceUrl?: string;
  currencyCode?: string;
  oraclePartNumbers?: string[];
  oracleMetricNames?: string[];
  oracleServiceCategories?: string[];
  oracleSkuRows?: OraclePricingSkuRow[];
  oracleLastUpdated?: string;
}

export interface OraclePricingSkuRow {
  partNumber: string;
  displayName: string;
  metricName: string;
  serviceCategory: string;
  unitPrice: number;
  unitCount: number;
  usageUnitPrice: number;
  currencyCode: string;
}

export interface UsageRecord {
  id: string;
  occurredAt: string;
  source: string;
  service: string;
  region: string;
  compartmentOcid: string;
  projectName: string;
  projectOcid: string;
  modelId: string;
  requestCount: number;
  promptTokens: number;
  cachedInputTokens: number;
  completionTokens: number;
  searchUnits: number;
  eventCount: number;
  storageGbHours: number;
  imageCount: number;
  dedicatedUnitHours: number;
  connectionMinutes: number;
  inputCharacters: number;
  outputCharacters: number;
  latencyMs: number;
  status: UsageStatus;
  opcRequestId: string;
  estimatedCostUsd: number;
  officialAllocatedCostUsd: number;
  billingReconciled: boolean;
  notes: string;
}

export interface OfficialCostItem {
  id: string;
  timeStarted: string;
  timeEnded: string;
  service: string;
  skuName: string;
  region: string;
  compartmentOcid: string;
  projectName: string;
  projectOcid: string;
  resourceOcid: string;
  usageQuantity: number;
  usageUnit: string;
  computedAmountUsd: number;
  source: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  message: string;
}

export interface AppState {
  settings: OciSettings;
  pricingRules: PricingRule[];
  usageRecords: UsageRecord[];
  officialCosts: OfficialCostItem[];
  activityLog: ActivityItem[];
}

export interface ValidationResult {
  ready: boolean;
  messages: string[];
}

export interface OraclePricingPrice {
  model?: string;
  value?: number | string;
  rangeMin?: number | string;
  rangeMax?: number | string;
  rangeUnit?: string;
}

export interface OraclePricingCurrency {
  currencyCode?: string;
  prices?: OraclePricingPrice[];
}

export interface OraclePricingProduct {
  partNumber?: string;
  displayName?: string;
  metricName?: string;
  serviceCategory?: string;
  currencyCodeLocalizations?: OraclePricingCurrency[];
  prices?: OraclePricingCurrency[];
}

export interface OraclePricingResponse {
  lastUpdated?: string;
  items?: OraclePricingProduct[];
}

export type OciUsageGranularity = "DAILY" | "MONTHLY";

export interface OciUsageCostRequest {
  timeUsageStarted: string;
  timeUsageEnded: string;
  granularity: OciUsageGranularity;
  serviceFilter?: string;
  compartmentFilters?: string[];
  compartmentDepth?: number;
  groupBy?: string[];
}

export interface OciAiRunRequest {
  region?: string;
  modelId: string;
  compartmentOcid: string;
  projectName?: string;
  projectOcid?: string;
  prompt?: string;
  input?: string;
  documents?: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  topN?: number;
  maxChunksPerDocument?: number;
  maxTokensPerDocument?: number;
  inputType?: "SEARCH_DOCUMENT" | "SEARCH_QUERY" | "CLASSIFICATION" | "CLUSTERING";
  truncate?: "NONE" | "START" | "END";
}

export interface OciAiRunResult {
  kind: "native-chat" | "enterprise-chat" | "embedding" | "rerank";
  text: string;
  rawResponse: unknown;
  modelId: string;
  opcRequestId: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  inputCharacters: number;
  outputCharacters: number;
  embeddingCount: number;
  embeddingDimensions: number;
  rerankCount: number;
}
