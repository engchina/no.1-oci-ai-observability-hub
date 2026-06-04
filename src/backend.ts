import { invoke } from "@tauri-apps/api/core";
import type {
  AppState,
  OciAiRunRequest,
  OciAiRunResult,
  OciUsageCostRequest,
  OraclePricingResponse,
  ValidationResult
} from "./types";
import { defaultState, mergeState, validateSettings } from "./domain";

const STORAGE_KEY = "no1-oci-ai-observability-hub-state";
export const ORACLE_PRICING_API_URL = "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const loadAppState = async (): Promise<AppState> => {
  if (isTauri()) {
    const state = await invoke<Partial<AppState>>("load_app_state");
    return mergeState(state);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? mergeState(JSON.parse(raw)) : defaultState;
};

export const saveAppState = async (state: AppState) => {
  if (isTauri()) {
    await invoke("save_app_state", { state });
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const validateOciSettings = async (state: AppState): Promise<ValidationResult> => {
  if (isTauri()) {
    return invoke<ValidationResult>("validate_oci_settings", { settings: state.settings });
  }

  return validateSettings(state.settings);
};

export const fetchOraclePricing = async (currencyCode = "USD"): Promise<OraclePricingResponse> => {
  const normalizedCurrency = currencyCode.trim().toUpperCase() || "USD";
  if (isTauri()) {
    return invoke<OraclePricingResponse>("fetch_oracle_pricing", {
      currencyCode: normalizedCurrency,
      currency_code: normalizedCurrency
    });
  }

  const url = new URL(ORACLE_PRICING_API_URL);
  url.searchParams.set("currencyCode", normalizedCurrency);
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Oracle公式価格の取得に失敗しました。HTTP ${response.status}`);
  }

  return response.json() as Promise<OraclePricingResponse>;
};

export const fetchOciUsageCosts = async (
  state: AppState,
  request: OciUsageCostRequest
): Promise<unknown> => {
  if (isTauri()) {
    return invoke("fetch_oci_usage_costs", { settings: state.settings, request });
  }

  throw new Error("OCI Usage API の取得はデスクトップアプリから利用してください。");
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export const saveOfficialCostExcel = async (
  fileName: string,
  content: Uint8Array,
  contentType: string
): Promise<string> => {
  if (isTauri()) {
    const contentBase64 = bytesToBase64(content);
    return invoke<string>("save_base64_to_downloads", {
      fileName,
      file_name: fileName,
      contentBase64,
      content_base64: contentBase64
    });
  }

  const browserContent = new Uint8Array(content.length);
  browserContent.set(content);
  const blob = new Blob([browserContent.buffer], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return fileName;
};

export const getStorageLocation = async () => {
  if (isTauri()) {
    return invoke<string>("get_storage_location");
  }

  return "ブラウザのローカルストレージ";
};

const desktopOnly = () => {
  throw new Error("OCI Generative AI の実行はデスクトップアプリから利用してください。");
};

export const runOciGenerativeAiChat = async (
  state: AppState,
  request: OciAiRunRequest
): Promise<OciAiRunResult> => {
  if (isTauri()) {
    return invoke<OciAiRunResult>("run_oci_generative_ai_chat", { settings: state.settings, request });
  }

  return desktopOnly();
};

export const runOciEnterpriseAiChat = async (
  state: AppState,
  request: OciAiRunRequest
): Promise<OciAiRunResult> => {
  if (isTauri()) {
    return invoke<OciAiRunResult>("run_oci_enterprise_ai_chat", { settings: state.settings, request });
  }

  return desktopOnly();
};

export const runOciEmbedding = async (
  state: AppState,
  request: OciAiRunRequest
): Promise<OciAiRunResult> => {
  if (isTauri()) {
    return invoke<OciAiRunResult>("run_oci_embedding", { settings: state.settings, request });
  }

  return desktopOnly();
};

export const runOciRerank = async (
  state: AppState,
  request: OciAiRunRequest
): Promise<OciAiRunResult> => {
  if (isTauri()) {
    return invoke<OciAiRunResult>("run_oci_rerank", { settings: state.settings, request });
  }

  return desktopOnly();
};
