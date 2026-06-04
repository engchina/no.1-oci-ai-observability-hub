use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE, DATE, HOST,
};
use ring::{
    rand::SystemRandom,
    signature::{RsaKeyPair, RSA_PKCS1_SHA256},
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::Instant,
};
use tauri::{AppHandle, Manager};
use url::Url;

const ORACLE_PRICING_API_URL: &str =
    "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/";
const OCI_GENERATIVE_AI_API_VERSION: &str = "20231130";
const OCI_USAGE_API_VERSION: &str = "20200107";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidationResult {
    ready: bool,
    messages: Vec<String>,
}

struct AiHttpResponse {
    body: Value,
    opc_request_id: String,
    latency_ms: u64,
}

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("保存先の確認に失敗しました: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("保存先の作成に失敗しました: {error}"))?;
    Ok(dir.join("oci-ai-observability-state.json"))
}

#[tauri::command]
fn load_app_state(app: AppHandle) -> Result<Value, String> {
    let path = state_file(&app)?;
    if !path.exists() {
        return Ok(json!({}));
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("設定ファイルの読み込みに失敗しました: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("設定ファイルの形式を確認してください: {error}"))
}

#[tauri::command]
fn save_app_state(app: AppHandle, state: Value) -> Result<(), String> {
    let path = state_file(&app)?;
    let content = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("保存データの作成に失敗しました: {error}"))?;
    fs::write(path, content).map_err(|error| format!("設定ファイルの保存に失敗しました: {error}"))
}

#[tauri::command]
fn get_storage_location(app: AppHandle) -> Result<String, String> {
    Ok(state_file(&app)?.to_string_lossy().to_string())
}

fn sanitize_download_file_name(file_name: &str) -> Result<String, String> {
    let mut sanitized = String::new();
    for character in file_name.trim().chars() {
        let safe_character = match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            character if character.is_control() => '_',
            character => character,
        };
        sanitized.push(safe_character);
    }

    if sanitized.trim_matches('_').is_empty() {
        return Err("保存するファイル名を確認できませんでした。".to_string());
    }

    if !sanitized.to_ascii_lowercase().ends_with(".xlsx") {
        sanitized.push_str(".xlsx");
    }

    Ok(sanitized)
}

fn unique_download_path(download_dir: &Path, file_name: &str) -> PathBuf {
    let first_candidate = download_dir.join(file_name);
    if !first_candidate.exists() {
        return first_candidate;
    }

    let source_path = Path::new(file_name);
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("公式コスト明細");
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    for index in 1..10_000 {
        let candidate = download_dir.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    download_dir.join(format!("{stem}-{}{}", Utc::now().timestamp(), extension))
}

fn download_destination_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(download_dir) = app.path().download_dir() {
        return Ok(download_dir);
    }

    if let Some(home_dir) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
        return Ok(PathBuf::from(home_dir).join("Downloads"));
    }

    app.path()
        .app_data_dir()
        .map(|dir| dir.join("downloads"))
        .map_err(|error| format!("Excelの保存先フォルダの確認に失敗しました: {error}"))
}

#[tauri::command]
fn save_base64_to_downloads(
    app: AppHandle,
    file_name: String,
    content_base64: String,
) -> Result<String, String> {
    let safe_file_name = sanitize_download_file_name(&file_name)?;
    let content = general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|error| format!("Excelファイルデータの解析に失敗しました: {error}"))?;
    let download_dir = download_destination_dir(&app)?;
    fs::create_dir_all(&download_dir)
        .map_err(|error| format!("Excelの保存先フォルダの作成に失敗しました: {error}"))?;
    let file_path = unique_download_path(&download_dir, &safe_file_name);
    fs::write(&file_path, content)
        .map_err(|error| format!("Excelファイルの保存に失敗しました: {error}"))?;
    Ok(file_path.to_string_lossy().to_string())
}

fn normalize_currency_code(value: String) -> String {
    let trimmed = value.trim();
    if trimmed.len() == 3
        && trimmed
            .chars()
            .all(|character| character.is_ascii_alphabetic())
    {
        trimmed.to_ascii_uppercase()
    } else {
        "USD".to_string()
    }
}

fn read_setting(settings: &Value, key: &str) -> String {
    settings
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn required_setting(settings: &Value, key: &str, label: &str) -> Result<String, String> {
    let value = read_setting(settings, key);
    if value.is_empty() {
        Err(format!("{label} が未入力です。"))
    } else {
        Ok(value)
    }
}

fn read_request_string(request: &Value, key: &str) -> String {
    request
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn read_request_number(request: &Value, key: &str) -> Option<f64> {
    request.get(key).and_then(Value::as_f64)
}

fn read_request_u64(request: &Value, key: &str) -> Option<u64> {
    request.get(key).and_then(Value::as_u64)
}

fn inference_host(region: &str) -> String {
    format!("inference.generativeai.{region}.oci.oraclecloud.com")
}

fn usage_host(region: &str) -> String {
    format!("usageapi.{region}.oci.oraclecloud.com")
}

fn required_region_setting(
    settings: &Value,
    primary_key: &str,
    label: &str,
) -> Result<String, String> {
    let value = read_setting(settings, primary_key);
    if !value.is_empty() {
        return Ok(value);
    }

    required_setting(settings, "region", label)
}

fn ai_region(settings: &Value, request: &Value) -> Result<String, String> {
    let request_region = read_request_string(request, "region");
    if !request_region.is_empty() {
        return Ok(request_region);
    }

    required_region_setting(settings, "aiRegion", "AI実行リージョン")
}

fn home_region(settings: &Value) -> Result<String, String> {
    required_region_setting(settings, "homeRegion", "Home Region")
}

fn inference_url(settings: &Value, request: &Value, path: &str) -> Result<Url, String> {
    let region = ai_region(settings, request)?;
    let host = inference_host(&region);
    Url::parse(&format!("https://{host}{path}"))
        .map_err(|error| format!("OCI エンドポイントURLの作成に失敗しました: {error}"))
}

fn usage_url(settings: &Value) -> Result<Url, String> {
    let region = home_region(settings)?;
    let host = usage_host(&region);
    Url::parse(&format!("https://{host}/{OCI_USAGE_API_VERSION}/usage"))
        .map_err(|error| format!("OCI Usage API URLの作成に失敗しました: {error}"))
}

fn pem_to_der(private_key_pem: &str) -> Result<Vec<u8>, String> {
    if private_key_pem.contains("ENCRYPTED") {
        return Err(
            "暗号化された秘密鍵 PEM は現在サポートしていません。パスフレーズなしの OCI API 秘密鍵を設定してください。"
                .to_string(),
        );
    }

    let mut body = String::new();
    let mut in_key = false;
    for line in private_key_pem.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("-----BEGIN ") {
            in_key = true;
            continue;
        }
        if trimmed.starts_with("-----END ") {
            break;
        }
        if in_key && !trimmed.is_empty() {
            body.push_str(trimmed);
        }
    }

    if body.is_empty() {
        return Err("秘密鍵 PEM の本文を確認できませんでした。".to_string());
    }

    general_purpose::STANDARD
        .decode(body)
        .map_err(|error| format!("秘密鍵 PEM のBase64解析に失敗しました: {error}"))
}

fn build_rsa_key_pair(private_key_pem: &str) -> Result<RsaKeyPair, String> {
    let der = pem_to_der(private_key_pem)?;
    RsaKeyPair::from_pkcs8(&der)
        .or_else(|_| RsaKeyPair::from_der(&der))
        .map_err(|_| {
            "秘密鍵 PEM は PKCS#8 または PKCS#1 RSA 秘密鍵として読み込めませんでした。".to_string()
        })
}

fn signed_post_headers(settings: &Value, url: &Url, body: &str) -> Result<HeaderMap, String> {
    let tenancy_ocid = required_setting(settings, "tenancyOcid", "テナンシ OCID")?;
    let user_ocid = required_setting(settings, "userOcid", "ユーザー OCID")?;
    let fingerprint = required_setting(settings, "fingerprint", "フィンガープリント")?;
    let private_key_pem = required_setting(settings, "privateKeyPem", "秘密鍵 PEM")?;
    let key_pair = build_rsa_key_pair(&private_key_pem)?;

    let host = url
        .host_str()
        .ok_or_else(|| "OCI エンドポイントのホスト名を確認できませんでした。".to_string())?;
    let path_and_query = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    };
    let date = Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string();
    let content_sha256 = general_purpose::STANDARD.encode(Sha256::digest(body.as_bytes()));
    let content_length = body.as_bytes().len().to_string();
    let signing_headers = "date (request-target) host content-length content-type x-content-sha256";
    let signing_string = format!(
        "date: {date}\n(request-target): post {path_and_query}\nhost: {host}\ncontent-length: {content_length}\ncontent-type: application/json\nx-content-sha256: {content_sha256}"
    );

    let rng = SystemRandom::new();
    let mut signature = vec![0; key_pair.public().modulus_len()];
    key_pair
        .sign(
            &RSA_PKCS1_SHA256,
            &rng,
            signing_string.as_bytes(),
            &mut signature,
        )
        .map_err(|_| "OCI API 署名の作成に失敗しました。".to_string())?;
    let signature = general_purpose::STANDARD.encode(signature);
    let authorization = format!(
        "Signature version=\"1\",keyId=\"{tenancy_ocid}/{user_ocid}/{fingerprint}\",algorithm=\"rsa-sha256\",headers=\"{signing_headers}\",signature=\"{signature}\""
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        DATE,
        HeaderValue::from_str(&date).map_err(|error| error.to_string())?,
    );
    headers.insert(
        HOST,
        HeaderValue::from_str(host).map_err(|error| error.to_string())?,
    );
    headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&content_length).map_err(|error| error.to_string())?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-content-sha256",
        HeaderValue::from_str(&content_sha256).map_err(|error| error.to_string())?,
    );
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&authorization).map_err(|error| error.to_string())?,
    );
    Ok(headers)
}

async fn post_json_with_oci_signature(
    settings: &Value,
    request: &Value,
    path: &str,
    body: Value,
) -> Result<AiHttpResponse, String> {
    let url = inference_url(settings, request, path)?;
    post_json_to_oci_url_with_signature(settings, url, body, "OCI Generative AI").await
}

async fn post_json_to_oci_url_with_signature(
    settings: &Value,
    url: Url,
    body: Value,
    service_label: &str,
) -> Result<AiHttpResponse, String> {
    let body_text = serde_json::to_string(&body)
        .map_err(|error| format!("OCI リクエストJSONの作成に失敗しました: {error}"))?;
    let headers = signed_post_headers(settings, &url, &body_text)?;
    let client = reqwest::Client::builder()
        .user_agent("no1-oci-ai-observability-hub/0.1")
        .build()
        .map_err(|error| {
            format!("{service_label} 呼び出しクライアントの作成に失敗しました: {error}")
        })?;

    let started_at = Instant::now();
    let response = client
        .post(url)
        .headers(headers)
        .body(body_text)
        .send()
        .await
        .map_err(|error| format!("{service_label} の呼び出しに失敗しました: {error}"))?;
    read_oci_response(response, started_at, service_label).await
}

async fn read_oci_response(
    response: reqwest::Response,
    started_at: Instant,
    service_label: &str,
) -> Result<AiHttpResponse, String> {
    let latency_ms = started_at.elapsed().as_millis() as u64;
    let status = response.status();
    let opc_request_id = response
        .headers()
        .get("opc-request-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("OCI レスポンスの読み込みに失敗しました: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "{service_label} の呼び出しに失敗しました。HTTP {status}: {response_text}"
        ));
    }

    let body = serde_json::from_str::<Value>(&response_text)
        .unwrap_or_else(|_| json!({ "text": response_text }));

    Ok(AiHttpResponse {
        body,
        opc_request_id,
        latency_ms,
    })
}

fn native_serving_mode(request: &Value) -> Result<Value, String> {
    let model_id = read_request_string(request, "modelId");
    if model_id.is_empty() {
        return Err("モデルIDが未入力です。".to_string());
    }

    Ok(json!({
        "servingType": "ON_DEMAND",
        "modelId": model_id
    }))
}

fn build_native_chat_body(settings: &Value, request: &Value) -> Result<Value, String> {
    let compartment_id = read_request_string(request, "compartmentOcid");
    let compartment_id = if compartment_id.is_empty() {
        required_setting(settings, "defaultCompartmentOcid", "Compartment OCID")?
    } else {
        compartment_id
    };
    let prompt = read_request_string(request, "prompt");
    if prompt.is_empty() {
        return Err("プロンプトが未入力です。".to_string());
    }

    let mut messages = Vec::new();
    let system_prompt = read_request_string(request, "systemPrompt");
    if !system_prompt.is_empty() {
        messages.push(json!({
            "role": "SYSTEM",
            "content": [{ "type": "TEXT", "text": system_prompt }]
        }));
    }
    messages.push(json!({
        "role": "USER",
        "content": [{ "type": "TEXT", "text": prompt }]
    }));

    let mut chat_request = json!({
        "apiFormat": "GENERIC",
        "messages": messages,
        "isStream": false
    });

    if let Some(temperature) = read_request_number(request, "temperature") {
        chat_request["temperature"] = json!(temperature);
    }
    if let Some(top_p) = read_request_number(request, "topP") {
        chat_request["topP"] = json!(top_p);
    }
    if let Some(max_tokens) = read_request_u64(request, "maxTokens") {
        if max_tokens > 0 {
            chat_request["maxTokens"] = json!(max_tokens);
        }
    }

    Ok(json!({
        "compartmentId": compartment_id,
        "servingMode": native_serving_mode(request)?,
        "chatRequest": chat_request
    }))
}

fn build_embedding_body(settings: &Value, request: &Value) -> Result<Value, String> {
    let compartment_id = read_request_string(request, "compartmentOcid");
    let compartment_id = if compartment_id.is_empty() {
        required_setting(settings, "defaultCompartmentOcid", "Compartment OCID")?
    } else {
        compartment_id
    };
    let input = read_request_string(request, "input");
    if input.is_empty() {
        return Err("Embedding入力テキストが未入力です。".to_string());
    }
    let inputs: Vec<String> = input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect();
    if inputs.is_empty() {
        return Err("Embedding入力テキストが未入力です。".to_string());
    }

    Ok(json!({
        "compartmentId": compartment_id,
        "servingMode": native_serving_mode(request)?,
        "inputs": inputs,
        "truncate": read_request_string(request, "truncate").if_empty("END"),
        "inputType": read_request_string(request, "inputType").if_empty("SEARCH_DOCUMENT"),
        "isEcho": true
    }))
}

fn read_rerank_documents(request: &Value) -> Result<Vec<String>, String> {
    let input = read_request_string(request, "documents");
    if input.is_empty() {
        return Err("候補文書が未入力です。".to_string());
    }

    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let block_documents: Vec<String> = normalized
        .split("\n\n")
        .map(str::trim)
        .filter(|document| !document.is_empty())
        .map(ToString::to_string)
        .collect();
    let documents = if block_documents.len() > 1 {
        block_documents
    } else {
        normalized
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect()
    };

    if documents.is_empty() {
        Err("候補文書が未入力です。".to_string())
    } else {
        Ok(documents)
    }
}

fn build_rerank_body(settings: &Value, request: &Value) -> Result<Value, String> {
    let compartment_id = read_request_string(request, "compartmentOcid");
    let compartment_id = if compartment_id.is_empty() {
        required_setting(settings, "defaultCompartmentOcid", "Compartment OCID")?
    } else {
        compartment_id
    };
    let input = read_request_string(request, "input");
    if input.is_empty() {
        return Err("検索クエリが未入力です。".to_string());
    }
    let documents = read_rerank_documents(request)?;
    let document_count = documents.len() as u64;

    let mut body = json!({
        "compartmentId": compartment_id,
        "servingMode": native_serving_mode(request)?,
        "input": input,
        "documents": documents,
        "isEcho": true
    });

    if let Some(top_n) = read_request_u64(request, "topN") {
        if top_n > 0 {
            body["topN"] = json!(top_n.min(document_count));
        }
    }
    if let Some(max_chunks) = read_request_u64(request, "maxChunksPerDocument") {
        if max_chunks > 0 {
            body["maxChunksPerDocument"] = json!(max_chunks);
        }
    }
    if let Some(max_tokens) = read_request_u64(request, "maxTokensPerDocument") {
        if max_tokens > 0 {
            body["maxTokensPerDocument"] = json!(max_tokens);
        }
    }

    Ok(body)
}

fn read_usage_time(request: &Value, key: &str, label: &str) -> Result<String, String> {
    let value = read_request_string(request, key);
    if value.is_empty() {
        Err(format!("{label} が未入力です。"))
    } else {
        Ok(value)
    }
}

fn read_usage_granularity(request: &Value) -> String {
    match read_request_string(request, "granularity")
        .to_ascii_uppercase()
        .as_str()
    {
        "MONTHLY" => "MONTHLY".to_string(),
        _ => "DAILY".to_string(),
    }
}

fn read_usage_group_by(request: &Value) -> Vec<String> {
    let group_by: Vec<String> = request
        .get("groupBy")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .take(4)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default();

    if group_by.is_empty() {
        vec![
            "service".to_string(),
            "skuName".to_string(),
            "compartmentId".to_string(),
            "region".to_string(),
        ]
    } else {
        group_by
    }
}

fn read_service_filters(request: &Value) -> Vec<String> {
    read_request_string(request, "serviceFilter")
        .split(|character| character == ',' || character == '\n' || character == '\r')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .take(8)
        .map(ToString::to_string)
        .collect()
}

fn usage_service_filter(value: &str) -> Value {
    json!({
        "operator": "AND",
        "dimensions": [{ "key": "service", "value": value }],
        "tags": [],
        "filters": []
    })
}

fn build_usage_filter(request: &Value) -> Option<Value> {
    let filters = read_service_filters(request);
    match filters.len() {
        0 => None,
        1 => Some(usage_service_filter(&filters[0])),
        _ => Some(json!({
            "operator": "OR",
            "dimensions": [],
            "tags": [],
            "filters": filters.iter().map(|value| usage_service_filter(value)).collect::<Vec<Value>>()
        })),
    }
}

fn read_compartment_depth(request: &Value) -> u64 {
    request
        .get("compartmentDepth")
        .and_then(Value::as_u64)
        .unwrap_or(6)
        .clamp(1, 6)
}

fn build_usage_cost_body(settings: &Value, request: &Value) -> Result<Value, String> {
    let tenancy_ocid = required_setting(settings, "tenancyOcid", "テナンシ OCID")?;
    let mut body = json!({
        "tenantId": tenancy_ocid,
        "timeUsageStarted": read_usage_time(request, "timeUsageStarted", "公式コスト取得の開始日時")?,
        "timeUsageEnded": read_usage_time(request, "timeUsageEnded", "公式コスト取得の終了日時")?,
        "granularity": read_usage_granularity(request),
        "queryType": "COST",
        "groupBy": read_usage_group_by(request),
        "compartmentDepth": read_compartment_depth(request)
    });

    if let Some(filter) = build_usage_filter(request) {
        body["filter"] = filter;
    }

    Ok(body)
}

trait EmptyFallback {
    fn if_empty(self, fallback: &str) -> String;
}

impl EmptyFallback for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for part in path {
        if let Ok(index) = part.parse::<usize>() {
            current = current.as_array()?.get(index)?;
        } else {
            current = current.get(*part)?;
        }
    }
    Some(current)
}

fn number_at_any_path(value: &Value, paths: &[&[&str]]) -> u64 {
    paths
        .iter()
        .find_map(|path| {
            let value = value_at_path(value, path)?;
            value
                .as_u64()
                .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
                .or_else(|| value.as_f64().map(|number| number.max(0.0).round() as u64))
        })
        .unwrap_or(0)
}

fn string_at_any_path(value: &Value, paths: &[&[&str]]) -> String {
    paths
        .iter()
        .find_map(|path| value_at_path(value, path).and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

fn collect_text(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            if !text.trim().is_empty() {
                output.push(text.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text(item, output);
            }
        }
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    output.push(text.to_string());
                    return;
                }
            }
            if let Some(content) = map.get("content") {
                collect_text(content, output);
            }
            if let Some(output_text) = map.get("output_text") {
                collect_text(output_text, output);
            }
        }
        _ => {}
    }
}

fn extract_chat_text(value: &Value) -> String {
    for path in [
        &["chatResponse", "choices", "0", "message", "content"][..],
        &["choices", "0", "message", "content"][..],
        &["output_text"][..],
        &["output", "0", "content"][..],
        &["text"][..],
    ] {
        if let Some(target) = value_at_path(value, path) {
            let mut parts = Vec::new();
            collect_text(target, &mut parts);
            let text = parts.join("\n").trim().to_string();
            if !text.is_empty() {
                return text;
            }
        }
    }
    String::new()
}

fn embedding_shape(value: &Value) -> (usize, usize) {
    let embeddings = value
        .get("embeddings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let dimensions = embeddings
        .first()
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    (embeddings.len(), dimensions)
}

fn rerank_ranks(value: &Value) -> Vec<Value> {
    [
        &["documentRanks"][..],
        &["rerankTextResult", "documentRanks"][..],
    ]
    .iter()
    .find_map(|path| {
        value_at_path(value, path)
            .and_then(Value::as_array)
            .cloned()
    })
    .unwrap_or_default()
}

fn format_score(value: &Value) -> String {
    value
        .as_f64()
        .map(|score| format!("{score:.6}"))
        .unwrap_or_else(|| "-".to_string())
}

fn format_rerank_text(value: &Value) -> String {
    let ranks = rerank_ranks(value);
    if ranks.is_empty() {
        return "Rerank結果を取得しました。Raw JSONを確認してください。".to_string();
    }

    let mut lines = vec![format!("{} 件の候補文書を並べ替えました。", ranks.len())];
    for (position, rank) in ranks.iter().enumerate() {
        let index = rank
            .get("index")
            .and_then(Value::as_i64)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string());
        let score = rank
            .get("relevanceScore")
            .map(format_score)
            .unwrap_or_else(|| "-".to_string());
        lines.push(format!(
            "{}. index {} / score {}",
            position + 1,
            index,
            score
        ));

        let document_text = value_at_path(rank, &["document", "text"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if !document_text.is_empty() {
            lines.push(document_text.to_string());
        }
    }

    lines.join("\n")
}

fn wrap_ai_result(kind: &str, request: &Value, response: AiHttpResponse) -> Value {
    let is_embedding = kind == "embedding";
    let is_rerank = kind == "rerank";
    let (embedding_count, embedding_dimensions) = if is_embedding {
        embedding_shape(&response.body)
    } else {
        (0, 0)
    };
    let rerank_count = if is_rerank {
        rerank_ranks(&response.body).len()
    } else {
        0
    };
    let text = if is_embedding {
        format!("{embedding_count} 件のベクトルを生成しました（{embedding_dimensions} 次元）。")
    } else if is_rerank {
        format_rerank_text(&response.body)
    } else {
        extract_chat_text(&response.body)
    };
    let prompt_tokens = number_at_any_path(
        &response.body,
        &[
            &["chatResponse", "usage", "promptTokens"],
            &["chatResponse", "usage", "prompt_tokens"],
            &["usage", "promptTokens"],
            &["usage", "prompt_tokens"],
            &["choices", "0", "usage", "promptTokens"],
            &["choices", "0", "usage", "prompt_tokens"],
        ],
    );
    let completion_tokens = number_at_any_path(
        &response.body,
        &[
            &["chatResponse", "usage", "completionTokens"],
            &["chatResponse", "usage", "completion_tokens"],
            &["usage", "completionTokens"],
            &["usage", "completion_tokens"],
            &["choices", "0", "usage", "completionTokens"],
            &["choices", "0", "usage", "completion_tokens"],
        ],
    );
    let model_id = string_at_any_path(&response.body, &[&["modelId"], &["model_id"], &["model"]])
        .if_empty(&read_request_string(request, "modelId"));
    let input_text = if is_rerank {
        [
            read_request_string(request, "input"),
            read_request_string(request, "documents"),
        ]
        .join("\n")
    } else {
        read_request_string(request, "prompt").if_empty(&read_request_string(request, "input"))
    };

    json!({
        "kind": kind,
        "text": text,
        "rawResponse": response.body,
        "modelId": model_id,
        "opcRequestId": response.opc_request_id,
        "latencyMs": response.latency_ms,
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "inputCharacters": input_text.chars().count(),
        "outputCharacters": if is_embedding || is_rerank { 0 } else { text.chars().count() },
        "embeddingCount": embedding_count,
        "embeddingDimensions": embedding_dimensions,
        "rerankCount": rerank_count
    })
}

#[tauri::command]
async fn fetch_oracle_pricing(currency_code: String) -> Result<Value, String> {
    let currency_code = normalize_currency_code(currency_code);
    let url = format!("{ORACLE_PRICING_API_URL}?currencyCode={currency_code}");
    let client = reqwest::Client::builder()
        .user_agent("no1-oci-ai-observability-hub/0.1")
        .build()
        .map_err(|error| format!("Oracle公式価格取得クライアントの作成に失敗しました: {error}"))?;

    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Oracle公式価格の取得に失敗しました: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Oracle公式価格の取得に失敗しました。HTTP {status}"));
    }

    response
        .json::<Value>()
        .await
        .map_err(|error| format!("Oracle公式価格JSONの解析に失敗しました: {error}"))
}

#[tauri::command]
async fn fetch_oci_usage_costs(settings: Value, request: Value) -> Result<Value, String> {
    let url = usage_url(&settings)?;
    let body = build_usage_cost_body(&settings, &request)?;
    let response =
        post_json_to_oci_url_with_signature(&settings, url, body, "OCI Usage API").await?;
    Ok(response.body)
}

#[tauri::command]
async fn run_oci_generative_ai_chat(settings: Value, request: Value) -> Result<Value, String> {
    let body = build_native_chat_body(&settings, &request)?;
    let response = post_json_with_oci_signature(
        &settings,
        &request,
        &format!("/{OCI_GENERATIVE_AI_API_VERSION}/actions/chat"),
        body,
    )
    .await?;
    Ok(wrap_ai_result("native-chat", &request, response))
}

#[tauri::command]
async fn run_oci_embedding(settings: Value, request: Value) -> Result<Value, String> {
    let body = build_embedding_body(&settings, &request)?;
    let response = post_json_with_oci_signature(
        &settings,
        &request,
        &format!("/{OCI_GENERATIVE_AI_API_VERSION}/actions/embedText"),
        body,
    )
    .await?;
    Ok(wrap_ai_result("embedding", &request, response))
}

#[tauri::command]
async fn run_oci_rerank(settings: Value, request: Value) -> Result<Value, String> {
    let body = build_rerank_body(&settings, &request)?;
    let response = post_json_with_oci_signature(
        &settings,
        &request,
        &format!("/{OCI_GENERATIVE_AI_API_VERSION}/actions/rerankText"),
        body,
    )
    .await?;
    Ok(wrap_ai_result("rerank", &request, response))
}

#[tauri::command]
fn validate_oci_settings(settings: Value) -> ValidationResult {
    let mut messages = Vec::new();
    let required = [
        ("テナンシ OCID", "tenancyOcid"),
        ("ユーザー OCID", "userOcid"),
        ("フィンガープリント", "fingerprint"),
        ("Home Region", "homeRegion"),
        ("AI実行リージョン", "aiRegion"),
        ("秘密鍵 PEM", "privateKeyPem"),
        ("既定チャットモデルID", "defaultChatModelId"),
        ("既定EmbeddingモデルID", "defaultEmbeddingModelId"),
        ("既定RerankモデルID", "defaultRerankModelId"),
        ("Enterprise AI Base URL", "enterpriseAiBaseUrl"),
    ];

    for (label, key) in required {
        let value = read_setting(&settings, key);
        let legacy_region = if key == "homeRegion" || key == "aiRegion" {
            read_setting(&settings, "region")
        } else {
            String::new()
        };
        if value.trim().is_empty() && legacy_region.is_empty() {
            messages.push(format!("{label} が未入力です。"));
        }
    }

    if let Some(private_key) = settings.get("privateKeyPem").and_then(Value::as_str) {
        if !private_key.trim().is_empty() && !private_key.contains("BEGIN") {
            messages.push("秘密鍵 PEM の形式を確認してください。".to_string());
        }
    }

    if messages.is_empty() {
        messages.push("OCI API 設定は保存されています。".to_string());
    }

    ValidationResult {
        ready: messages.len() == 1 && messages[0] == "OCI API 設定は保存されています。",
        messages,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/128x128.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_app_state,
            get_storage_location,
            save_base64_to_downloads,
            fetch_oracle_pricing,
            fetch_oci_usage_costs,
            run_oci_generative_ai_chat,
            run_oci_embedding,
            run_oci_rerank,
            validate_oci_settings
        ])
        .run(tauri::generate_context!())
        .expect("アプリケーションの起動に失敗しました。");
}
// Updated app icon resource.
