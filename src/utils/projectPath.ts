/**
 * Project Path Utilities
 * MCP 서버에서 사용할 프로젝트 경로 유틸리티
 */

import path from 'path';
import fs from 'fs';

/**
 * 프로젝트 루트 디렉토리 찾기
 * package.json이 있는 디렉토리를 프로젝트 루트로 간주
 */
export function findProjectRoot(startPath?: string): string {
  let currentDir = startPath || process.cwd();
  
  // startPath가 파일인 경우 디렉토리로 변환
  if (startPath && fs.existsSync(startPath) && fs.statSync(startPath).isFile()) {
    currentDir = path.dirname(startPath);
  }
  
  console.error(`🔍 프로젝트 루트 찾기 시작: ${currentDir}`);
  console.error(`🔍 process.cwd(): ${process.cwd()}`);
  
  // 최대 10단계까지 상위 디렉토리 탐색
  for (let i = 0; i < 10; i++) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      console.error(`✅ 프로젝트 루트 발견: ${currentDir}`);
      return currentDir;
    }
    
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // 루트 디렉토리에 도달
      break;
    }
    currentDir = parentDir;
  }
  
  // package.json을 찾지 못한 경우 시작 경로 반환
  console.error(`⚠️ package.json을 찾지 못함. 기본 경로 사용: ${startPath || process.cwd()}`);
  return startPath || process.cwd();
}

/**
 * 프로젝트 루트 기준 knowledge-base 디렉토리 경로
 */
export function getKnowledgeBasePath(startPath?: string): string {
  const projectRoot = findProjectRoot(startPath);
  return path.join(projectRoot, 'knowledge-base');
}

/**
 * 프로젝트 루트 기준 SQLite DB 파일 경로
 */
export function getSQLiteDBPath(startPath?: string): string {
  const knowledgeBasePath = getKnowledgeBasePath(startPath);
  return path.join(knowledgeBasePath, 'egovframe.db');
}

/**
 * 프로젝트 루트 기준 로컬 임베딩 모델 디렉토리 경로
 * (폐쇄망 대응 — 모델은 tgz 에 동봉되며 런타임 다운로드를 하지 않는다)
 */
export function getModelsPath(startPath?: string): string {
  const projectRoot = findProjectRoot(startPath);
  return path.join(projectRoot, 'models');
}

