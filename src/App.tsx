import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  CloudDownload,
  DatabaseZap,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  Gauge,
  Hash,
  Info,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  MapPin,
  ReceiptText,
  RefreshCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  type LucideIcon,
  Workflow,
  Trash2,
  X
} from "lucide-react";
import {
  addActivity,
  buildGenerativeAiBaseUrl,
  buildOfficialPricingRules,
  createId,
  DEFAULT_OCI_REGION,
  defaultState,
  estimateCost,
  filterGenerativeAiOfficialCosts,
  formatDateTime,
  formatNumber,
  formatUsd,
  nowIso,
  parseOfficialCostJson,
  recalculateUsageCosts,
  reconcileOfficialCosts,
  summarize,
  validateSettings
} from "./domain";
import {
  fetchOraclePricing,
  fetchOciUsageCosts,
  getStorageLocation,
  loadAppState,
  runOciEmbedding,
  runOciGenerativeAiChat,
  runOciRerank,
  saveOfficialCostExcel,
  saveAppState,
  validateOciSettings
} from "./backend";
import type {
  AppState,
  OfficialCostItem,
  OciAiRunRequest,
  OciAiRunResult,
  OciUsageCostRequest,
  OciUsageGranularity,
  PricingRule,
  UsageRecord,
  ViewId
} from "./types";
import brandIcon from "./assets/icon.png";

const navItems: Array<{ id: ViewId; label: string; caption: string; icon: LucideIcon }> = [
  { id: "dashboard", label: "概要", caption: "全体状況", icon: LayoutDashboard },
  { id: "ai", label: "AI実行", caption: "実行と記録", icon: Bot },
  { id: "usage", label: "使用量", caption: "実行ログ", icon: Activity },
  { id: "official", label: "コスト照合", caption: "Usage API", icon: ReceiptText },
  { id: "settings", label: "設定", caption: "認証・価格", icon: KeyRound }
];

const statusOptions: UsageRecord["status"][] = ["成功", "クライアントエラー", "サーバーエラー", "確認待ち"];
type AiRunMode = "native-chat" | "embedding" | "rerank";
type DashboardNextAction = {
  title: string;
  description: string;
  buttonLabel: string;
  view: ViewId;
  icon: LucideIcon;
  tone: "blue" | "green" | "amber" | "neutral";
};
type TopbarAction = {
  label: string;
  view: ViewId;
  icon: LucideIcon;
  variant: "primary" | "secondary";
};
type SetupGuideStep = {
  title: string;
  description: string;
  actionLabel: string;
  href: string;
  ready: boolean;
  icon: LucideIcon;
};
type NoticeTone = "neutral" | "success" | "warning" | "error" | "busy";
type OfficialUsageQuery = {
  startDate: string;
  endDate: string;
  granularity: OciUsageGranularity;
  serviceFilter: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OFFICIAL_COST_PAGE_SIZE = 20;
const DEFAULT_OFFICIAL_USAGE_GROUP_BY = ["service", "skuName", "compartmentId", "region"];
const DEFAULT_OFFICIAL_SERVICE_FILTER = "Generative AI, OCI Generative AI, GENERATIVE_AI";
const WEEKDAY_LABELS_JA = ["日", "月", "火", "水", "木", "金", "土"];

const aiModeLabels: Record<AiRunMode, string> = {
  "native-chat": "OCI Generative AI Chat",
  embedding: "OCI Generative AI Embedding",
  rerank: "OCI Generative AI Rerank"
};

const aiModeShortLabels: Record<AiRunMode, string> = {
  "native-chat": "Chat",
  embedding: "Embedding",
  rerank: "Rerank"
};

function formatDateInputValue(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getHomeRegion(settings: AppState["settings"]) {
  return (settings.homeRegion || settings.region || "").trim();
}

function getAiRegion(settings: AppState["settings"]) {
  return (settings.aiRegion || settings.region || "").trim();
}

function getAiRequestRegion(settings: AppState["settings"], request?: OciAiRunRequest) {
  return (request?.region || getAiRegion(settings) || DEFAULT_OCI_REGION).trim();
}

function extractGenerativeAiRegion(baseUrl: string) {
  const match = baseUrl.match(/inference\.generativeai\.([a-z0-9-]+)\.oci\.oraclecloud\.com/i);
  return match?.[1] ?? "";
}

function readDateInputValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function createUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function createTodayDate() {
  const today = new Date();
  return createUtcDate(today.getFullYear(), today.getMonth(), today.getDate());
}

function addUtcDays(date: Date, days: number) {
  const nextDate = new Date(date.getTime());
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function getMonthAnchor(date: Date) {
  return createUtcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function formatDateLabel(value: string) {
  const date = readDateInputValue(value);
  if (!date) return "日付を選択";
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatCalendarMonth(date: Date) {
  return `${date.getUTCFullYear()}年 ${date.getUTCMonth() + 1}月`;
}

function isSameUtcDay(left: Date, right: Date) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function buildCalendarDays(monthDate: Date) {
  const monthStart = getMonthAnchor(monthDate);
  const gridStart = addUtcDays(monthStart, -monthStart.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => addUtcDays(gridStart, index));
}

function createDefaultOfficialUsageQuery(): OfficialUsageQuery {
  const today = new Date();
  const endDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const startDate = addUtcDays(endDate, -30);
  return {
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
    granularity: "DAILY",
    serviceFilter: DEFAULT_OFFICIAL_SERVICE_FILTER
  };
}

function buildOciUsageCostRequest(query: OfficialUsageQuery): OciUsageCostRequest {
  const startDate = readDateInputValue(query.startDate);
  const endDate = readDateInputValue(query.endDate);
  if (!startDate || !endDate) {
    throw new Error("公式コスト取得の開始日と終了日を確認してください。");
  }
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error("公式コスト取得の終了日は開始日以降にしてください。");
  }

  if (query.granularity === "MONTHLY") {
    const started = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
    const ended = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1));
    const monthSpan =
      (ended.getUTCFullYear() - started.getUTCFullYear()) * 12 +
      ended.getUTCMonth() -
      started.getUTCMonth();
    if (monthSpan > 12) {
      throw new Error("月次の公式コスト取得は12か月以内で指定してください。");
    }
    return {
      timeUsageStarted: `${formatDateInputValue(started)}T00:00:00Z`,
      timeUsageEnded: `${formatDateInputValue(ended)}T00:00:00Z`,
      granularity: query.granularity,
      serviceFilter: query.serviceFilter,
      compartmentDepth: 6,
      groupBy: DEFAULT_OFFICIAL_USAGE_GROUP_BY
    };
  }

  const daySpan = Math.floor((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) + 1;
  if (daySpan > 90) {
    throw new Error("日次の公式コスト取得は90日以内で指定してください。");
  }

  return {
    timeUsageStarted: `${query.startDate}T00:00:00Z`,
    timeUsageEnded: `${formatDateInputValue(addUtcDays(endDate, 1))}T00:00:00Z`,
    granularity: query.granularity,
    serviceFilter: query.serviceFilter,
    compartmentDepth: 6,
    groupBy: DEFAULT_OFFICIAL_USAGE_GROUP_BY
  };
}

function getDashboardNextAction({
  settingsReady,
  hasOfficialPricing,
  hasAiUsage,
  hasUsage,
  hasOfficialCost,
  reconciliationPercent
}: {
  settingsReady: boolean;
  hasOfficialPricing: boolean;
  hasAiUsage: boolean;
  hasUsage: boolean;
  hasOfficialCost: boolean;
  reconciliationPercent: number;
}): DashboardNextAction {
  if (!settingsReady) {
    return {
      title: "OCI設定を完了",
      description: "APIキー、リージョン、Generative AI の既定モデルを保存すると AI 実行と価格取得を進められます。",
      buttonLabel: "設定へ",
      view: "settings",
      icon: ShieldCheck,
      tone: "amber"
    };
  }

  if (!hasOfficialPricing) {
    return {
      title: "公式価格を取得",
      description: "Oracle公式価格APIからオンデマンド単価を取り込み、使用量レコードの参考金額を公式ルールへ揃えます。",
      buttonLabel: "価格設定へ",
      view: "settings",
      icon: CircleDollarSign,
      tone: "amber"
    };
  }

  if (!hasAiUsage) {
    return {
      title: "AI実行を記録",
      description: "Chat または Embedding を実行し、レスポンスから使用量レコードを自動作成します。",
      buttonLabel: "AI実行へ",
      view: "ai",
      icon: Bot,
      tone: "blue"
    };
  }

  if (!hasUsage) {
    return {
      title: "使用量を自動記録",
      description: "AI実行を行うと、Request ID、Enterprise AI Project、トークン数、文字数を使用量へ保存します。",
      buttonLabel: "AI実行へ",
      view: "ai",
      icon: Bot,
      tone: "blue"
    };
  }

  if (!hasOfficialCost) {
    return {
      title: "公式コストを取得",
      description: "OCI Usage API から公式コストを取得し、使用量レコードとの照合状態を確認します。",
      buttonLabel: "コスト照合へ",
      view: "official",
      icon: CloudDownload,
      tone: "amber"
    };
  }

  if (reconciliationPercent <= 0) {
    return {
      title: "公式金額を按分",
      description: "公式コストを使用量レコードへ按分し、未照合金額を減らします。",
      buttonLabel: "照合へ",
      view: "official",
      icon: Workflow,
      tone: "amber"
    };
  }

  return {
    title: "運用状況を確認",
    description: "照合済みレコード、エラー、モデル別コストを確認して次の調整点を探します。",
    buttonLabel: "使用量を見る",
    view: "usage",
    icon: CheckCircle2,
    tone: "green"
  };
}

function getTopbarActions(activeView: ViewId, settingsReady: boolean): TopbarAction[] {
  if (activeView === "dashboard") {
    return [];
  }

  if (!settingsReady && activeView !== "settings") {
    return [{ label: "OCI設定へ", view: "settings", icon: ShieldCheck, variant: "primary" }];
  }

  switch (activeView) {
    case "usage":
      return [
        { label: "AI実行", view: "ai", icon: Bot, variant: "primary" },
        { label: "コスト照合", view: "official", icon: ReceiptText, variant: "secondary" }
      ];
    case "official":
      return [
        { label: "使用量を確認", view: "usage", icon: Activity, variant: "primary" },
        { label: "設定", view: "settings", icon: Settings, variant: "secondary" }
      ];
    case "ai":
      return [
        { label: "使用量を確認", view: "usage", icon: Activity, variant: "primary" },
        { label: "設定", view: "settings", icon: Settings, variant: "secondary" }
      ];
    case "settings":
      return settingsReady ? [{ label: "AI実行", view: "ai", icon: Bot, variant: "primary" }] : [];
    default:
      return [];
  }
}

function resetViewportScroll() {
  const scrollToTop = () => {
    document.querySelector<HTMLElement>(".workspace")?.scrollTo({ top: 0, left: 0 });
    window.scrollTo({ top: 0, left: 0 });
  };

  scrollToTop();
  window.requestAnimationFrame(scrollToTop);
  window.setTimeout(scrollToTop, 0);
}

function getNoticeTone(message: string, isBusy: boolean): NoticeTone {
  if (isBusy || /しています|取得中|実行中|読み込み中/.test(message)) return "busy";
  if (/失敗|エラー/.test(message)) return "error";
  if (/確認できません|ありません|未入力|必要|待ち/.test(message)) return "warning";
  if (/保存|ダウンロード|追加|削除|取り込み|更新|按分|記録|準備できました|保存されています/.test(message)) return "success";
  return "neutral";
}

function shouldShowToast(message: string, tone: NoticeTone) {
  if (!message || message === "読み込み中です。") return false;
  return tone !== "neutral";
}

function getNoticeIcon(tone: NoticeTone) {
  if (tone === "success") return CheckCircle2;
  if (tone === "warning" || tone === "error") return AlertTriangle;
  if (tone === "busy") return RefreshCcw;
  return Info;
}

function getNoticeTitle(tone: NoticeTone) {
  if (tone === "success") return "完了";
  if (tone === "warning") return "確認が必要";
  if (tone === "error") return "エラー";
  if (tone === "busy") return "処理中";
  return "情報";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type ExcelCellValue = string | number;
type ZipSource = {
  path: string;
  content: string | Uint8Array;
};

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_UTF8_FLAG = 0x0800;
const textEncoder = new TextEncoder();

function xlsxCell(value: ExcelCellValue, rowIndex: number, columnIndex: number) {
  const reference = `${xlsxColumnName(columnIndex)}${rowIndex}`;
  if (typeof value === "number") {
    const safeNumber = Number.isFinite(value) ? value : 0;
    return `<c r="${reference}"><v>${safeNumber}</v></c>`;
  }

  const preserveSpace = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}" t="inlineStr"><is><t${preserveSpace}>${escapeXml(value)}</t></is></c>`;
}

function xlsxRow(values: ExcelCellValue[], rowIndex: number) {
  return `<row r="${rowIndex}">${values.map((value, columnIndex) => xlsxCell(value, rowIndex, columnIndex)).join("")}</row>`;
}

function xlsxColumnName(columnIndex: number) {
  let index = columnIndex + 1;
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function buildOfficialCostRows(items: OfficialCostItem[]): ExcelCellValue[][] {
  const headers = [
    "期間開始",
    "期間終了",
    "サービス",
    "SKU",
    "Project名",
    "Project OCID",
    "リージョン",
    "Compartment OCID",
    "リソース OCID",
    "使用量",
    "使用量単位",
    "金額USD",
    "ソース"
  ];

  return [
    headers,
    ...items.map((item) => [
      item.timeStarted || "",
      item.timeEnded || "",
      item.service || "",
      item.skuName || "",
      item.projectName || "",
      item.projectOcid || "",
      item.region || "",
      item.compartmentOcid || "",
      item.resourceOcid || "",
      item.usageQuantity,
      item.usageUnit || "",
      item.computedAmountUsd,
      item.source || ""
    ])
  ];
}

function buildOfficialCostXlsx(items: OfficialCostItem[]) {
  const rows = buildOfficialCostRows(items);
  const lastColumn = xlsxColumnName(rows[0].length - 1);
  const dimension = `A1:${lastColumn}${rows.length}`;
  const sheetRows = rows.map((row, index) => xlsxRow(row, index + 1)).join("\n");
  const generatedAt = new Date().toISOString();

  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>
${sheetRows}
  </sheetData>
</worksheet>`;

  return zipFiles([
    {
      path: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
    },
    {
      path: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      path: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>No.1 OCI AI Observability Hub</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>1</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="1" baseType="lpstr">
      <vt:lpstr>公式コスト明細</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company>No.1 OCI AI Observability Hub</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0300</AppVersion>
</Properties>`
    },
    {
      path: "docProps/core.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>No.1 OCI AI Observability Hub</dc:creator>
  <cp:lastModifiedBy>No.1 OCI AI Observability Hub</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      path: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="公式コスト明細" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
    },
    {
      path: "xl/worksheets/sheet1.xml",
      content: worksheetXml
    }
  ]);
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
  buffer[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function getZipDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear()) - 1980;
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = Math.max(1, date.getDate());
  const month = Math.max(1, date.getMonth() + 1);
  return {
    date: (year << 9) | (month << 5) | day,
    time
  };
}

function zipFiles(sources: ZipSource[]) {
  const records: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  const timestamp = getZipDateTime();
  let localOffset = 0;

  for (const source of sources) {
    const fileName = textEncoder.encode(source.path);
    const data = typeof source.content === "string" ? textEncoder.encode(source.content) : source.content;
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, ZIP_UTF8_FLAG);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, timestamp.time);
    writeUint16(localHeader, 12, timestamp.date);
    writeUint32(localHeader, 14, checksum);
    writeUint32(localHeader, 18, data.length);
    writeUint32(localHeader, 22, data.length);
    writeUint16(localHeader, 26, fileName.length);
    writeUint16(localHeader, 28, 0);

    const localRecord = concatBytes([localHeader, fileName, data]);
    records.push(localRecord);

    const centralHeader = new Uint8Array(46);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, ZIP_UTF8_FLAG);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, timestamp.time);
    writeUint16(centralHeader, 14, timestamp.date);
    writeUint32(centralHeader, 16, checksum);
    writeUint32(centralHeader, 20, data.length);
    writeUint32(centralHeader, 24, data.length);
    writeUint16(centralHeader, 28, fileName.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, localOffset);
    centralDirectory.push(concatBytes([centralHeader, fileName]));

    localOffset += localRecord.length;
  }

  const centralDirectoryOffset = localOffset;
  const centralDirectoryBytes = concatBytes(centralDirectory);
  const endOfCentralDirectory = new Uint8Array(22);
  writeUint32(endOfCentralDirectory, 0, 0x06054b50);
  writeUint16(endOfCentralDirectory, 4, 0);
  writeUint16(endOfCentralDirectory, 6, 0);
  writeUint16(endOfCentralDirectory, 8, sources.length);
  writeUint16(endOfCentralDirectory, 10, sources.length);
  writeUint32(endOfCentralDirectory, 12, centralDirectoryBytes.length);
  writeUint32(endOfCentralDirectory, 16, centralDirectoryOffset);
  writeUint16(endOfCentralDirectory, 20, 0);

  return concatBytes([...records, centralDirectoryBytes, endOfCentralDirectory]);
}

async function downloadOfficialCostExcel(items: OfficialCostItem[]) {
  if (!items.length) {
    throw new Error("ダウンロードできる公式コスト明細がありません。");
  }
  const workbook = buildOfficialCostXlsx(items);
  const fileName = `公式コスト明細_${formatDateInputValue(new Date())}.xlsx`;
  return saveOfficialCostExcel(fileName, workbook, XLSX_MIME_TYPE);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

function App() {
  const [state, setState] = useState<AppState>(defaultState);
  const [activeView, setActiveView] = useState<ViewId>(() => readHashView());
  const [message, setMessage] = useState("読み込み中です。");
  const [storageLocation, setStorageLocation] = useState("");
  const [officialUsageQuery, setOfficialUsageQuery] = useState<OfficialUsageQuery>(() => createDefaultOfficialUsageQuery());
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [usageQuery, setUsageQuery] = useState("");
  const [usageStatusFilter, setUsageStatusFilter] = useState<UsageRecord["status"] | "すべて">("すべて");
  const [isPricingRefreshing, setIsPricingRefreshing] = useState(false);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [isOfficialFetching, setIsOfficialFetching] = useState(false);
  const [aiResult, setAiResult] = useState<OciAiRunResult | null>(null);
  const [toastSerial, setToastSerial] = useState(0);
  const [dismissedToastSerial, setDismissedToastSerial] = useState(0);
  const updateMessage = (nextMessage: string) => {
    setMessage(nextMessage);
    setToastSerial((current) => current + 1);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAppState(), getStorageLocation()])
      .then(([loadedState, location]) => {
        if (cancelled) return;
        setState(loadedState);
        setStorageLocation(location);
        updateMessage("準備できました。");
      })
      .catch((error: Error) => {
        updateMessage(`読み込みに失敗しました: ${error.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    const onHashChange = () => {
      setActiveView(readHashView());
      resetViewportScroll();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    resetViewportScroll();
  }, [activeView]);

  const navigateTo = (view: ViewId) => {
    setActiveView(view);
    window.history.pushState(null, "", `#${view}`);
    resetViewportScroll();
  };

  const persist = async (nextState: AppState, successMessage: string) => {
    setState(nextState);
    await saveAppState(nextState);
    updateMessage(successMessage);
  };

  const summary = useMemo(
    () => summarize(state.usageRecords, state.officialCosts),
    [state.usageRecords, state.officialCosts]
  );

  const selectedRecord = state.usageRecords.find((record) => record.id === selectedRecordId) ?? state.usageRecords[0];

  const handleRemoveUsage = async (id: string) => {
    const record = state.usageRecords.find((item) => item.id === id);
    const label = record?.modelId || record?.opcRequestId || "この使用量レコード";
    if (!window.confirm(`${label} を削除します。よろしいですか？`)) {
      return;
    }

    const nextState = addActivity(
      { ...state, usageRecords: state.usageRecords.filter((record) => record.id !== id) },
      "使用量レコードを削除しました。"
    );
    await persist(nextState, "使用量レコードを削除しました。");
  };

  const handleFetchOfficialFromOci = async () => {
    setIsOfficialFetching(true);
    updateMessage("OCI Usage API から公式コストを取得しています。");
    try {
      const request = buildOciUsageCostRequest(officialUsageQuery);
      const response = await fetchOciUsageCosts(state, request);
      const allItems = parseOfficialCostJson(JSON.stringify(response));
      const items = filterGenerativeAiOfficialCosts(allItems);
      const excludedCount = allItems.length - items.length;
      if (!items.length) {
        updateMessage(
          allItems.length
            ? `取得結果 ${allItems.length} 件のうち、Generative AI SKU と判定できる明細はありませんでした。サービスフィルターとSKU名を確認してください。`
            : "指定した条件では公式コスト明細を確認できませんでした。期間またはサービスフィルターを調整してください。"
        );
        return;
      }
      const resultMessage = excludedCount
        ? `OCI Usage API から Generative AI SKU ${items.length} 件を取得しました。非対象SKU ${excludedCount} 件は除外しました。`
        : `OCI Usage API から Generative AI SKU ${items.length} 件を取得しました。`;
      const nextState = addActivity(
        { ...state, officialCosts: [...items, ...state.officialCosts] },
        resultMessage
      );
      await persist(nextState, resultMessage);
    } catch (error) {
      updateMessage(getErrorMessage(error, "OCI Usage API からの公式コスト取得に失敗しました。"));
    } finally {
      setIsOfficialFetching(false);
    }
  };

  const handleDownloadOfficialCostExcel = async () => {
    try {
      const savedPath = await downloadOfficialCostExcel(state.officialCosts);
      updateMessage(`Excelをダウンロードしました: ${savedPath}`);
    } catch (error) {
      updateMessage(getErrorMessage(error, "Excelダウンロードに失敗しました。"));
    }
  };

  const handleReconcile = async () => {
    if (!state.officialCosts.length || !state.usageRecords.length) {
      updateMessage("照合する公式コストまたは使用量レコードがありません。");
      return;
    }
    await persist(reconcileOfficialCosts(state), "公式コストを使用量レコードへ按分しました。");
  };

  const handleSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const homeRegion = String(form.get("homeRegion") || "");
    const aiRegion = String(form.get("aiRegion") || "");
    const enterpriseAiBaseUrl = String(form.get("enterpriseAiBaseUrl") || "") || buildGenerativeAiBaseUrl(aiRegion);
    const nextState = addActivity(
      {
        ...state,
        settings: {
          ...state.settings,
          tenancyOcid: String(form.get("tenancyOcid") || ""),
          userOcid: String(form.get("userOcid") || ""),
          fingerprint: String(form.get("fingerprint") || ""),
          homeRegion,
          aiRegion,
          region: undefined,
          privateKeyPem: String(form.get("privateKeyPem") || ""),
          passphrase: String(form.get("passphrase") || ""),
          defaultCompartmentOcid: String(form.get("defaultCompartmentOcid") || ""),
          defaultChatModelId: String(form.get("defaultChatModelId") || ""),
          defaultEmbeddingModelId: String(form.get("defaultEmbeddingModelId") || ""),
          defaultRerankModelId: String(form.get("defaultRerankModelId") || ""),
          enterpriseAiBaseUrl,
          enterpriseAiProjectOcid: String(form.get("enterpriseAiProjectOcid") || ""),
          enterpriseAiApiKey: String(form.get("enterpriseAiApiKey") || "")
        }
      },
      "OCI API 設定を保存しました。"
    );
    await persist(nextState, "OCI API 設定を保存しました。");
  };

  const handlePricingSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rules = state.pricingRules.map<PricingRule>((rule) => ({
      ...rule,
      name: String(form.get(`${rule.id}-name`) || rule.name),
      modelPattern: String(form.get(`${rule.id}-pattern`) || rule.modelPattern),
      requestUsd: Number(form.get(`${rule.id}-request`) || 0),
      inputCharacterUsd: Number(form.get(`${rule.id}-input-char`) || 0),
      outputCharacterUsd: Number(form.get(`${rule.id}-output-char`) || 0),
      inputTokenUsd: Number(form.get(`${rule.id}-input-token`) || 0),
      cachedInputTokenUsd: Number(form.get(`${rule.id}-cached-input-token`) || 0),
      outputTokenUsd: Number(form.get(`${rule.id}-output-token`) || 0),
      searchUnitUsd: Number(form.get(`${rule.id}-search-unit`) || 0),
      eventUsd: Number(form.get(`${rule.id}-event`) || 0),
      storageGbHourUsd: Number(form.get(`${rule.id}-storage-gb-hour`) || 0),
      imageUsd: Number(form.get(`${rule.id}-image`) || 0),
      dedicatedUnitHourUsd: Number(form.get(`${rule.id}-dedicated-unit-hour`) || 0),
      connectionMinuteUsd: Number(form.get(`${rule.id}-connection-minute`) || 0),
      active: form.get(`${rule.id}-active`) === "on"
    }));

    const usageRecords = recalculateUsageCosts(state.usageRecords, rules);

    const nextState = addActivity({ ...state, pricingRules: rules, usageRecords }, "価格ルールを更新しました。");
    await persist(nextState, "価格ルールを更新しました。");
  };

  const handleRefreshOraclePricing = async () => {
    setIsPricingRefreshing(true);
    updateMessage("Oracle公式価格を取得しています。");
    try {
      const response = await fetchOraclePricing("USD");
      const officialRules = buildOfficialPricingRules(response, "USD");
      const officialSkuCount = countOraclePricingSkus(officialRules);
      if (!officialRules.length) {
        updateMessage("Oracle公式価格から対象の OCI Generative AI / Agents 単価を確認できませんでした。");
        return;
      }

      const manualRules = state.pricingRules.filter(
        (rule) => rule.source !== "oracle-pricing-api" && rule.id !== "oci-default-character"
      );
      const rules = [...officialRules, ...manualRules];
      const usageRecords = recalculateUsageCosts(state.usageRecords, rules);
      const nextState = addActivity(
        { ...state, pricingRules: rules, usageRecords },
        `Oracle Price List から対象SKU ${officialSkuCount} 件、価格ルール ${officialRules.length} 件を更新しました。`
      );
      await persist(nextState, `Oracle Price List から対象SKU ${officialSkuCount} 件、価格ルール ${officialRules.length} 件を更新しました。`);
    } catch (error) {
      updateMessage(getErrorMessage(error, "Oracle公式価格の取得に失敗しました。"));
    } finally {
      setIsPricingRefreshing(false);
    }
  };

  const handleValidateSettings = async () => {
    const result = await validateOciSettings(state);
    updateMessage(result.messages.join(" "));
  };

  const handleRunAi = async (mode: AiRunMode, request: OciAiRunRequest) => {
    setIsAiRunning(true);
    updateMessage(`${aiModeLabels[mode]} を実行しています。`);
    try {
      const result = mode === "native-chat"
        ? await runOciGenerativeAiChat(state, request)
        : mode === "embedding"
          ? await runOciEmbedding(state, request)
          : await runOciRerank(state, request);
      setAiResult(result);
      const record = buildAiUsageRecord(state, result, request, mode);
      const nextState = addActivity(
        { ...state, usageRecords: [record, ...state.usageRecords] },
        `${aiModeLabels[mode]} の実行結果を使用量へ記録しました。`
      );
      await persist(nextState, `${aiModeLabels[mode]} を実行し、使用量へ記録しました。`);
      setSelectedRecordId(record.id);
    } catch (error) {
      updateMessage(getErrorMessage(error, `${aiModeLabels[mode]} の実行に失敗しました。`));
    } finally {
      setIsAiRunning(false);
    }
  };

  const settingsValidation = validateSettings(state.settings);
  const activeItem = navItems.find((item) => item.id === activeView) ?? navItems[0];
  const isBusy = isPricingRefreshing || isAiRunning || isOfficialFetching;
  const noticeTone = getNoticeTone(message, isBusy);
  const statusIsBusy = isBusy || noticeTone === "busy";
  const NoticeIcon = getNoticeIcon(noticeTone);
  const toastVisible = shouldShowToast(message, noticeTone) && dismissedToastSerial !== toastSerial;
  const topbarActions = getTopbarActions(activeView, settingsValidation.ready);

  useEffect(() => {
    if (!shouldShowToast(message, noticeTone) || noticeTone === "busy") return;
    const timeoutId = window.setTimeout(() => setDismissedToastSerial(toastSerial), noticeTone === "error" ? 5000 : 4200);
    return () => window.clearTimeout(timeoutId);
  }, [message, noticeTone, toastSerial]);

  return (
    <div className="appShell">
      <aside className="sidebar" aria-label="主要ナビゲーション">
        <div className="brand">
          <img src={brandIcon} className="brandMark" alt="No.1 Logo" />
          <div>
            <strong>No.1 OCI AI</strong>
            <span>Observability Hub</span>
          </div>
        </div>
        <nav className="navList">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? "navItem active" : "navItem"}
                type="button"
                onClick={() => navigateTo(item.id)}
                aria-current={activeView === item.id ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.caption}</small>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="sidebarFooter">
          <span className={settingsValidation.ready ? "statusDot ok" : "statusDot warn"} />
          <span>{settingsValidation.ready ? "OCI設定済み" : "OCI設定待ち"}</span>
        </div>
      </aside>

      <main className="workspace">
        <a className="skipLink" href="#main-content">メインコンテンツへ移動</a>
        <header className="topbar">
          <div>
            <p className="eyebrow">OCI Generative AI / Enterprise AI</p>
            <h1>{activeItem.label}</h1>
            <p className="topbarCaption">{activeItem.caption}</p>
          </div>
          <div className="topActions">
            {topbarActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  className={`${action.variant === "primary" ? "primaryButton" : "secondaryButton"} iconButton topActionButton`}
                  type="button"
                  onClick={() => navigateTo(action.view)}
                  key={`${activeView}-${action.view}-${action.label}`}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{action.label}</span>
                </button>
              );
            })}
            <div className={`topStatus ${noticeTone}`} role="status" aria-live="polite" aria-busy={statusIsBusy}>
              {statusIsBusy ? <span className="statusSpinner" aria-hidden="true" /> : <NoticeIcon size={16} aria-hidden="true" />}
              <span>{message}</span>
            </div>
          </div>
        </header>

        {toastVisible && (
          <ToastNotice
            message={message}
            tone={noticeTone}
            isBusy={statusIsBusy}
            onDismiss={() => setDismissedToastSerial(toastSerial)}
          />
        )}

        <div id="main-content" tabIndex={-1}>
          {activeView === "dashboard" && (
            <Dashboard state={state} summary={summary} selectedRecord={selectedRecord} onNavigate={navigateTo} />
          )}

          {activeView === "usage" && (
            <UsageView
              state={state}
              onRemoveUsage={handleRemoveUsage}
              selectedRecordId={selectedRecordId}
              onSelectRecord={setSelectedRecordId}
              query={usageQuery}
              onQueryChange={setUsageQuery}
              statusFilter={usageStatusFilter}
              onStatusFilterChange={setUsageStatusFilter}
            />
          )}

          {activeView === "official" && (
            <OfficialCostView
              state={state}
              usageQuery={officialUsageQuery}
              isFetching={isOfficialFetching}
              onUsageQueryChange={setOfficialUsageQuery}
              onFetchOfficial={handleFetchOfficialFromOci}
              onDownloadExcel={handleDownloadOfficialCostExcel}
              onReconcile={handleReconcile}
            />
          )}

          {activeView === "ai" && (
            <AiRunView
              state={state}
              result={aiResult}
              isRunning={isAiRunning}
              onRun={handleRunAi}
              onNavigate={navigateTo}
            />
          )}

          {activeView === "settings" && (
            <SettingsView
              state={state}
              storageLocation={storageLocation}
              onSettingsSubmit={handleSettingsSubmit}
              onPricingSubmit={handlePricingSubmit}
              onRefreshOraclePricing={handleRefreshOraclePricing}
              onValidateSettings={handleValidateSettings}
              isPricingRefreshing={isPricingRefreshing}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Dashboard({
  state,
  summary,
  selectedRecord,
  onNavigate
}: {
  state: AppState;
  summary: ReturnType<typeof summarize>;
  selectedRecord?: UsageRecord;
  onNavigate: (view: ViewId) => void;
}) {
  const modelGroups = groupByModel(state.usageRecords);
  const projectGroups = groupByProject(state.usageRecords, state.officialCosts);
  const reconciliationPercent = summary.officialCost > 0
    ? Math.min(100, Math.round((summary.allocatedCost / summary.officialCost) * 100))
    : 0;
  const settingsReady = validateSettings(state.settings).ready;
  const officialPricingRules = state.pricingRules.filter((rule) => rule.source === "oracle-pricing-api");
  const officialPricingRuleCount = officialPricingRules.length;
  const officialPricingSkuCount = countOraclePricingSkus(officialPricingRules);
  const aiSources = new Set(Object.values(aiModeLabels));
  const hasAiUsage = state.usageRecords.some((record) => aiSources.has(record.source));
  const hasUsage = state.usageRecords.length > 0;
  const hasOfficialCost = state.officialCosts.length > 0;
  const nextAction = getDashboardNextAction({
    settingsReady,
    hasOfficialPricing: officialPricingRuleCount > 0,
    hasAiUsage,
    hasUsage,
    hasOfficialCost,
    reconciliationPercent
  });
  const heroActions: Array<{ label: string; view: ViewId; icon: LucideIcon; variant: "primary" | "secondary" }> = [
    { label: nextAction.buttonLabel, view: nextAction.view, icon: nextAction.icon, variant: "primary" },
    ...[
      { label: "AI実行へ", view: "ai" as ViewId, icon: Bot },
      { label: "使用量を見る", view: "usage" as ViewId, icon: DatabaseZap },
      { label: "コストを照合", view: "official" as ViewId, icon: ReceiptText }
    ]
      .filter((action) => action.view !== nextAction.view)
      .slice(0, 2)
      .map((action) => ({ ...action, variant: "secondary" as const }))
  ];

  return (
    <section className="opsConsole">
      <section className="dashboardCommand">
        <section className="opsHero">
          <div className="opsHeroCopy">
            <span className="scopePill">OCI On-Demand 専用</span>
            <h2>OCI AI の使用量とコストを一画面で把握します</h2>
            <p>Oracle Price List の対象SKUを使用量単位へ整理し、OCI Usage API の公式コストと Enterprise AI Project 単位で照合します。</p>
            <div className="opsHeroMeta" aria-label="運用状態">
              <span className={settingsReady ? "signalChip ok" : "signalChip warn"}>
                <ShieldCheck size={14} aria-hidden="true" />
                OCI設定 {settingsReady ? "完了" : "未完了"}
              </span>
              <span className={officialPricingRuleCount > 0 ? "signalChip ok" : "signalChip warn"}>
                <CircleDollarSign size={14} aria-hidden="true" />
                公式価格SKU {officialPricingSkuCount}件
              </span>
              <span className={hasAiUsage ? "signalChip ok" : "signalChip neutral"}>
                <Bot size={14} aria-hidden="true" />
                AI実行 {hasAiUsage ? "記録あり" : "未記録"}
              </span>
              <span className={projectGroups.length > 0 ? "signalChip ok" : "signalChip neutral"}>
                <FolderKanban size={14} aria-hidden="true" />
                Enterprise AI Project {projectGroups.length ? `${projectGroups.length}件` : "未記録"}
              </span>
            </div>
            <div className="heroActions" aria-label="主要アクション">
              {heroActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    className={`${action.variant === "primary" ? "primaryButton" : "secondaryButton"} iconButton`}
                    type="button"
                    onClick={() => onNavigate(action.view)}
                    key={`${action.variant}-${action.view}-${action.label}`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
        <NextActionPanel action={nextAction} />
      </section>

      <CommandReadinessPanel
        settingsReady={settingsReady}
        hasOfficialPricing={officialPricingRuleCount > 0}
        hasAiUsage={hasAiUsage}
        hasUsage={hasUsage}
        hasOfficialCost={hasOfficialCost}
        reconciliationPercent={reconciliationPercent}
        summary={summary}
      />

      <WorkflowBoard
        settingsReady={settingsReady}
        hasOfficialPricing={officialPricingRuleCount > 0}
        hasAiUsage={hasAiUsage}
        hasUsage={hasUsage}
        hasOfficialCost={hasOfficialCost}
        reconciliationPercent={reconciliationPercent}
        onNavigate={onNavigate}
      />

      <div className="insightGrid">
        <InsightTile icon={DatabaseZap} label="使用量レコード" value={`${formatNumber(state.usageRecords.length)}件`} sub={`${formatNumber(summary.requestCount)} Req / ${formatNumber(summary.reconciled)}件照合済み`} tone="blue" />
        <InsightTile icon={ReceiptText} label="公式コスト" value={formatUsd(summary.officialCost)} sub="Usage API取得分" tone="green" />
        <InsightTile icon={FileText} label="入力 / 出力文字" value={`${formatNumber(summary.inputCharacters)} / ${formatNumber(summary.outputCharacters)}`} sub={`${formatNumber(summary.promptTokens + summary.cachedInputTokens + summary.completionTokens)} tokens / ${formatNumber(summary.requestCount)} Req`} tone="neutral" />
        <InsightTile icon={Gauge} label="照合率" value={`${reconciliationPercent}%`} sub={`${summary.reconciled} 件を照合済み`} tone={reconciliationPercent >= 80 ? "green" : "amber"} />
        <InsightTile icon={ClipboardCheck} label="未照合コスト" value={formatUsd(summary.unreconciledCost)} sub="公式請求との差分候補" tone={summary.unreconciledCost > 0 ? "amber" : "neutral"} />
        <InsightTile icon={FolderKanban} label="Enterprise AI Project数" value={formatNumber(projectGroups.length)} sub="使用量または公式コスト" tone="neutral" />
      </div>

      <div className="overviewFocusGrid">
        <ReconciliationPanel summary={summary} reconciliationPercent={reconciliationPercent} />
      </div>

      <div className="analysisGrid secondary">
        <ModelUsagePanel modelGroups={modelGroups} recordCount={state.usageRecords.length} />
        <ProjectUsagePanel projectGroups={projectGroups} />
      </div>

      <div className="analysisGrid secondary">
        <RecordPreview selectedRecord={selectedRecord} />
        <ActivityFeed state={state} />
      </div>
    </section>
  );
}

function CommandReadinessPanel({
  settingsReady,
  hasOfficialPricing,
  hasAiUsage,
  hasUsage,
  hasOfficialCost,
  reconciliationPercent,
  summary
}: {
  settingsReady: boolean;
  hasOfficialPricing: boolean;
  hasAiUsage: boolean;
  hasUsage: boolean;
  hasOfficialCost: boolean;
  reconciliationPercent: number;
  summary: ReturnType<typeof summarize>;
}) {
  const checks = [
    settingsReady,
    hasOfficialPricing,
    hasAiUsage,
    hasUsage,
    hasOfficialCost,
    reconciliationPercent > 0
  ];
  const readyCount = checks.filter(Boolean).length;
  const readiness = Math.round((readyCount / checks.length) * 100);
  const readinessTone = readiness >= 100 ? "ready" : readiness >= 50 ? "mid" : "low";
  const needsAttention = [
    !settingsReady ? "OCI設定" : "",
    !hasOfficialPricing ? "公式価格" : "",
    !hasAiUsage ? "AI実行" : "",
    !hasUsage ? "使用量レコード" : "",
    !hasOfficialCost ? "公式コスト" : "",
    hasOfficialCost && reconciliationPercent <= 0 ? "按分" : ""
  ].filter(Boolean);

  return (
    <section className="commandReadiness" aria-label="運用判断サマリー">
      <div className={`readinessScore ${readinessTone}`}>
        <span>運用準備度</span>
        <strong>{readiness}%</strong>
        <small>{readyCount}/{checks.length} 項目完了</small>
      </div>
      <div className="readinessBody">
        <div>
          <h2>{needsAttention.length ? "次に確認する項目があります" : "主要フローは運用可能です"}</h2>
          <p>
            {needsAttention.length
              ? `${needsAttention.join("、")} を整えると、実行ログ、公式コスト、按分状況を一続きで確認できます。`
              : "AI実行から使用量記録、コスト照合までの判断材料が揃っています。"}
          </p>
        </div>
        <dl className="readinessStats">
          <div>
            <dt>公式コスト</dt>
            <dd>{formatUsd(summary.officialCost)}</dd>
          </div>
          <div>
            <dt>未照合コスト</dt>
            <dd>{formatUsd(summary.unreconciledCost)}</dd>
          </div>
          <div>
            <dt>照合済み</dt>
            <dd>{summary.reconciled}件</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function NextActionPanel({
  action
}: {
  action: DashboardNextAction;
}) {
  const Icon = action.icon;
  return (
    <aside className="nextActionPanel" aria-label="次のアクション">
      <span className="panelKicker">次のアクション</span>
      <div className="nextActionBody">
        <span className={`nextActionIcon ${action.tone}`}>
          <Icon size={20} aria-hidden="true" />
        </span>
        <div>
          <h2>{action.title}</h2>
          <p>{action.description}</p>
        </div>
      </div>
    </aside>
  );
}

function ToastNotice({
  message,
  tone,
  isBusy,
  onDismiss
}: {
  message: string;
  tone: NoticeTone;
  isBusy: boolean;
  onDismiss: () => void;
}) {
  const Icon = getNoticeIcon(tone);
  return (
    <aside
      className={`toastNotice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <span className="toastIcon" aria-hidden="true">
        {isBusy ? <span className="statusSpinner" /> : <Icon size={18} />}
      </span>
      <div>
        <strong>{getNoticeTitle(tone)}</strong>
        <p>{message}</p>
      </div>
      <button className="ghostButton iconOnlyButton toastDismiss" type="button" onClick={onDismiss} aria-label="通知を閉じる">
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

function WorkflowBoard({
  settingsReady,
  hasOfficialPricing,
  hasAiUsage,
  hasUsage,
  hasOfficialCost,
  reconciliationPercent,
  onNavigate
}: {
  settingsReady: boolean;
  hasOfficialPricing: boolean;
  hasAiUsage: boolean;
  hasUsage: boolean;
  hasOfficialCost: boolean;
  reconciliationPercent: number;
  onNavigate: (view: ViewId) => void;
}) {
  const steps: Array<{ label: string; caption: string; done: boolean; action: string; view: ViewId; icon: LucideIcon }> = [
    { label: "OCI設定", caption: "APIキーとリージョン", done: settingsReady, action: "設定", view: "settings", icon: ShieldCheck },
    { label: "公式価格", caption: "Oracle Pricing API", done: hasOfficialPricing, action: "取得", view: "settings", icon: CircleDollarSign },
    { label: "AI実行", caption: "Chat / Embed / Rerank", done: hasAiUsage, action: "実行", view: "ai", icon: Bot },
    { label: "使用量保存", caption: "自動記録レコード", done: hasUsage, action: "確認", view: "usage", icon: DatabaseZap },
    { label: "コスト照合", caption: "Usage API取得", done: hasOfficialCost && reconciliationPercent > 0, action: hasOfficialCost ? "確認" : "取得", view: "official", icon: Workflow }
  ];
  const currentStepIndex = steps.findIndex((step) => !step.done);

  return (
    <section className="workflowBoard" aria-label="オンデマンド費用管理ワークフロー">
      {steps.map((step, index) => {
        const Icon = step.icon;
        const isCurrent = index === currentStepIndex;
        const className = ["workflowStep", step.done ? "done" : "", isCurrent ? "current" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            className={className}
            type="button"
            key={step.label}
            onClick={() => onNavigate(step.view)}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span className="workflowIndex">{index + 1}</span>
            <span className="workflowIcon"><Icon size={18} aria-hidden="true" /></span>
            <span className="workflowText">
              <strong>{step.label}</strong>
              <small>{step.caption}</small>
            </span>
            <span className="workflowAction">{step.done ? "完了" : isCurrent ? "次" : step.action}</span>
          </button>
        );
      })}
    </section>
  );
}

function InsightTile({
  icon: Icon,
  label,
  value,
  sub,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone: "blue" | "green" | "amber" | "red" | "neutral";
}) {
  return (
    <section className={`insightTile ${tone}`}>
      <div className="insightIcon" aria-hidden="true"><Icon size={18} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
    </section>
  );
}

function ReconciliationPanel({
  summary,
  reconciliationPercent
}: {
  summary: ReturnType<typeof summarize>;
  reconciliationPercent: number;
}) {
  return (
    <section className="panel emphasisPanel">
      <div className="panelHeader">
        <h2>照合状況</h2>
        <span>{reconciliationPercent}%</span>
      </div>
      <div className="reconcileBlock">
        <div className="progressTrack large" aria-label="公式コスト照合率">
          <div className="progressFill" style={{ width: `${reconciliationPercent}%` }} />
        </div>
        <div className="reconcileNumbers split">
          <span>公式コスト <strong>{formatUsd(summary.officialCost)}</strong></span>
          <span>按分済み <strong>{formatUsd(summary.allocatedCost)}</strong></span>
          <span>未照合 <strong>{formatUsd(summary.unreconciledCost)}</strong></span>
        </div>
      </div>
      <p className="helperText tight">公式コストを取り込むと、同じ resource / compartment / region の使用量へ按分できます。</p>
    </section>
  );
}

function ModelUsagePanel({
  modelGroups,
  recordCount
}: {
  modelGroups: ReturnType<typeof groupByModel>;
  recordCount: number;
}) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>モデル別の使用量</h2>
        <span>{recordCount} 件</span>
      </div>
      <div className="barList">
        {modelGroups.length ? modelGroups.map((group) => (
          <div className="barRow" key={group.modelId}>
            <div className="barLabel">
              <strong>{group.modelId || "未指定モデル"}</strong>
              <span>{formatUsd(group.cost)} / {formatNumber(group.requests)} 件</span>
            </div>
            <div className="barTrack">
              <div className="barFill" style={{ width: `${group.percent}%` }} />
            </div>
          </div>
        )) : <EmptyText text="まだ使用量レコードがありません。" />}
      </div>
    </section>
  );
}

function ProjectUsagePanel({
  projectGroups
}: {
  projectGroups: ReturnType<typeof groupByProject>;
}) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Enterprise AI Project別の使用量とコスト</h2>
        <span>{projectGroups.length} 件</span>
      </div>
      <div className="barList">
        {projectGroups.length ? projectGroups.map((group) => (
          <div className="barRow" key={group.key}>
            <div className="barLabel">
              <strong>{group.label}</strong>
              <span>{formatUsd(group.estimatedCost)} / 公式 {formatUsd(group.officialCost)}</span>
            </div>
            <div className="barTrack">
              <div className="barFill projectBarFill" style={{ width: `${group.percent}%` }} />
            </div>
            <div className="projectMetaLine">
              <span>{formatNumber(group.requests)} 件</span>
              {group.projectOcid && <span>{group.projectOcid}</span>}
            </div>
          </div>
        )) : <EmptyText text="Enterprise AI Project 情報を持つ使用量または公式コストがまだありません。" />}
      </div>
    </section>
  );
}

function RecordPreview({ selectedRecord }: { selectedRecord?: UsageRecord }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>直近レコード</h2>
        <span>{selectedRecord ? selectedRecord.status : "なし"}</span>
      </div>
      {selectedRecord ? (
        <dl className="detailList">
          <div><dt>発生日時</dt><dd>{formatDateTime(selectedRecord.occurredAt)}</dd></div>
          <div><dt>Enterprise AI Project</dt><dd>{selectedRecord.projectName || selectedRecord.projectOcid || "-"}</dd></div>
          <div><dt>モデル</dt><dd>{selectedRecord.modelId || "-"}</dd></div>
          <div><dt>OPC Request ID</dt><dd>{selectedRecord.opcRequestId || "-"}</dd></div>
          <div><dt>Price List単位</dt><dd>{formatUsagePriceListUnits(selectedRecord)}</dd></div>
          <div><dt>トークン</dt><dd>{formatNumber(selectedRecord.promptTokens + selectedRecord.cachedInputTokens + selectedRecord.completionTokens)}</dd></div>
          <div><dt>参考コスト</dt><dd>{formatUsd(selectedRecord.estimatedCostUsd)}</dd></div>
          <div><dt>公式按分</dt><dd>{formatUsd(selectedRecord.officialAllocatedCostUsd)}</dd></div>
        </dl>
      ) : <EmptyText text="AI実行でレコードが保存されると詳細が表示されます。" />}
    </section>
  );
}

function ActivityFeed({ state }: { state: AppState }) {
  return (
    <section className="panel activityPanel">
      <div className="panelHeader">
        <h2>操作ログ</h2>
        <span>最新 {state.activityLog.length} 件</span>
      </div>
      <div className="activityList">
        {state.activityLog.length ? state.activityLog.map((item) => (
          <div className="activityItem" key={item.id}>
            <span>{formatDateTime(item.at)}</span>
            <strong>{item.message}</strong>
          </div>
        )) : <EmptyText text="まだ操作ログがありません。" />}
      </div>
    </section>
  );
}

function UsageView({
  state,
  onRemoveUsage,
  selectedRecordId,
  onSelectRecord,
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange
}: {
  state: AppState;
  onRemoveUsage: (id: string) => void;
  selectedRecordId: string | null;
  onSelectRecord: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: UsageRecord["status"] | "すべて";
  onStatusFilterChange: (value: UsageRecord["status"] | "すべて") => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const estimatedTotal = state.usageRecords.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
  const errorCount = state.usageRecords.filter((record) => record.status !== "成功").length;
  const filteredRecords = state.usageRecords.filter((record) => {
    const matchesStatus = statusFilter === "すべて" || record.status === statusFilter;
    const matchesQuery = !normalizedQuery || [
      record.modelId,
      record.compartmentOcid,
      record.projectName,
      record.projectOcid,
      record.opcRequestId,
      record.region
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
    return matchesStatus && matchesQuery;
  });

  return (
    <section className="pageStack">
      <PageLead
        icon={Activity}
        title="使用量の収集"
        description="AI実行から自動記録されたモデル、Enterprise AI Project、Request ID、文字数、トークン、Price List単位を確認します。"
        items={[
          { label: "レコード", value: `${formatNumber(state.usageRecords.length)}件` },
          { label: "推定コスト", value: formatUsd(estimatedTotal) },
          { label: "要確認", value: `${formatNumber(errorCount)}件` }
        ]}
      />
      <section className="panel">
        <div className="panelHeader">
          <h2>使用量レコード</h2>
          <span>{filteredRecords.length} / {state.usageRecords.length} 件</span>
        </div>
        <div className="toolbar">
          <label className="searchField">
            <span className="srOnly">使用量レコードを検索</span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="モデル、Enterprise AI Project、OCID、Request ID"
            />
          </label>
          <label className="filterField">
            <span className="srOnly">状態で絞り込み</span>
            <ListFilter size={16} aria-hidden="true" />
            <select
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value as UsageRecord["status"] | "すべて")}
            >
              <option>すべて</option>
              {statusOptions.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </div>
        <div className="tableWrap">
          <table className="responsiveTable">
            <thead>
              <tr>
                <th>日時</th>
                <th>モデル</th>
                <th>Project</th>
                <th>状態</th>
                <th>トークン</th>
                <th>Price List単位</th>
                <th>文字数</th>
                <th>推定</th>
                <th>公式按分</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => (
                <tr key={record.id} className={selectedRecordId === record.id ? "selectedRow" : ""}>
                  <td data-label="日時"><button className="linkButton" type="button" onClick={() => onSelectRecord(record.id)}>{formatDateTime(record.occurredAt)}</button></td>
                  <td data-label="モデル">{record.modelId || "-"}</td>
                  <td data-label="Project">{record.projectName || record.projectOcid || "-"}</td>
                  <td data-label="状態"><span className={`badge ${record.status === "成功" ? "good" : "bad"}`}>{record.status}</span></td>
                  <td data-label="トークン">{formatNumber(record.promptTokens + record.cachedInputTokens + record.completionTokens)}</td>
                  <td data-label="Price List単位">{formatUsagePriceListUnits(record)}</td>
                  <td data-label="文字数">{formatNumber(record.inputCharacters + record.outputCharacters)}</td>
                  <td data-label="推定">{formatUsd(record.estimatedCostUsd)}</td>
                  <td data-label="公式按分">{formatUsd(record.officialAllocatedCostUsd)}</td>
                  <td data-label="操作" className="actionCell">
                    <button
                      className="ghostButton iconOnlyButton"
                      type="button"
                      onClick={() => onRemoveUsage(record.id)}
                      aria-label={`${formatDateTime(record.occurredAt)} の使用量レコードを削除`}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!state.usageRecords.length && (
            <EmptyDataState
              icon={DatabaseZap}
              title="まだ使用量レコードがありません"
              description="AI実行を行うと、レスポンスから使用量レコードが自動保存されます。"
              actionLabel="AI実行へ"
              href="#ai"
            />
          )}
          {state.usageRecords.length > 0 && !filteredRecords.length && (
            <EmptyDataState
              icon={Search}
              title="条件に一致するレコードがありません"
              description="検索語または状態フィルターを変更してください。"
            />
          )}
        </div>
      </section>
    </section>
  );
}

function CalendarDateField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const selectedDate = readDateInputValue(value);
  const todayDate = createTodayDate();
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const [viewDate, setViewDate] = useState(() => getMonthAnchor(selectedDate ?? todayDate));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedDate) {
      setViewDate(getMonthAnchor(selectedDate));
    }
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;

    const updatePlacement = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom;
      setPlacement(spaceBelow < 360 && rect.top > spaceBelow ? "above" : "below");
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    updatePlacement();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [isOpen]);

  const calendarDays = buildCalendarDays(viewDate);
  const month = viewDate.getUTCMonth();
  const selectedLabel = formatDateLabel(value);

  const moveMonth = (offset: number) => {
    setViewDate((current) => createUtcDate(current.getUTCFullYear(), current.getUTCMonth() + offset, 1));
  };

  const selectDate = (date: Date) => {
    onChange(formatDateInputValue(date));
    setIsOpen(false);
  };

  return (
    <div className="field datePickerField">
      <span>{label}</span>
      <div className="datePickerShell" ref={rootRef}>
        <button
          className={`dateInputButton${isOpen ? " isOpen" : ""}`}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label={`${label}: ${selectedLabel}`}
          onClick={() => {
            setViewDate(getMonthAnchor(selectedDate ?? todayDate));
            setIsOpen((current) => !current);
          }}
        >
          <span className="dateInputMain">
            <CalendarDays size={16} aria-hidden="true" />
            <span className="dateInputValue">{selectedLabel}</span>
          </span>
          <ChevronRight className="dateInputChevron" size={16} aria-hidden="true" />
        </button>
        {isOpen && (
          <div className={`datePopover ${placement === "above" ? "isAbove" : "isBelow"}`} role="dialog" aria-label={`${label}を選択`}>
            <div className="datePickerHeader">
              <button className="dateNavButton" type="button" onClick={() => moveMonth(-1)} aria-label="前の月">
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <strong className="datePickerTitle">{formatCalendarMonth(viewDate)}</strong>
              <button className="dateNavButton" type="button" onClick={() => moveMonth(1)} aria-label="次の月">
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="dateWeekdays" aria-hidden="true">
              {WEEKDAY_LABELS_JA.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div className="dateGrid">
              {calendarDays.map((date) => {
                const isOutsideMonth = date.getUTCMonth() !== month;
                const isSelected = selectedDate ? isSameUtcDay(date, selectedDate) : false;
                const isToday = isSameUtcDay(date, todayDate);
                const className = [
                  "dateDay",
                  isOutsideMonth ? "isOutside" : "",
                  isSelected ? "isSelected" : "",
                  isToday ? "isToday" : ""
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    className={className}
                    type="button"
                    key={formatDateInputValue(date)}
                    aria-pressed={isSelected}
                    onClick={() => selectDate(date)}
                  >
                    {date.getUTCDate()}
                  </button>
                );
              })}
            </div>
            <p className="datePickerHint">日付を選択すると閉じます。外側クリックまたはEscでも閉じられます。</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OfficialCostView({
  state,
  usageQuery,
  isFetching,
  onUsageQueryChange,
  onFetchOfficial,
  onDownloadExcel,
  onReconcile
}: {
  state: AppState;
  usageQuery: OfficialUsageQuery;
  isFetching: boolean;
  onUsageQueryChange: (value: OfficialUsageQuery) => void;
  onFetchOfficial: () => void;
  onDownloadExcel: () => void | Promise<void>;
  onReconcile: () => void;
}) {
  const hasUsageRange = Boolean(usageQuery.startDate && usageQuery.endDate);
  const homeRegion = getHomeRegion(state.settings);
  const costSettingsReady = Boolean(
    state.settings.tenancyOcid &&
    state.settings.userOcid &&
    state.settings.fingerprint &&
    state.settings.privateKeyPem &&
    homeRegion
  );
  const canFetchFromOci = costSettingsReady && hasUsageRange && !isFetching;
  const canReconcile = state.officialCosts.length > 0 && state.usageRecords.length > 0;
  const officialTotal = state.officialCosts.reduce((sum, item) => sum + item.computedAmountUsd, 0);
  const [officialCostPage, setOfficialCostPage] = useState(1);
  const officialCostCount = state.officialCosts.length;
  const totalOfficialPages = Math.max(1, Math.ceil(officialCostCount / OFFICIAL_COST_PAGE_SIZE));
  const currentOfficialPage = Math.min(officialCostPage, totalOfficialPages);
  const officialCostPageStart = officialCostCount ? (currentOfficialPage - 1) * OFFICIAL_COST_PAGE_SIZE : 0;
  const officialCostPageItems = state.officialCosts.slice(officialCostPageStart, officialCostPageStart + OFFICIAL_COST_PAGE_SIZE);
  const officialCostRangeStart = officialCostCount ? officialCostPageStart + 1 : 0;
  const officialCostRangeEnd = Math.min(officialCostPageStart + OFFICIAL_COST_PAGE_SIZE, officialCostCount);

  useEffect(() => {
    if (officialCostPage !== currentOfficialPage) {
      setOfficialCostPage(currentOfficialPage);
    }
  }, [currentOfficialPage, officialCostPage]);

  return (
    <section className="pageStack">
      <PageLead
        icon={ReceiptText}
        title="コスト照合"
        description="OCI Usage API から公式コストを取得し、使用量レコードへ按分します。Enterprise AI Project、Compartment、Region が揃うほど照合しやすくなります。"
        items={[
          { label: "公式明細", value: `${formatNumber(state.officialCosts.length)}件` },
          { label: "公式合計", value: formatUsd(officialTotal) },
          { label: "Home Region", value: homeRegion || "未入力" },
          { label: "照合対象", value: `${formatNumber(state.usageRecords.length)}件` }
        ]}
      />
      <section id="official-import-panel" className="panel">
        <div className="panelHeader">
          <div>
            <h2>OCI Usage API から取得</h2>
            <span>保存済みのOCI APIキーで公式コストを直接取得します</span>
          </div>
        </div>
        <div className="officialReadiness" aria-label="公式コスト取得ステータス">
          <div className={costSettingsReady ? "summaryItem ready" : "summaryItem attention"}>
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <strong>OCI設定</strong>
              <span>{costSettingsReady ? "設定済み" : "未完了"}</span>
            </div>
          </div>
          <div className={homeRegion ? "summaryItem ready" : "summaryItem attention"}>
            <MapPin size={17} aria-hidden="true" />
            <div>
              <strong>Home Region</strong>
              <span>{homeRegion || "未入力"}</span>
            </div>
          </div>
          <div className={hasUsageRange ? "summaryItem ready" : "summaryItem attention"}>
            <CalendarDays size={17} aria-hidden="true" />
            <div>
              <strong>取得期間</strong>
              <span>{hasUsageRange ? `${usageQuery.startDate} から ${usageQuery.endDate}` : "未指定"}</span>
            </div>
          </div>
          <div className={state.usageRecords.length ? "summaryItem ready" : "summaryItem attention"}>
            <DatabaseZap size={17} aria-hidden="true" />
            <div>
              <strong>使用量</strong>
              <span>{state.usageRecords.length ? `${state.usageRecords.length}件` : "未記録"}</span>
            </div>
          </div>
          <div className={state.officialCosts.length ? "summaryItem ready" : "summaryItem neutral"}>
            <ReceiptText size={17} aria-hidden="true" />
            <div>
              <strong>公式コスト</strong>
              <span>{state.officialCosts.length ? `${state.officialCosts.length}件` : "未取込"}</span>
            </div>
          </div>
        </div>
        <div className="apiImportShell">
          <form
            className="usageApiForm"
            onSubmit={(event) => {
              event.preventDefault();
              onFetchOfficial();
            }}
          >
            <p className="helperText">
              Cost Analysis の公式データは反映に時間差があります。終了日は含む指定として扱い、APIへは翌日0:00を終了時刻として送信します。
            </p>
            <div className="formGrid compact usageApiGrid">
              <CalendarDateField
                label="開始日"
                value={usageQuery.startDate}
                onChange={(startDate) => onUsageQueryChange({ ...usageQuery, startDate })}
              />
              <CalendarDateField
                label="終了日"
                value={usageQuery.endDate}
                onChange={(endDate) => onUsageQueryChange({ ...usageQuery, endDate })}
              />
              <label className="field">
                <span>粒度</span>
                <select
                  value={usageQuery.granularity}
                  onChange={(event) => onUsageQueryChange({ ...usageQuery, granularity: event.target.value as OciUsageGranularity })}
                >
                  <option value="DAILY">日次</option>
                  <option value="MONTHLY">月次</option>
                </select>
              </label>
              <label className="field wide">
                <span>サービスフィルター</span>
                <input
                  value={usageQuery.serviceFilter}
                  onChange={(event) => onUsageQueryChange({ ...usageQuery, serviceFilter: event.target.value })}
                  placeholder="例: Generative AI, OCI Generative AI, GENERATIVE_AI"
                />
              </label>
            </div>
            <div className="actions">
              <button className="primaryButton iconButton" type="submit" disabled={!canFetchFromOci}>
                {isFetching ? <span className="buttonSpinner" aria-hidden="true" /> : <CloudDownload size={16} aria-hidden="true" />}
                <span>{isFetching ? "取得中" : "OCIから公式コストを取得"}</span>
              </button>
              <button className="secondaryButton iconButton" type="button" onClick={onReconcile} disabled={!canReconcile}>
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>使用量へ按分する</span>
              </button>
              {!costSettingsReady && (
                <p className="inlineNotice" role="note">
                  <ShieldCheck size={15} aria-hidden="true" />
                  Home Region とOCI APIキー設定を保存するとAPI取得できます。
                </p>
              )}
            </div>
          </form>
          <aside className="importChecklist" aria-label="Usage API 取得条件">
            <strong>API取得条件</strong>
            <span><CheckCircle2 size={15} aria-hidden="true" /> queryType: COST</span>
            <span><CheckCircle2 size={15} aria-hidden="true" /> endpoint: usageapi.{homeRegion || "home-region"}.oci.oraclecloud.com</span>
            <span><CheckCircle2 size={15} aria-hidden="true" /> groupBy: service / skuName / compartmentId / region</span>
            <span><CheckCircle2 size={15} aria-hidden="true" /> compartmentDepth: 6</span>
            <span><CheckCircle2 size={15} aria-hidden="true" /> 取得後にGenerative AI SKUのみ保存</span>
            <span><CheckCircle2 size={15} aria-hidden="true" /> フィルター空欄時は全サービス</span>
          </aside>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader detailHeader">
          <div>
            <h2>公式コスト明細</h2>
            <span>
              {officialCostCount
                ? `${formatNumber(officialCostRangeStart)}-${formatNumber(officialCostRangeEnd)} / ${formatNumber(officialCostCount)}件を表示`
                : "0件"}
              {officialCostCount ? `（${OFFICIAL_COST_PAGE_SIZE}件/ページ）` : ""}
            </span>
          </div>
          <div className="detailHeaderActions">
            <button
              className="secondaryButton iconButton"
              type="button"
              onClick={onDownloadExcel}
              disabled={!officialCostCount}
            >
              <Download size={16} aria-hidden="true" />
              <span>Excelをダウンロード</span>
            </button>
          </div>
        </div>
        <div className="tableWrap">
          <table className="responsiveTable">
            <thead>
              <tr>
                <th>期間</th>
                <th>サービス</th>
                <th>SKU</th>
                <th>Project</th>
                <th>リージョン</th>
                <th>リソース</th>
                <th>使用量</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {officialCostPageItems.map((item) => (
                <tr key={item.id}>
                  <td data-label="期間">{formatDateTime(item.timeStarted)}</td>
                  <td data-label="サービス">{item.service || "-"}</td>
                  <td data-label="SKU">{item.skuName || "-"}</td>
                  <td data-label="Project">{item.projectName || item.projectOcid || "-"}</td>
                  <td data-label="リージョン">{item.region || "-"}</td>
                  <td data-label="リソース" className="monoCell">{item.resourceOcid || item.compartmentOcid || "-"}</td>
                  <td data-label="使用量">{formatNumber(item.usageQuantity)} {item.usageUnit}</td>
                  <td data-label="金額">{formatUsd(item.computedAmountUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!state.officialCosts.length && (
            <EmptyDataState
              icon={CloudDownload}
              title="公式コスト明細はまだありません"
              description="OCI Usage API から公式コストを取得すると、ここに明細が表示されます。"
              actionLabel="取得欄へ"
              href="#official-import-panel"
            />
          )}
        </div>
        {officialCostCount > 0 && (
          <div className="paginationBar" aria-label="公式コスト明細ページ操作">
            <span>
              {formatNumber(officialCostRangeStart)}-{formatNumber(officialCostRangeEnd)} / {formatNumber(officialCostCount)}件
            </span>
            <div className="paginationControls">
              <button
                className="secondaryButton iconButton pagerButton"
                type="button"
                onClick={() => setOfficialCostPage((page) => Math.max(1, page - 1))}
                disabled={currentOfficialPage <= 1}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                <span>前へ</span>
              </button>
              <span className="pageIndicator">{formatNumber(currentOfficialPage)} / {formatNumber(totalOfficialPages)}ページ</span>
              <button
                className="secondaryButton iconButton pagerButton"
                type="button"
                onClick={() => setOfficialCostPage((page) => Math.min(totalOfficialPages, page + 1))}
                disabled={currentOfficialPage >= totalOfficialPages}
              >
                <span>次へ</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

function AiRunView({
  state,
  result,
  isRunning,
  onRun,
  onNavigate
}: {
  state: AppState;
  result: OciAiRunResult | null;
  isRunning: boolean;
  onRun: (mode: AiRunMode, request: OciAiRunRequest) => Promise<void>;
  onNavigate: (view: ViewId) => void;
}) {
  const [mode, setMode] = useState<AiRunMode>("native-chat");
  const settingsReady = validateSettings(state.settings).ready;
  const selectedModeLabel = aiModeLabels[mode];
  const isChatMode = mode === "native-chat";
  const isEmbeddingMode = mode === "embedding";
  const isRerankMode = mode === "rerank";
  const aiRegion = getAiRegion(state.settings);
  const modelDefault = isEmbeddingMode
    ? state.settings.defaultEmbeddingModelId
    : isRerankMode
      ? state.settings.defaultRerankModelId
      : state.settings.defaultChatModelId;
  const canRunAi = settingsReady;
  const runButtonLabel = !canRunAi ? "設定が必要" : isRunning ? "実行中" : `${selectedModeLabel} を実行`;
  const hasDefaultModel = Boolean(modelDefault);
  const hasDefaultCompartment = Boolean(state.settings.defaultCompartmentOcid);
  const hasAiRegion = Boolean(aiRegion);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const request: OciAiRunRequest = {
      region: String(form.get("region") || ""),
      modelId: String(form.get("modelId") || ""),
      compartmentOcid: String(form.get("compartmentOcid") || ""),
      prompt: String(form.get("prompt") || ""),
      input: String(form.get("input") || ""),
      documents: String(form.get("documents") || ""),
      systemPrompt: String(form.get("systemPrompt") || ""),
      temperature: Number(form.get("temperature") || 0),
      topP: Number(form.get("topP") || 0),
      maxTokens: Number(form.get("maxTokens") || 0),
      topN: Number(form.get("topN") || 0),
      inputType: String(form.get("inputType") || "SEARCH_DOCUMENT") as OciAiRunRequest["inputType"],
      truncate: String(form.get("truncate") || "END") as OciAiRunRequest["truncate"]
    };
    await onRun(mode, request);
  };

  const rawResponseText = result ? JSON.stringify(result.rawResponse, null, 2) : "";

  return (
    <section className="pageStack">
      <PageLead
        icon={Bot}
        title="AI実行と自動記録"
        description="OCI Generative AI Chat / Embedding / Rerank を実行し、レスポンスからトークン、文字数、レイテンシ、OPC Request ID を使用量へ保存します。"
        items={[
          { label: "実行モード", value: aiModeShortLabels[mode] },
          { label: "AIリージョン", value: aiRegion || "未入力" },
          { label: "既定モデル", value: hasDefaultModel ? "あり" : "未入力" }
        ]}
      />
      <section className={settingsReady ? "statusPanel ready" : "statusPanel attention"}>
        <Bot size={20} aria-hidden="true" />
        <div>
          <h2>{selectedModeLabel}</h2>
          <p>{settingsReady ? `既定では ${aiRegion} で実行します。必要な場合は本実行だけ変更できます。` : "OCI APIキー設定とAI実行リージョンを保存してください。"}</p>
        </div>
        <button className="secondaryButton iconButton" type="button" onClick={() => onNavigate("settings")}>
          <Settings size={16} aria-hidden="true" />
          <span>設定へ</span>
        </button>
      </section>

      <section className="aiRunSummary" aria-label="AI実行準備">
        <div className={canRunAi ? "summaryItem ready" : "summaryItem attention"}>
          <ShieldCheck size={17} aria-hidden="true" />
          <div>
            <strong>認証</strong>
            <span>{canRunAi ? "利用可能" : "設定待ち"}</span>
          </div>
        </div>
        <div className={hasDefaultModel ? "summaryItem ready" : "summaryItem attention"}>
          <Bot size={17} aria-hidden="true" />
          <div>
            <strong>モデル</strong>
            <span>{hasDefaultModel ? "既定値あり" : "フォームで指定"}</span>
          </div>
        </div>
        <div className={hasAiRegion ? "summaryItem ready" : "summaryItem attention"}>
          <MapPin size={17} aria-hidden="true" />
          <div>
            <strong>AIリージョン</strong>
            <span>{hasAiRegion ? aiRegion : "未入力"}</span>
          </div>
        </div>
        <div className={hasDefaultCompartment ? "summaryItem ready" : "summaryItem neutral"}>
          <DatabaseZap size={17} aria-hidden="true" />
          <div>
            <strong>Compartment</strong>
            <span>{hasDefaultCompartment ? "既定値あり" : "実行時に入力"}</span>
          </div>
        </div>
      </section>

      <section className="panel formPanel">
        <div className="panelHeader pricingHeader">
          <div>
            <h2>AI実行</h2>
            <span>実行結果は使用量レコードへ自動記録されます</span>
          </div>
          <div className="modeSwitcher" role="group" aria-label="AI実行モード">
            <button
              className={mode === "native-chat" ? "modeButton active" : "modeButton"}
              type="button"
              onClick={() => setMode("native-chat")}
              aria-pressed={mode === "native-chat"}
            >
              <Bot size={16} aria-hidden="true" />
              <span>Chat</span>
            </button>
            <button
              className={mode === "embedding" ? "modeButton active" : "modeButton"}
              type="button"
              onClick={() => setMode("embedding")}
              aria-pressed={mode === "embedding"}
            >
              <Hash size={16} aria-hidden="true" />
              <span>Embedding</span>
            </button>
            <button
              className={mode === "rerank" ? "modeButton active" : "modeButton"}
              type="button"
              onClick={() => setMode("rerank")}
              aria-pressed={mode === "rerank"}
            >
              <ListFilter size={16} aria-hidden="true" />
              <span>Rerank</span>
            </button>
          </div>
        </div>

        <form key={mode} className="formSections" onSubmit={handleSubmit} aria-busy={isRunning}>
          <fieldset className="formSection">
            <legend>実行先</legend>
            <div className="formGrid compact">
              <Field label="AI実行リージョン" name="region" defaultValue={aiRegion} required />
              <Field label="モデルID" name="modelId" defaultValue={modelDefault} required />
              <Field label="Compartment OCID" name="compartmentOcid" defaultValue={state.settings.defaultCompartmentOcid} required />
            </div>
            <p className="helperText tight">この値は本実行だけに適用されます。設定ページの既定リージョンは変更されません。</p>
          </fieldset>

          {isChatMode && (
            <fieldset className="formSection">
              <legend>生成パラメータ</legend>
              <div className="formGrid compact">
                <Field label="Temperature" name="temperature" type="number" step="0.01" min="0" defaultValue="0.2" />
                <Field label="Top P" name="topP" type="number" step="0.01" min="0" defaultValue="0.75" />
                <Field label="最大トークン" name="maxTokens" type="number" min="1" defaultValue="800" />
              </div>
            </fieldset>
          )}

          {isEmbeddingMode && (
            <fieldset className="formSection">
              <legend>Embedding設定</legend>
              <div className="formGrid compact">
                <label className="field">
                  <span>入力タイプ</span>
                  <select name="inputType" defaultValue="SEARCH_DOCUMENT">
                    <option value="SEARCH_DOCUMENT">SEARCH_DOCUMENT</option>
                    <option value="SEARCH_QUERY">SEARCH_QUERY</option>
                    <option value="CLASSIFICATION">CLASSIFICATION</option>
                    <option value="CLUSTERING">CLUSTERING</option>
                  </select>
                </label>
                <label className="field">
                  <span>Truncate</span>
                  <select name="truncate" defaultValue="END">
                    <option value="END">END</option>
                    <option value="START">START</option>
                    <option value="NONE">NONE</option>
                  </select>
                </label>
              </div>
            </fieldset>
          )}

          {isRerankMode && (
            <fieldset className="formSection">
              <legend>Rerank設定</legend>
              <div className="formGrid compact">
                <Field label="Top N" name="topN" type="number" min="1" defaultValue="5" />
              </div>
              <p className="helperText tight">候補文書数より大きい場合は、実行時に候補文書数へ自動調整します。</p>
            </fieldset>
          )}

          <fieldset className="formSection">
            <legend>入力</legend>
            {isChatMode && (
              <label className="field wide">
                <span>システムプロンプト</span>
                <textarea name="systemPrompt" rows={3} placeholder="あなたはOCI運用を支援するアシスタントです。" />
              </label>
            )}
            {isRerankMode && (
              <label className="field wide">
                <span>検索クエリ<em>必須</em></span>
                <textarea name="input" rows={3} required placeholder="候補文書を並べ替える検索文" />
              </label>
            )}
            <label className="field wide">
              <span>{isEmbeddingMode ? "Embedding入力" : isRerankMode ? "候補文書" : "ユーザープロンプト"}<em>必須</em></span>
              <textarea
                name={isEmbeddingMode ? "input" : isRerankMode ? "documents" : "prompt"}
                rows={isEmbeddingMode ? 6 : isRerankMode ? 7 : 7}
                required
                placeholder={isEmbeddingMode ? "1行につき1件のテキスト" : isRerankMode ? "空行で区切って候補文書を入力。1行1件でも利用できます。" : "OCI Generative AI に送信する内容"}
              />
            </label>
          </fieldset>

          <div className="actions">
            <button
              className="primaryButton iconButton"
              type="submit"
              disabled={isRunning || !canRunAi}
              aria-busy={isRunning}
            >
              {isRunning ? <span className="buttonSpinner" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              <span>{runButtonLabel}</span>
            </button>
            {!canRunAi && (
              <p className="inlineNotice" role="note">
                <ShieldCheck size={15} aria-hidden="true" />
                設定を保存するとこのモードを実行できます。
              </p>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>実行結果</h2>
          <span>{result ? `${result.latencyMs} ms` : "未実行"}</span>
        </div>
        {result ? (
          <div className="aiResultGrid">
            <div className="aiAnswer">
              <pre>{result.text || "レスポンス本文を抽出できませんでした。Raw JSONを確認してください。"}</pre>
            </div>
            <dl className="detailList compactDetail">
              <div><dt>モデル</dt><dd>{result.modelId || "-"}</dd></div>
              <div><dt>OPC Request ID</dt><dd>{result.opcRequestId || "-"}</dd></div>
              <div><dt>リクエスト/トランザクション</dt><dd>1</dd></div>
              <div><dt>入力トークン</dt><dd>{formatNumber(result.promptTokens)}</dd></div>
              <div><dt>キャッシュ入力トークン</dt><dd>0</dd></div>
              <div><dt>出力トークン</dt><dd>{formatNumber(result.completionTokens)}</dd></div>
              <div><dt>入力文字 / 出力文字</dt><dd>{formatNumber(result.inputCharacters)} / {formatNumber(result.outputCharacters)}</dd></div>
              <div><dt>Embedding</dt><dd>{result.embeddingCount ? `${formatNumber(result.embeddingCount)} 件 / ${formatNumber(result.embeddingDimensions)} 次元` : "-"}</dd></div>
              <div><dt>Rerank</dt><dd>{result.rerankCount ? `${formatNumber(result.rerankCount)} 件` : "-"}</dd></div>
            </dl>
            <details className="rawDetails">
              <summary>Raw JSON</summary>
              <textarea className="jsonInput" value={rawResponseText} readOnly rows={12} />
            </details>
          </div>
        ) : (
          <EmptyDataState
            icon={Bot}
            title="AI実行結果はまだありません"
            description="入力欄を埋めて実行すると、レスポンス、トークン、OPC Request ID がここに表示されます。"
          />
        )}
      </section>
    </section>
  );
}

function formatPricingTokenRange(rule: PricingRule) {
  if (rule.minimumPromptTokens === undefined && rule.maximumPromptTokens === undefined) return "";
  if (rule.minimumPromptTokens !== undefined) {
    return ` / 入力トークン ${formatNumber(rule.minimumPromptTokens)} 以上`;
  }
  if (rule.maximumPromptTokens !== undefined) {
    return ` / 入力トークン ${formatNumber(rule.maximumPromptTokens)} 未満`;
  }
  return "";
}

function formatPricingRuleUnits(rule: PricingRule) {
  if (rule.source === "oracle-pricing-api" && rule.oracleSkuRows?.length) {
    return rule.oracleSkuRows.length === 1 ? "Price List SKU" : `Price List SKU ${rule.oracleSkuRows.length}件`;
  }

  const units = [
    rule.requestUsd > 0 ? "リクエスト/トランザクション" : "",
    rule.inputCharacterUsd > 0 || rule.outputCharacterUsd > 0 ? "文字" : "",
    rule.inputTokenUsd > 0 || rule.cachedInputTokenUsd > 0 || rule.outputTokenUsd > 0 ? "token" : "",
    rule.searchUnitUsd > 0 ? "検索ユニット" : "",
    rule.eventUsd > 0 ? "イベント" : "",
    rule.storageGbHourUsd > 0 ? "GB時間" : "",
    rule.imageUsd > 0 ? "イメージ" : "",
    rule.dedicatedUnitHourUsd > 0 ? "専用ユニット時間" : "",
    rule.connectionMinuteUsd > 0 ? "接続分" : ""
  ].filter(Boolean);

  return units.length ? units.join(" / ") : "0 USD";
}

function formatOracleUnitPrice(value: number, currencyCode = "USD") {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2
  }).format(value || 0);
}

function formatOracleMetricName(metricName: string) {
  return metricName
    .replace(/\b1000000\b/g, "1,000,000")
    .replace(/\b10000\b/g, "10,000")
    .replace(/\b1000\b/g, "1,000");
}

function formatOfficialSkuSummary(rule: PricingRule) {
  const rows = rule.oracleSkuRows ?? [];
  if (!rows.length) return formatPricingRuleUnits(rule);
  if (rows.length === 1) {
    const row = rows[0];
    return `${formatOracleUnitPrice(row.unitPrice, row.currencyCode)} / ${formatOracleMetricName(row.metricName)}`;
  }
  const prices = rows.map((row) => row.unitPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const priceText = min === max
    ? formatOracleUnitPrice(min, rows[0].currencyCode)
    : `${formatOracleUnitPrice(min, rows[0].currencyCode)}-${formatOracleUnitPrice(max, rows[0].currencyCode)}`;
  return `${rows.length} SKU / ${priceText}`;
}

function countOraclePricingSkus(rules: PricingRule[]) {
  const partNumbers = new Set(
    rules
      .filter((rule) => rule.source === "oracle-pricing-api")
      .flatMap((rule) => rule.oraclePartNumbers ?? [])
      .filter(Boolean)
  );
  return partNumbers.size || rules.filter((rule) => rule.source === "oracle-pricing-api").length;
}

function countOraclePricingSections(rules: PricingRule[]) {
  return new Set(
    rules
      .filter((rule) => rule.source === "oracle-pricing-api")
      .flatMap((rule) => rule.oracleServiceCategories ?? [])
      .filter(Boolean)
  ).size;
}

function formatUsagePriceListUnits(record: UsageRecord) {
  const units = [
    record.requestCount ? `Req ${formatNumber(record.requestCount)}` : "",
    record.searchUnits ? `検索 ${formatNumber(record.searchUnits)}` : "",
    record.eventCount ? `Event ${formatNumber(record.eventCount)}` : "",
    record.storageGbHours ? `GBh ${formatNumber(record.storageGbHours)}` : "",
    record.imageCount ? `Image ${formatNumber(record.imageCount)}` : "",
    record.dedicatedUnitHours ? `専用 ${formatNumber(record.dedicatedUnitHours)}h` : "",
    record.connectionMinutes ? `接続 ${formatNumber(record.connectionMinutes)}分` : ""
  ].filter(Boolean);

  return units.length ? units.join(" / ") : "-";
}

function OracleSkuRows({ rule }: { rule: PricingRule }) {
  const rows = rule.oracleSkuRows ?? [];
  if (!rows.length) return null;

  return (
    <div className="oracleSkuRows" aria-label="Oracle Price List 明細">
      <div className="oracleSkuHeader">
        <strong>Oracle Price List 表示</strong>
        <span>Oracle公式サイトと同じ原始単価です。推定用の換算値は下の折りたたみに分けています。</span>
      </div>
      <div className="oracleSkuTableWrap">
        <table className="oracleSkuTable">
          <thead>
            <tr>
              <th>サービス</th>
              <th>単価</th>
              <th>単位</th>
              <th>SKU</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.partNumber}-${row.metricName}`}>
                <td>{row.displayName}</td>
                <td>{formatOracleUnitPrice(row.unitPrice, row.currencyCode)}</td>
                <td>{formatOracleMetricName(row.metricName)}</td>
                <td>{row.partNumber || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PricingRuleFields({ rule }: { rule: PricingRule }) {
  return (
    <div className="formGrid compact">
      <Field label="名前" name={`${rule.id}-name`} defaultValue={rule.name} />
      <Field label="モデル照合パターン" name={`${rule.id}-pattern`} defaultValue={rule.modelPattern} />
      <Field label="リクエスト USD" name={`${rule.id}-request`} type="number" step="0.000000001" defaultValue={String(rule.requestUsd)} />
      <Field label="入力文字 USD" name={`${rule.id}-input-char`} type="number" step="0.000000001" defaultValue={String(rule.inputCharacterUsd)} />
      <Field label="出力文字 USD" name={`${rule.id}-output-char`} type="number" step="0.000000001" defaultValue={String(rule.outputCharacterUsd)} />
      <Field label="入力トークン USD" name={`${rule.id}-input-token`} type="number" step="0.000000001" defaultValue={String(rule.inputTokenUsd)} />
      <Field label="キャッシュ入力トークン USD" name={`${rule.id}-cached-input-token`} type="number" step="0.000000001" defaultValue={String(rule.cachedInputTokenUsd)} />
      <Field label="出力トークン USD" name={`${rule.id}-output-token`} type="number" step="0.000000001" defaultValue={String(rule.outputTokenUsd)} />
      <Field label="検索ユニット USD" name={`${rule.id}-search-unit`} type="number" step="0.000000001" defaultValue={String(rule.searchUnitUsd)} />
      <Field label="イベント USD" name={`${rule.id}-event`} type="number" step="0.000000001" defaultValue={String(rule.eventUsd)} />
      <Field label="GB時間 USD" name={`${rule.id}-storage-gb-hour`} type="number" step="0.000000001" defaultValue={String(rule.storageGbHourUsd)} />
      <Field label="イメージ USD" name={`${rule.id}-image`} type="number" step="0.000000001" defaultValue={String(rule.imageUsd)} />
      <Field label="専用ユニット時間 USD" name={`${rule.id}-dedicated-unit-hour`} type="number" step="0.000000001" defaultValue={String(rule.dedicatedUnitHourUsd)} />
      <Field label="接続分 USD" name={`${rule.id}-connection-minute`} type="number" step="0.000000001" defaultValue={String(rule.connectionMinuteUsd)} />
    </div>
  );
}

function SettingsView({
  state,
  storageLocation,
  onSettingsSubmit,
  onPricingSubmit,
  onRefreshOraclePricing,
  isPricingRefreshing,
  onValidateSettings
}: {
  state: AppState;
  storageLocation: string;
  onSettingsSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPricingSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRefreshOraclePricing: () => void;
  isPricingRefreshing: boolean;
  onValidateSettings: () => void;
}) {
  const validation = validateSettings(state.settings);
  const officialPricingRules = state.pricingRules.filter((rule) => rule.source === "oracle-pricing-api");
  const officialPricingSkuCount = countOraclePricingSkus(officialPricingRules);
  const officialPricingSectionCount = countOraclePricingSections(officialPricingRules);
  const latestOraclePriceUpdatedAt = officialPricingRules.find((rule) => rule.oracleLastUpdated)?.oracleLastUpdated;
  const homeRegion = getHomeRegion(state.settings);
  const aiRegion = getAiRegion(state.settings);
  const enterpriseAiBaseUrlRegion = extractGenerativeAiRegion(state.settings.enterpriseAiBaseUrl);
  const recommendedEnterpriseAiBaseUrl = buildGenerativeAiBaseUrl(aiRegion);
  const hasEnterpriseAiRegionMismatch = Boolean(
    enterpriseAiBaseUrlRegion &&
    aiRegion &&
    enterpriseAiBaseUrlRegion !== aiRegion
  );
  const regionSettingsReady = Boolean(homeRegion && aiRegion);
  const ociAuthReady = Boolean(
    state.settings.tenancyOcid &&
    state.settings.userOcid &&
    state.settings.fingerprint &&
    regionSettingsReady
  );
  const privateKeyReady = Boolean(state.settings.privateKeyPem && state.settings.privateKeyPem.includes("BEGIN"));
  const ociCredentialReady = ociAuthReady && privateKeyReady;
  const modelDefaultsReady = Boolean(
    state.settings.defaultChatModelId &&
    state.settings.defaultEmbeddingModelId &&
    state.settings.defaultRerankModelId
  );
  const enterpriseAiEndpointReady = Boolean(state.settings.enterpriseAiBaseUrl);
  const settingsSetupSteps: SetupGuideStep[] = [
    {
      title: "OCI認証",
      description: "テナンシ、ユーザー、フィンガープリントを登録します。",
      actionLabel: "認証へ",
      href: "#settings-oci-auth",
      ready: ociAuthReady,
      icon: ShieldCheck
    },
    {
      title: "リージョン設定",
      description: "公式コスト用のHome RegionとAI実行リージョンを分けて保存します。",
      actionLabel: "リージョンへ",
      href: "#settings-regions",
      ready: regionSettingsReady,
      icon: MapPin
    },
    {
      title: "秘密鍵",
      description: "PEM形式の秘密鍵を保存し、API署名に使える状態にします。",
      actionLabel: "秘密鍵へ",
      href: "#settings-private-key",
      ready: privateKeyReady,
      icon: KeyRound
    },
    {
      title: "Generative AIモデル",
      description: "Chat / Embedding / Rerank の既定モデルを保存します。",
      actionLabel: "モデルへ",
      href: "#settings-model-defaults",
      ready: modelDefaultsReady,
      icon: Bot
    },
    {
      title: "公式価格",
      description: "Oracle Price List の OCI Generative AI / Agents 対象SKUを取得します。",
      actionLabel: "価格へ",
      href: "#settings-pricing-rules",
      ready: officialPricingRules.length > 0,
      icon: CircleDollarSign
    }
  ];

  return (
    <section className="pageStack">
      <PageLead
        icon={Settings}
        title="運用前の設定"
        description="OCI認証、秘密鍵、Generative AIモデル、OCI Enterprise AI、公式価格ルールを分けて管理します。用途ごとの設定を分離するとAI実行と価格照合が安定します。"
        items={[
          { label: "OCI認証", value: ociCredentialReady ? "完了" : "未完了" },
          { label: "Home Region", value: homeRegion || "未入力" },
          { label: "AIリージョン", value: aiRegion || "未入力" },
          { label: "公式価格SKU", value: `${formatNumber(officialPricingSkuCount)}件` },
          { label: "保存先", value: storageLocation ? "確認済み" : "確認中" }
        ]}
      />
      <section className={validation.ready ? "statusPanel ready" : "statusPanel attention"} role={validation.ready ? "status" : "alert"}>
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <h2>{validation.ready ? "OCI API設定は利用できます" : "OCI API設定を完了してください"}</h2>
          <p>{validation.messages.join(" ")}</p>
        </div>
      </section>

      <section className="settingsSummary" aria-label="設定サマリー">
        <div className={ociCredentialReady ? "summaryItem ready" : "summaryItem attention"}>
          <ShieldCheck size={17} aria-hidden="true" />
          <div>
            <strong>OCI認証</strong>
            <span>{ociCredentialReady ? "保存済み" : "必須項目待ち"}</span>
          </div>
        </div>
        <div className={officialPricingRules.length ? "summaryItem ready" : "summaryItem attention"}>
          <CircleDollarSign size={17} aria-hidden="true" />
          <div>
            <strong>公式価格</strong>
            <span>{officialPricingSkuCount ? `SKU ${officialPricingSkuCount}件` : "未取得"}</span>
          </div>
        </div>
        <div className={regionSettingsReady ? "summaryItem ready" : "summaryItem attention"}>
          <MapPin size={17} aria-hidden="true" />
          <div>
            <strong>リージョン</strong>
            <span>{regionSettingsReady ? `${homeRegion} / ${aiRegion}` : "未入力"}</span>
          </div>
        </div>
        <div className={modelDefaultsReady ? "summaryItem ready" : "summaryItem attention"}>
          <Bot size={17} aria-hidden="true" />
          <div>
            <strong>既定モデル</strong>
            <span>{modelDefaultsReady ? "保存済み" : "未入力"}</span>
          </div>
        </div>
        <div className={enterpriseAiEndpointReady ? "summaryItem ready" : "summaryItem neutral"}>
          <FolderKanban size={17} aria-hidden="true" />
          <div>
            <strong>OCI Enterprise AI</strong>
            <span>{enterpriseAiEndpointReady ? "Base URLあり" : "未入力"}</span>
          </div>
        </div>
      </section>

      <SettingsSetupGuide steps={settingsSetupSteps} />

      <form id="settings-oci-form" className="panel formPanel" onSubmit={onSettingsSubmit}>
        <div className="panelHeader">
          <h2>OCI APIキー設定</h2>
          <span>{storageLocation}</span>
        </div>
        <div className="formSections">
          <fieldset id="settings-oci-auth" className="formSection">
            <legend>OCI認証</legend>
            <div className="formGrid compact">
              <Field label="テナンシ OCID" name="tenancyOcid" defaultValue={state.settings.tenancyOcid} required />
              <Field label="ユーザー OCID" name="userOcid" defaultValue={state.settings.userOcid} required />
              <Field label="フィンガープリント" name="fingerprint" defaultValue={state.settings.fingerprint} required />
              <Field label="既定 Compartment OCID" name="defaultCompartmentOcid" defaultValue={state.settings.defaultCompartmentOcid} />
              <PasswordField label="秘密鍵パスフレーズ" name="passphrase" defaultValue={state.settings.passphrase} />
            </div>
          </fieldset>

          <fieldset id="settings-regions" className="formSection">
            <legend>リージョン設定</legend>
            <div className="formGrid compact">
              <Field label="Home Region（公式コスト）" name="homeRegion" defaultValue={homeRegion} required />
              <Field label="AI実行リージョン" name="aiRegion" defaultValue={aiRegion} required />
            </div>
            <div className="regionRoleGrid" aria-label="リージョンの用途">
              <div className="regionRoleCard">
                <ReceiptText size={16} aria-hidden="true" />
                <div>
                  <strong>公式コスト取得</strong>
                  <span>OCI Usage API はテナンシの Home Region で呼び出します。</span>
                </div>
              </div>
              <div className="regionRoleCard">
                <Bot size={16} aria-hidden="true" />
                <div>
                  <strong>AI実行</strong>
                  <span>Chat / Embedding / Rerank の既定リージョンです。実行時に一時変更できます。</span>
                </div>
              </div>
            </div>
          </fieldset>

          <fieldset id="settings-private-key" className="formSection">
            <legend>秘密鍵</legend>
            <PrivateKeyFileField label="秘密鍵 PEM" name="privateKeyPem" defaultValue={state.settings.privateKeyPem} required />
          </fieldset>

          <fieldset id="settings-model-defaults" className="formSection">
            <legend>Generative AI モデル既定値</legend>
            <div className="formGrid compact">
              <Field label="既定チャットモデルID" name="defaultChatModelId" defaultValue={state.settings.defaultChatModelId} required />
              <Field label="既定EmbeddingモデルID" name="defaultEmbeddingModelId" defaultValue={state.settings.defaultEmbeddingModelId} required />
              <Field label="既定RerankモデルID" name="defaultRerankModelId" defaultValue={state.settings.defaultRerankModelId} required />
            </div>
          </fieldset>

          <fieldset id="settings-enterprise-ai" className="formSection">
            <legend>OCI Enterprise AI 設定</legend>
            <div className="formGrid compact">
              <Field label="Enterprise AI Base URL" name="enterpriseAiBaseUrl" defaultValue={state.settings.enterpriseAiBaseUrl} required />
              <Field label="Enterprise AI Project OCID" name="enterpriseAiProjectOcid" defaultValue={state.settings.enterpriseAiProjectOcid} />
              <PasswordField label="Enterprise AI APIキー" name="enterpriseAiApiKey" defaultValue={state.settings.enterpriseAiApiKey} />
            </div>
            <p className="helperText tight">推奨Base URL: {recommendedEnterpriseAiBaseUrl}</p>
            {hasEnterpriseAiRegionMismatch && (
              <p className="inlineNotice regionMismatchNotice" role="alert">
                <AlertTriangle size={15} aria-hidden="true" />
                Base URL は {enterpriseAiBaseUrlRegion}、AI実行リージョンは {aiRegion} です。意図しない場合はどちらかを揃えてください。
              </p>
            )}
          </fieldset>
        </div>
        <div className="actions">
          <button className="primaryButton iconButton" type="submit">
            <Save size={16} aria-hidden="true" />
            <span>設定を保存</span>
          </button>
          <button className="secondaryButton iconButton" type="button" onClick={onValidateSettings}>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>入力を確認</span>
          </button>
        </div>
      </form>

      <form id="settings-pricing-rules" className="panel formPanel" onSubmit={onPricingSubmit}>
        <div className="panelHeader pricingHeader">
          <div>
            <h2>価格ルール</h2>
            <span>Oracle Price List の OCI Generative AI / Agents を対象に、各SKUを使用量単位へ換算</span>
          </div>
          <button
            className="secondaryButton iconButton"
            type="button"
            onClick={onRefreshOraclePricing}
            disabled={isPricingRefreshing}
            aria-busy={isPricingRefreshing}
          >
            {isPricingRefreshing ? <span className="buttonSpinner" aria-hidden="true" /> : <RefreshCcw size={16} aria-hidden="true" />}
            <span>{isPricingRefreshing ? "取得中" : "Oracle公式価格から更新"}</span>
          </button>
        </div>
        <div className="pricingSourceBar">
          <span>Price List SKU: <strong>{officialPricingSkuCount}</strong> 件</span>
          <span>価格ルール: <strong>{officialPricingRules.length}</strong> 件</span>
          <span>対象セクション: <strong>{officialPricingSectionCount || 0}</strong></span>
          <span>最終更新: <strong>{latestOraclePriceUpdatedAt ? formatDateTime(latestOraclePriceUpdatedAt) : "未取得"}</strong></span>
          <span>通貨: <strong>USD</strong></span>
        </div>
        {state.pricingRules.map((rule, index) => (
          <details className="pricingRule" key={rule.id} open={rule.source !== "oracle-pricing-api" || index < 2}>
            <summary className="pricingRuleSummary">
              <span className="pricingRuleTitle">
                <strong>{rule.name}</strong>
                <small>{rule.modelPattern}</small>
              </span>
              <span className="pricingRuleBadges">
                <span className={rule.active ? "badge good" : "badge muted"}>{rule.active ? "有効" : "停止"}</span>
                <span className="pricingTag">{rule.source === "oracle-pricing-api" ? "Oracle公式" : "手動"}</span>
                <span className="pricingTag">{formatOfficialSkuSummary(rule)}</span>
              </span>
            </summary>
            <div className="pricingRuleBody">
              <label className="switchLine">
                <input name={`${rule.id}-active`} type="checkbox" defaultChecked={rule.active} />
                <span>有効</span>
              </label>
              {rule.source === "oracle-pricing-api" && (
                <p className="pricingMeta">
                  Oracle公式SKU {rule.oraclePartNumbers?.join(", ") || "-"} / {rule.oracleMetricNames?.join(", ") || "-"}
                  {rule.oracleServiceCategories?.length ? ` / ${rule.oracleServiceCategories.join(", ")}` : ""}
                  {formatPricingTokenRange(rule)}
                </p>
              )}
              <OracleSkuRows rule={rule} />
              {rule.source === "oracle-pricing-api" ? (
                <details className="convertedRateDetails">
                  <summary>
                    <span>推定用換算値</span>
                    <small>1 token / 1 request / 1 GB時間 などの内部単価</small>
                  </summary>
                  <PricingRuleFields rule={rule} />
                </details>
              ) : (
                <PricingRuleFields rule={rule} />
              )}
            </div>
          </details>
        ))}
        <div className="actions">
          <button className="primaryButton iconButton" type="submit">
            <CircleDollarSign size={16} aria-hidden="true" />
            <span>価格ルールを保存</span>
          </button>
        </div>
      </form>
    </section>
  );
}

function PageLead({
  icon: Icon,
  title,
  description,
  items
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="pageLead">
      <div className="pageLeadIcon" aria-hidden="true">
        <Icon size={20} />
      </div>
      <div className="pageLeadCopy">
        <span className="panelKicker">作業コンテキスト</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <dl className="pageLeadStats" aria-label={`${title}のサマリー`}>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SettingsSetupGuide({ steps }: { steps: SetupGuideStep[] }) {
  const completed = steps.filter((step) => step.ready).length;
  const nextStep = steps.find((step) => !step.ready);
  const percent = Math.round((completed / steps.length) * 100);

  return (
    <section className="setupGuide" aria-label="初期設定ガイド">
      <div className="setupGuideTop">
        <div>
          <span className="panelKicker">初期設定ガイド</span>
          <h2>{nextStep ? `次は「${nextStep.title}」を完了します` : "設定は運用開始できる状態です"}</h2>
          <p>{nextStep ? nextStep.description : "AI実行、公式価格取得、コスト照合へ進めます。"}</p>
        </div>
        <div className="setupProgressMeta" aria-label="設定完了度">
          <strong>{completed}/{steps.length}</strong>
          <span>{percent}% 完了</span>
        </div>
      </div>
      <div className="progressTrack setupProgressTrack" aria-hidden="true">
        <div className="progressFill" style={{ width: `${percent}%` }} />
      </div>
      <div className="setupStepGrid">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <a className={step.ready ? "setupStep ready" : "setupStep"} href={step.href} key={step.title}>
              <span className="setupStepIcon"><Icon size={17} aria-hidden="true" /></span>
              <span className="setupStepText">
                <strong>{step.title}</strong>
                <small>{step.description}</small>
              </span>
              <span className={step.ready ? "badge good" : "badge muted"}>{step.ready ? "完了" : step.actionLabel}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue = "",
  step,
  min,
  required = false
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  step?: string;
  min?: string;
  required?: boolean;
}) {
  const inputMode = type === "number" ? (step && step.includes(".") ? "decimal" : "numeric") : undefined;

  return (
    <label className="field">
      <span>{label}{required && <em>必須</em>}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        step={step}
        min={min}
        required={required}
        inputMode={inputMode}
      />
    </label>
  );
}

function PrivateKeyFileField({
  label,
  name,
  defaultValue = "",
  required = false
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const [content, setContent] = useState(defaultValue);
  const [fileName, setFileName] = useState(defaultValue ? "保存済みの秘密鍵 PEM" : "");
  const [error, setError] = useState("");

  const handleChange = async (event: FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setContent(text);
      setFileName(file.name);
      setError(text.includes("BEGIN") ? "" : "PEM形式の秘密鍵ファイルを確認してください。");
    } catch {
      setContent("");
      setFileName("");
      setError("秘密鍵ファイルの読み込みに失敗しました。");
    }
  };

  return (
    <label className="field">
      <span>{label}{required && <em>必須</em>}</span>
      <input
        type="file"
        required={required && !content}
        onChange={handleChange}
      />
      <input type="hidden" name={name} value={content} readOnly />
      <small className={error ? "helperText errorText" : "helperText"}>
        {error || (fileName ? `${fileName} を読み込みました。` : "PEM形式の秘密鍵ファイルを選択してください。")}
      </small>
    </label>
  );
}

function PasswordField({
  label,
  name,
  defaultValue = "",
  required = false
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const labelText = `${label}${required ? " 必須" : ""}`;

  return (
    <label className="field">
      <span>{label}{required && <em>必須</em>}</span>
      <span className="passwordFieldShell">
        <input
          name={name}
          type={visible ? "text" : "password"}
          defaultValue={defaultValue}
          required={required}
          autoComplete="off"
        />
        <button
          className="ghostButton iconOnlyButton passwordToggle"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={`${labelText}を${visible ? "非表示" : "表示"}`}
          aria-pressed={visible}
          title={visible ? "非表示" : "表示"}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="emptyText">{text}</p>;
}

function EmptyDataState({
  icon: Icon,
  title,
  description,
  actionLabel,
  href
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  href?: string;
}) {
  return (
    <div className="emptyDataState">
      <span className="emptyDataIcon" aria-hidden="true"><Icon size={20} /></span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {actionLabel && href && (
        <a className="secondaryButton iconButton" href={href}>
          <ArrowRight size={16} aria-hidden="true" />
          <span>{actionLabel}</span>
        </a>
      )}
    </div>
  );
}

function buildAiUsageRecord(
  state: AppState,
  result: OciAiRunResult,
  request: OciAiRunRequest,
  mode: AiRunMode
): UsageRecord {
  const fallbackInputText = [request.prompt, request.input, request.documents].filter(Boolean).join("\n");
  const record: UsageRecord = {
    id: createId("usage-ai"),
    occurredAt: nowIso(),
    source: aiModeLabels[mode],
    service: "OCI Generative AI On-Demand",
    region: getAiRequestRegion(state.settings, request),
    compartmentOcid: request.compartmentOcid || state.settings.defaultCompartmentOcid,
    projectName: request.projectName || "",
    projectOcid: request.projectOcid || state.settings.enterpriseAiProjectOcid,
    modelId: result.modelId || request.modelId,
    requestCount: 1,
    promptTokens: result.promptTokens || 0,
    cachedInputTokens: 0,
    completionTokens: result.completionTokens || 0,
    searchUnits: 0,
    eventCount: 0,
    storageGbHours: 0,
    imageCount: 0,
    dedicatedUnitHours: 0,
    connectionMinutes: 0,
    inputCharacters: result.inputCharacters || [...fallbackInputText].length,
    outputCharacters: result.outputCharacters || 0,
    latencyMs: result.latencyMs || 0,
    status: "成功",
    opcRequestId: result.opcRequestId,
    estimatedCostUsd: 0,
    officialAllocatedCostUsd: 0,
    billingReconciled: false,
    notes: `${aiModeLabels[mode]} から自動記録しました。`
  };
  record.estimatedCostUsd = estimateCost(record, state.pricingRules);
  return record;
}

function groupByModel(records: UsageRecord[]) {
  const groups = records.reduce<Record<string, { modelId: string; requests: number; cost: number }>>((acc, record) => {
    const key = record.modelId || "未指定モデル";
    acc[key] ??= { modelId: key, requests: 0, cost: 0 };
    acc[key].requests += 1;
    acc[key].cost += record.estimatedCostUsd;
    return acc;
  }, {});
  const values = Object.values(groups).sort((a, b) => b.cost - a.cost);
  const max = Math.max(...values.map((group) => group.cost), 0);
  return values.map((group) => ({
    ...group,
    percent: max > 0 ? Math.max(8, (group.cost / max) * 100) : 8
  }));
}

function groupByProject(records: UsageRecord[], officialCosts: AppState["officialCosts"]) {
  const groups: Record<string, {
    key: string;
    label: string;
    projectOcid: string;
    requests: number;
    estimatedCost: number;
    officialCost: number;
  }> = {};
  const ensureGroup = (projectName: string, projectOcid: string) => {
    const key = projectOcid || projectName || "project-unspecified";
    groups[key] ??= {
      key,
      label: projectName || projectOcid || "Project未指定",
      projectOcid,
      requests: 0,
      estimatedCost: 0,
      officialCost: 0
    };
    if (projectName && groups[key].label === "Project未指定") {
      groups[key].label = projectName;
    }
    if (projectOcid && !groups[key].projectOcid) {
      groups[key].projectOcid = projectOcid;
    }
    return groups[key];
  };

  records.forEach((record) => {
    const group = ensureGroup(record.projectName, record.projectOcid);
    group.requests += 1;
    group.estimatedCost += record.estimatedCostUsd;
  });

  officialCosts.forEach((cost) => {
    const group = ensureGroup(cost.projectName, cost.projectOcid);
    group.officialCost += cost.computedAmountUsd;
  });

  const values = Object.values(groups).sort((a, b) => (b.estimatedCost + b.officialCost) - (a.estimatedCost + a.officialCost));
  const max = Math.max(...values.map((group) => group.estimatedCost + group.officialCost), 0);
  return values.map((group) => ({
    ...group,
    percent: max > 0 ? Math.max(8, ((group.estimatedCost + group.officialCost) / max) * 100) : 8
  }));
}

function readHashView(): ViewId {
  const hash = window.location.hash.replace("#", "");
  return navItems.some((item) => item.id === hash) ? (hash as ViewId) : "dashboard";
}

export default App;
