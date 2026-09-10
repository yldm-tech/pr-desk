# PR Desk

[English](../README.md) · [简体中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md) · [Español](README.es.md)

[![CI](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/releases)
[![Go](https://img.shields.io/badge/Go-1.26.8-00ADD8?logo=go&logoColor=white)](../apps/api/go.mod)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](../apps/web/package.json)
[![Bun](https://img.shields.io/badge/Bun-1.3.4-000000?logo=bun&logoColor=white)](../package.json)
[![Stars](https://img.shields.io/github/stars/yldm-tech/pr-desk?style=flat)](https://github.com/yldm-tech/pr-desk/stargazers)

自分でホストできる GitHub PR ダッシュボードです。複数のリポジトリに送った PR のチェック失敗、変更要求、マージ競合をまとめて確認でき、過去の活動とバックグラウンド同期にも対応しています。

## 主な機能

- 対応が必要な PR をチェック失敗、変更要求、マージ競合から見つけ、リポジトリで絞り込みます。
- リポジトリを横断して貢献を閲覧し、PR の検索やレビューの動きを確認できます。
- GitHub に接続すると履歴の取り込みが自動で始まり、進捗と最終同期成功時刻が表示されます。ページを閉じてもバックグラウンドで更新が続きます。
- 非公開リポジトリへのアクセス権を確認し、対象リポジトリに GitHub App をインストールできます。

現在は自分が作成した PR が中心です。自分にレビューが依頼されたすべての PR を集める受信箱ではありません。

## 初回起動

1. `.env.example` を `.env` にコピーし、`openssl rand -hex 16` で固有の `TOKEN_ENCRYPTION_KEY` を生成します。
2. GitHub App を作成し、クライアント ID、クライアントシークレット、App slug を `.env` に設定します。コールバック URL は `http://localhost:8080/api/v1/auth/github/callback` にします。サーバー上で運用する場合は、そのインスタンスの正確な HTTPS コールバック URL を登録します。
3. `docker compose up -d --build` を実行し、`http://localhost:8080` を開いて GitHub に接続します。初回の取り込みには数分かかる場合があります。

非公開 PR の取得には、対象リポジトリへの App のインストールと Pull requests、Checks、Commit statuses の読み取り権限が必要です。[設定と運用](../docs/development.md)、[データの取り扱い](../docs/privacy.md)、[セキュリティ](../SECURITY.md)を参照してください。Compose のデータベース認証情報はローカル開発用の例です。公開する二つのポートはループバックにバインドされます。

## リポジトリ構成

```text
apps/
  api/                  Go API、PostgreSQL モデル、テスト
  web/                  React/Vite フロントエンド、テスト
doc/                    README の翻訳
docs/                   開発、運用、ライブラリ選定の説明
scripts/                バックアップと CI 補助スクリプト
.github/workflows/      CI チェックと条件付きイメージリリース
```

Vite+（`vp`）で開発、ビルド、テスト、整形、lint を実行します。Bun はルートから JavaScript ワークスペースを管理し、Go の依存関係は `apps/api/go.mod` で管理します。Docker ビルドのコンテキストはリポジトリのルートです。

## コマンド

```sh
vp install --frozen-lockfile
vp run dev              # Web 開発サーバー
make api                # API：必要な環境変数を先に設定
vp check                # 整形、lint、型チェック
vp run test             # Go/Web テストと本番ビルド
make build              # Web を埋め込んだ dist/pr-desk バイナリ
make production         # アプリケーションコンテナ一つと PostgreSQL
```

[公式手順](https://viteplus.dev/guide/)に従ってグローバルの `vp` CLI をインストールしてください。ツールのバージョンは `package.json` と `.node-version` に固定されています。整形と lint の設定はルートの `vite.config.ts` にあります。`vp fmt` で整形でき、行幅は Oxfmt の最大値である 320 です。

接続前に GitHub App の認可と `.env` を設定してください。設定、ポート、データベースのバックアップ、バックグラウンド同期は[開発と運用](../docs/development.md)を参照してください。

## CI とリリース

PR と main では、GitHub ホストランナー上で Web チェック、独立した PostgreSQL を使う Go の競合検出・統合テスト、フロントエンドを埋め込んだ Docker ビルドを実行します。main の CI が成功すると GHCR のアプリケーションイメージと GitHub Release を公開します。

トリガー、タグ、イメージによるデプロイは [CI/CD](../docs/ci-cd.md)、使用ライブラリは[ライブラリ選定](../docs/library-audit.md)を参照してください。

## コントリビューション

ローカルチェックと PR の手順は [CONTRIBUTING.md](../CONTRIBUTING.md) にあります。脆弱性は [SECURITY.md](../SECURITY.md) に記載された非公開の窓口へ報告してください。

[![Contributors](https://contrib.rocks/image?repo=yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/graphs/contributors)

[すべての貢献者](https://github.com/yldm-tech/pr-desk/graphs/contributors)。アバターは contrib.rocks が提供し、公開アクセス可能なリポジトリが必要です。

## Star の履歴

[![Star History Chart](https://api.star-history.com/svg?repos=yldm-tech/pr-desk&type=Date)](https://star-history.com/#yldm-tech/pr-desk&Date)

グラフと公開リポジトリのバッジは、リポジトリの公開後に利用できます。[GitHub で Stargazers を見る](https://github.com/yldm-tech/pr-desk/stargazers)。

## ライセンス

PR Desk は [Apache License 2.0](../LICENSE) で提供されています。
