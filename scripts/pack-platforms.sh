#!/usr/bin/env bash
# 플랫폼별 번들 tgz 생성 — bundleDependencies 로 node_modules 를 tgz 에 포함한다.
#
# 크로스 설치 원리: --os/--cpu/--libc 는 플랫폼별 optionalDependencies 선택을 제어하고,
# npm_config_platform/npm_config_arch 는 prebuild-install·sharp 류의 바이너리
# 다운로드 스크립트가 읽는다.
#
# devDependencies 는 prune 하지 않는다 — npm pack 의 번들은 dependencies 그래프만
# 따라가므로 devDeps 는 tgz 에 포함되지 않으며, pack 시점에 prepare(빌드)가
# 실행되므로 tsc 등 devDeps 가 오히려 필요하다.
#
# 주의: better-sqlite3 번들 바이너리는 pack 시점 Node 의 ABI 로 고정된다 (Node 22 = ABI 127).
# 다른 Node 메이저 타깃이 필요하면 npm_config_target=<node버전> 을 함께 지정할 것.
#
# 사용법: scripts/pack-platforms.sh                           # 기본 타깃 전체
#         PACK_TARGETS="linux-x64" scripts/pack-platforms.sh  # 타깃 지정
set -euo pipefail
cd "$(dirname "$0")/.."

targets=${PACK_TARGETS:-"darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64"}
name=$(node -p "require('./package.json').name")
ver=$(node -p "require('./package.json').version")
mkdir -p dist

for t in $targets; do
  os=${t%%-*}
  cpu=${t#*-}
  flags=(--os="$os" --cpu="$cpu")
  [ "$os" = linux ] && flags+=(--libc=glibc)
  echo "==> $t"
  rm -rf node_modules
  npm_config_platform="$os" npm_config_arch="$cpu" npm ci "${flags[@]}"
  if [ "$os" = linux ]; then
    # npm ci 는 lockfile 기반 설치라 --libc 필터가 동작하지 않는다 (lockfile 에
    # libc 메타데이터가 없음) → glibc 타깃에 불필요한 musl 변형을 제거해 크기 절감.
    rm -rf node_modules/@lancedb/lancedb-*-musl
  fi
  npm pack --pack-destination dist
  mv "dist/$name-$ver.tgz" "dist/$name-$ver-$t.tgz"
done

npm ci   # 로컬 개발 상태 (현재 플랫폼 바이너리) 복원
echo "완료:"
ls -lh dist/"$name"-"$ver"-*.tgz
