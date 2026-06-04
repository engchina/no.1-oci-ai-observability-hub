# no.1-oci-ai-observability-hub

OCI Generative AI の Chat / Embedding / Rerank 利用量とコストを、Project 単位で確認するためのデスクトップアプリです。

## できること

- OCI APIキー設定を保存します: テナンシ OCID、ユーザー OCID、フィンガープリント、リージョン、秘密鍵 PEM、既定 Compartment、既定 Project、既定 Chat / Embedding / Rerank モデル。
- OCI Generative AI Chat を実行し、モデルID、入力/出力トークン、入力/出力文字数、レイテンシ、`opc-request-id`、推定コストを使用量レコードへ自動記録します。
- OCI Generative AI Embedding を実行し、入力文字数、ベクトル件数、次元数、`opc-request-id`、推定コストを使用量レコードへ自動記録します。
- OCI Generative AI Rerank を実行し、検索クエリ、候補文書、順位件数、`opc-request-id`、推定コストを使用量レコードへ自動記録します。
- 使用量画面で自動記録されたレコードを検索し、Project 名または Project OCID、Request ID、Price List単位の推定コストを確認できます。
- Oracle 公式価格 API から OCI Generative AI / OCI Generative AI Agents の対象SKUを取得し、リクエスト/トランザクション、文字、入力/キャッシュ入力/出力トークン、検索ユニット、イベント、GB時間、イメージ、専用ユニット時間、接続分の価格ルールに変換します。
- OCI Usage API から公式コストを直接取得し、Project / compartment / region に基づいて使用量へ按分できます。
- 概要画面で、推定コスト、公式コスト、未照合コスト、モデル別使用量、Project 別使用量とコストを確認できます。

Oracle 公式価格は次のエンドポイントから取得します。

```text
https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/
```

公式コストは、保存済みのOCI APIキーで次のUsage APIへ署名付きPOSTして取得します。

```text
https://usageapi.<region>.oci.oraclecloud.com/20200107/usage
```

このアプリは OCI Generative AI Chat / Embedding / Rerank の実行と、Oracle Price List に掲載される OCI Generative AI / OCI Generative AI Agents 対象SKUの使用量確認に集中しています。その他の AI 実行 API、外部トレース連携、Compute デプロイ機能は対象外です。

## デスクトップアプリ

- React 18 + Vite + TypeScript
- Tauri 2
- ローカル app-data JSON 永続化
- GitHub Actions による Windows / macOS パッケージ作成

すべての画面文言は日本語です。

## 開発

依存関係をインストールします。

```bash
npm install
```

Tauri デスクトップアプリを起動します。

```bash
npm run dev
```

ブラウザのみで確認する場合は次を使います。OCI Generative AI 実行はデスクトップアプリから利用してください。

```bash
npm run dev:web
```

## ビルド

```bash
npm run build
npm run tauri build
```

## 公式コスト取得

公式コスト画面で開始日、終了日、粒度を指定して「OCIから公式コストを取得」を実行します。日次取得は90日以内、月次取得は12か月以内で指定してください。サービスフィルターはカンマ区切りで複数指定できます。空欄にすると全サービスを取得します。

API取得には、OCI IAMポリシーでUsage APIまたはCost Analysisの読み取り権限が必要です。請求・使用量データは反映まで時間差があります。
