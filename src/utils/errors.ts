/**
 * 도구 응답에 실을 오류 문구를 정하는 유틸.
 *
 * 도구 응답에는 스택 트레이스·절대 경로·내부 SQL 이 나가면 안 된다 (CLAUDE.md "에러 처리").
 * 호출자가 읽고 조치할 수 있는 오류는 UserFacingError 로 던지고, 그 밖의 오류는
 * toUserMessage() 가 고정 문구로 바꾼다. 상세 내용은 서버 로그(stderr)에만 남긴다.
 */

/**
 * 메시지를 호출자에게 그대로 보여 줘도 되는 오류.
 *
 * 입력 검증 실패, 지식베이스·임베딩 모델 미설치처럼 호출자가 읽고 조치할 수 있는
 * 상황에만 쓴다. 메시지에는 절대 경로·스택·내부 SQL 을 넣지 않는다.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** 원인을 호출자에게 밝힐 수 없는 오류에 쓰는 고정 문구. */
export const INTERNAL_ERROR_MESSAGE =
  "내부 오류가 발생했습니다. 자세한 내용은 MCP 서버 로그(stderr)를 확인하세요.";

/**
 * 네이티브 애드온을 불러오지 못한 오류인지 판별한다.
 *
 * 배포 tgz 는 node_modules 를 통째로 동봉하므로 better-sqlite3 바이너리가 패키징 시점의
 * Node ABI(Node 22)와 플랫폼에 고정된다. 다른 Node 메이저 버전이나 다른 플랫폼에서 실행하면
 * 첫 DB 접근 시점에 이 오류가 난다.
 */
export function isNativeModuleLoadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ERR_DLOPEN_FAILED" ||
    /NODE_MODULE_VERSION|compiled against a different Node\.js version|Could not locate the bindings file/.test(
      error.message,
    )
  );
}

function nativeModuleMessage(): string {
  return (
    "네이티브 모듈(better-sqlite3)을 불러오지 못했습니다. 배포 패키지는 Node.js 22 와 패키지를 만든 플랫폼에서만 " +
    `동작합니다 (현재 Node ${process.version}, ${process.platform}-${process.arch}). ` +
    "MCP 클라이언트 설정의 command 가 Node 22 실행 파일을 가리키는지 확인하세요."
  );
}

/** 오류를 도구 응답에 실을 문구로 바꾼다. */
export function toUserMessage(error: unknown): string {
  if (error instanceof UserFacingError) {
    return error.message;
  }
  if (isNativeModuleLoadFailure(error)) {
    return nativeModuleMessage();
  }
  return INTERNAL_ERROR_MESSAGE;
}
