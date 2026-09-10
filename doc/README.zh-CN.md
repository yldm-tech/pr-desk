# PR Desk

[English](../README.md) · **简体中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md)

[![CI](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/releases)
[![Go](https://img.shields.io/badge/Go-1.26.8-00ADD8?logo=go&logoColor=white)](../apps/api/go.mod)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](../apps/web/package.json)
[![Bun](https://img.shields.io/badge/Bun-1.3.4-000000?logo=bun&logoColor=white)](../package.json)
[![Stars](https://img.shields.io/github/stars/yldm-tech/pr-desk?style=flat)](https://github.com/yldm-tech/pr-desk/stargazers)

一个可自行部署的 GitHub PR 面板，集中查看你在不同仓库提交的 PR、失败的检查、修改请求和合并冲突，并提供历史贡献统计和后台同步。

## 功能

- 在「需要处理」中查看检查失败、被要求修改或存在合并冲突的 PR，并按仓库筛选。
- 浏览跨仓库贡献、搜索 PR、查看评审动态。
- 连接 GitHub 后自动导入历史记录，显示同步进度和上次成功同步时间；关闭页面后后台仍会更新。
- 查看私有仓库的访问授权，并为需要访问的仓库安装 GitHub App。

PR Desk 目前围绕你创建的 PR 提供功能，并不是所有邀请你参与评审的 PR 的完整收件箱。

## 首次运行

1. 将 `.env.example` 复制为 `.env`，使用 `openssl rand -hex 16` 生成唯一的 `TOKEN_ENCRYPTION_KEY`。
2. 创建 GitHub App，在 `.env` 中填写客户端 ID、客户端密钥和 App slug。回调地址设为 `http://localhost:8080/api/v1/auth/github/callback`；部署到服务器时，使用该实例准确的 HTTPS 回调地址。
3. 运行 `docker compose up -d --build`，打开 `http://localhost:8080` 并连接 GitHub。首次导入可能需要几分钟。

访问私有 PR 需要在对应仓库安装 App，并授予 Pull requests、Checks 和 Commit statuses 的读取权限。参见[配置与运维](../docs/development.md)、[数据处理](../docs/privacy.md)和[安全说明](../SECURITY.md)。Compose 中的数据库凭据仅供本地开发示例使用，两个公开端口均绑定到本机回环地址。

## 仓库结构

```text
apps/
  api/                  Go API、PostgreSQL 模型和测试
  web/                  React/Vite 前端和测试
doc/                    多语言 README
docs/                   开发、运维和依赖选型说明
scripts/                备份和 CI 辅助脚本
.github/workflows/      CI 检查和受检查约束的镜像发布
```

Vite+（`vp`）提供开发、构建、测试、格式化和检查命令。Bun 在根目录管理 JavaScript 工作区，Go 依赖保留在 `apps/api/go.mod`。应用的 Docker 构建使用仓库根目录作为上下文。

## 常用命令

```sh
vp install --frozen-lockfile
vp run dev              # Web 开发服务器
make api                # API，需先导出必要的环境变量
vp check                # 格式、lint 和类型检查
vp run test             # Go 测试、Web 测试和生产构建
make build              # 内嵌 Web 资源的 dist/pr-desk 二进制
make production         # 一个应用容器和 PostgreSQL
```

按 [Vite+ 官方说明](https://viteplus.dev/guide/)安装全局 `vp` CLI。工具版本固定在 `package.json` 和 `.node-version` 中，格式化及 lint 配置位于根目录 `vite.config.ts`。运行 `vp fmt` 格式化代码，行宽使用 Oxfmt 支持的最大值 320。

连接前请配置 GitHub App 授权和 `.env`。配置、端口、数据库备份与后台同步详见[开发与运维](../docs/development.md)。

## CI 与发布

PR 和 main 分支使用 GitHub 托管的运行器执行 Web 检查、使用独立 PostgreSQL 的 Go 竞态与集成测试，以及内嵌前端的应用 Docker 构建。main 分支 CI 成功后会发布 GHCR 应用镜像和 GitHub Release。

触发条件、标签和镜像部署参见 [CI/CD](../docs/ci-cd.md)，依赖使用情况参见[依赖选型](../docs/library-audit.md)。

## 参与贡献

本地检查和 PR 提交说明见 [CONTRIBUTING.md](../CONTRIBUTING.md)。请通过 [SECURITY.md](../SECURITY.md) 中描述的私密渠道报告安全漏洞。

[![Contributors](https://contrib.rocks/image?repo=yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/graphs/contributors)

[查看所有贡献者](https://github.com/yldm-tech/pr-desk/graphs/contributors)。贡献者头像由 contrib.rocks 提供，需要仓库公开可访问。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=yldm-tech/pr-desk&type=Date)](https://star-history.com/#yldm-tech/pr-desk&Date)

仓库公开后，图表和公开仓库徽章才可用。[在 GitHub 查看 Stargazers](https://github.com/yldm-tech/pr-desk/stargazers)。

## 许可证

PR Desk 使用 [Apache License 2.0](../LICENSE)。
