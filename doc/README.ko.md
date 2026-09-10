# PR Desk

[English](../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md)

[![CI](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/releases)
[![Go](https://img.shields.io/badge/Go-1.26.8-00ADD8?logo=go&logoColor=white)](../apps/api/go.mod)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](../apps/web/package.json)
[![Bun](https://img.shields.io/badge/Bun-1.3.4-000000?logo=bun&logoColor=white)](../package.json)
[![Stars](https://img.shields.io/github/stars/yldm-tech/pr-desk?style=flat)](https://github.com/yldm-tech/pr-desk/stargazers)

직접 호스팅할 수 있는 GitHub PR 대시보드입니다. 여러 저장소에 제출한 PR의 검사 실패, 변경 요청, 병합 충돌을 한곳에서 확인하고 과거 활동과 백그라운드 동기화를 관리합니다.

## 주요 기능

- 처리가 필요한 PR에서 검사 실패, 변경 요청, 병합 충돌을 확인하고 저장소별로 필터링합니다.
- 여러 저장소의 기여 내역을 탐색하고 PR을 검색하며 리뷰 활동을 확인합니다.
- GitHub에 연결하면 기록을 자동으로 가져오며 진행 상황과 마지막 동기화 성공 시각을 표시합니다. 페이지를 닫아도 백그라운드 업데이트가 계속됩니다.
- 비공개 저장소 접근 권한을 확인하고 필요한 저장소에 GitHub App을 설치합니다.

현재 PR Desk는 직접 작성한 PR을 중심으로 동작합니다. 리뷰를 요청받은 모든 PR을 모으는 통합 받은편지함은 아닙니다.

## 처음 실행하기

1. `.env.example`을 `.env`로 복사하고 `openssl rand -hex 16`으로 고유한 `TOKEN_ENCRYPTION_KEY`를 생성합니다.
2. GitHub App을 만들고 클라이언트 ID, 클라이언트 시크릿, App slug를 `.env`에 설정합니다. 콜백 URL은 `http://localhost:8080/api/v1/auth/github/callback`으로 등록합니다. 서버에 배포할 경우 해당 인스턴스의 정확한 HTTPS 콜백 URL을 사용합니다.
3. `docker compose up -d --build`를 실행한 뒤 `http://localhost:8080`을 열고 GitHub에 연결합니다. 최초 가져오기는 몇 분 걸릴 수 있습니다.

비공개 PR에 접근하려면 해당 저장소에 App을 설치하고 Pull requests, Checks, Commit statuses 읽기 권한을 부여해야 합니다. [설정 및 운영](../docs/development.md), [데이터 처리](../docs/privacy.md), [보안 안내](../SECURITY.md)를 참고하세요. Compose의 데이터베이스 자격 증명은 로컬 개발용 예시이며, 노출되는 두 포트는 루프백 주소에 바인딩됩니다.

## 저장소 구조

```text
apps/
  api/                  Go API, PostgreSQL 모델 및 테스트
  web/                  React/Vite 프런트엔드 및 테스트
doc/                    README 번역
docs/                   개발, 운영 및 라이브러리 선정 문서
scripts/                백업 및 CI 보조 스크립트
.github/workflows/      CI 검사 및 조건부 이미지 릴리스
```

Vite+(`vp`)로 개발, 빌드, 테스트, 포맷 및 lint 명령을 실행합니다. Bun은 루트에서 JavaScript 워크스페이스를 관리하며 Go 의존성은 `apps/api/go.mod`에 유지됩니다. Docker 빌드는 저장소 루트를 컨텍스트로 사용합니다.

## 명령어

```sh
vp install --frozen-lockfile
vp run dev              # Web 개발 서버
make api                # API: 필요한 환경 변수를 먼저 설정
vp check                # 포맷, lint 및 타입 검사
vp run test             # Go/Web 테스트 및 프로덕션 빌드
make build              # Web 자산을 포함한 dist/pr-desk 바이너리
make production         # 애플리케이션 컨테이너 하나와 PostgreSQL
```

[공식 Vite+ 설치 안내](https://viteplus.dev/guide/)에 따라 전역 `vp` CLI를 설치하세요. 도구 버전은 `package.json`과 `.node-version`에 고정되어 있으며 포맷 및 lint 설정은 루트의 `vite.config.ts`에 있습니다. `vp fmt`로 코드를 정리하며 줄 너비는 Oxfmt의 최댓값인 320을 사용합니다.

연결 전에 GitHub App 권한과 `.env`를 설정하세요. 설정, 포트, 데이터베이스 백업 및 백그라운드 동기화는 [개발 및 운영](../docs/development.md)을 참고하세요.

## CI 및 릴리스

PR과 main은 GitHub 호스팅 러너에서 Web 검사, 독립된 PostgreSQL을 사용하는 Go 경쟁 상태 및 통합 테스트, 프런트엔드가 포함된 애플리케이션 Docker 빌드를 실행합니다. main CI가 성공하면 GHCR 애플리케이션 이미지와 GitHub Release를 게시합니다.

트리거, 태그 및 이미지 기반 배포는 [CI/CD](../docs/ci-cd.md), 구현에 사용된 라이브러리는 [라이브러리 선정](../docs/library-audit.md)을 참고하세요.

## 기여하기

로컬 검사와 PR 제출 안내는 [CONTRIBUTING.md](../CONTRIBUTING.md)를 참고하세요. 취약점은 [SECURITY.md](../SECURITY.md)에 설명된 비공개 채널로 신고해 주세요.

[![Contributors](https://contrib.rocks/image?repo=yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/graphs/contributors)

[전체 기여자 보기](https://github.com/yldm-tech/pr-desk/graphs/contributors). 아바타는 contrib.rocks에서 제공하며 저장소가 공개적으로 접근 가능해야 합니다.

## Star 기록

[![Star History Chart](https://api.star-history.com/svg?repos=yldm-tech/pr-desk&type=Date)](https://star-history.com/#yldm-tech/pr-desk&Date)

차트와 공개 저장소 배지는 저장소 공개 후 사용할 수 있습니다. [GitHub에서 Stargazers 보기](https://github.com/yldm-tech/pr-desk/stargazers).

## 라이선스

PR Desk는 [Apache License 2.0](../LICENSE)을 따릅니다.
