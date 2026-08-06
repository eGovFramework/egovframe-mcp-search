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
set -euo pipefail # 오류 즉시 중단 / 미정의 변수 금지 / 파이프 실패 전파 (안전 옵션)
cd "$(dirname "$0")/.." # 스크립트 디렉토리의 상위 디렉토리(레포지토리 루트)로 이동

targets=${PACK_TARGETS:-"darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64"} # 기본 타깃 5종. PACK_TARGETS 환경변수로 덮어쓸 수 있음
name=$(node -p "require('./package.json').name") # package.json 에서 추출한 패키지 이름(파일명 조립용)
ver=$(node -p "require('./package.json').version") # package.json 에서 추출한 패키지 버전(파일명 조립용)
mkdir -p dist # dist 디렉토리 생성(번들 파일 저장용)

for t in $targets; do # 타깃 반복(darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64)
  os=${t%%-*} # 타깃 플랫폼 추출(os 부분 추출). 예: darwin-arm64 -> darwin
  cpu=${t#*-} # 타깃 아키텍처 추출(cpu 부분 추출). 예: darwin-arm64 -> arm64
  flags=(--os="$os" --cpu="$cpu") # 타깃 플랫폼 및 아키텍처 플래그 설정
  [ "$os" = linux ] && flags+=(--libc=glibc) # Linux 플랫폼이면 glibc(gnu) 라이브러리 옵션 추가 (musl 이 아닌 glibc 바이너리 선택)
  echo "==> $t"
  rm -rf node_modules # node_modules 디렉토리 삭제(이전 타깃의 바이너리가 섞이지 않도록 초기화)
  npm_config_platform="$os" npm_config_arch="$cpu" npm ci "${flags[@]}" # 환경변수 + 플래그로 타깃 플랫폼용 바이너리를 설치
  npm pack --pack-destination dist # tgz 번들 파일을 dist 디렉토리에 생성 (이때 prepare = tsc 빌드가 돌고, bundleDependencies 로 node_modules 가 동봉됨)
  mv "dist/$name-$ver.tgz" "dist/$name-$ver-$t.tgz" # 생성된 tgz 파일의 이름을 타깃별 변경: 이름-버전.tgz → 이름-버전-플랫폼.tgz
  # ── tgz 후처리 (폐쇄망 대응) ──
  # 1) [linux 만] glibc 타깃에 불필요한 musl 스포크(@lancedb/lancedb-*-musl, @napi-rs/canvas-*-musl 등) 제거.
  #    npm ci 의 --libc 필터는 lockfile 에 libc 메타데이터가 없어 동작하지 않으므로 musl 도 설치된다.
  #    ⚠️ 반드시 pack "후" tgz 재가공으로 제거한다. pack "전" node_modules 에서 rm 하면
  #    lockfile 과의 불일치 때문에 npm pack 의 번들링이 "디스크 상태 그대로"에서
  #    "각 의존성의 published 파일 목록만"으로 조용히 격하되어, 설치 시 생성된 바이너리
  #    (better-sqlite3 build/Release/*.node, sharp .node·vendor/)가 tgz 에서 통째로 빠진다 (실측).
  # 2) [전 타깃] 번들 의존성의 install 계열 스크립트 무력화.
  #    tgz 설치 시 번들 의존성의 install 스크립트가 재실행되는데(실측), 오프라인에서는
  #    better-sqlite3 의 prebuild-install → node-gyp 폴백이 네트워크 실패로 설치 전체를
  #    깨뜨린다. 바이너리는 이미 번들에 있으므로 스크립트는 불필요.
  #    binding.gyp 이 있는 패키지는 스크립트를 "삭제"하면 npm 이 암묵적으로 node-gyp 을
  #    실행하므로, 삭제가 아니라 no-op 으로 "교체"한다.
  work=$(mktemp -d) # 임시 작업 디렉토리
  tar -xzf "dist/$name-$ver-$t.tgz" -C "$work" # tgz 를 풀어서
  [ "$os" = linux ] && find "$work/package/node_modules" -type d -name '*-musl' -prune -exec rm -rf {} + # musl 스포크 제거
  node -e '
    const fs=require("fs"),path=require("path");
    function walk(d){ if(!fs.existsSync(d)) return;
      for(const e of fs.readdirSync(d,{withFileTypes:true})){ if(!e.isDirectory()) continue;
        const p=path.join(d,e.name);
        if(e.name.startsWith("@")){ walk(p); continue; }          // 스코프 디렉토리는 한 단계 더
        const pj=path.join(p,"package.json");
        if(fs.existsSync(pj)){ try{
          const j=JSON.parse(fs.readFileSync(pj,"utf8")); const s=j.scripts||{};
          const hooks=["preinstall","install","postinstall"].filter(k=>s[k]);
          const gyp=fs.existsSync(path.join(p,"binding.gyp"));
          if(hooks.length||gyp){ for(const k of hooks) delete s[k];
            if(gyp) s.install="node -e \"\"";                     // 암묵적 node-gyp 실행 방지
            j.scripts=s; fs.writeFileSync(pj,JSON.stringify(j,null,2)); }
        }catch{} }
        walk(path.join(p,"node_modules"));                        // 중첩 node_modules 재귀
      } }
    walk(process.argv[1]);
  ' "$work/package/node_modules"
  tar -czf "dist/$name-$ver-$t.tgz" -C "$work" package # 다시 tgz 로 압축
  rm -rf "$work" # 임시 디렉토리 정리
done

npm ci   # 로컬 개발 상태 (현재 플랫폼 바이너리) 복원
echo "완료:"
ls -lh dist/"$name"-"$ver"-*.tgz # 생성된 tgz 파일 목록 출력
