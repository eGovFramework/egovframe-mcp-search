/**
 * 개발자 지식 본문 발췌
 *
 * Q&A / FAQ 행의 본문은 "질문:\n<질문>\n\n답변:\n<답변>" 형식이다
 * (kb/snapshot 의 snapshotRowToKnowledgeInput). 앞에서부터 자르기만 하면 긴 질문에 밀려
 * 답변이 한 글자도 남지 않는다 — 200자 미리보기로는 Q&A 행의 60% 가 그랬다.
 * 그래서 질문과 답변에 길이를 나눠 배정해 답변의 앞부분이 반드시 들어가게 한다.
 */

import { sliceHead } from './text.js';

const QUESTION_LABEL = '질문:';
const ANSWER_LABEL = '답변:';
const ELLIPSIS = '...';

/** 질문과 답변이 모두 길 때 질문에 배정하는 몫 (나머지는 답변) */
const QUESTION_SHARE = 0.4;

/** 발췌에 들어가는 표지와 줄바꿈의 길이: "질문:\n" + "\n\n답변:\n" */
const FRAME_LENGTH = QUESTION_LABEL.length + 1 + 2 + ANSWER_LABEL.length + 1;

/**
 * text 를 최대 maxLength 글자로 줄인다. 잘랐으면 끝에 생략 표시를 붙인다 (표시까지 maxLength 이내).
 */
function cut(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= ELLIPSIS.length) {
    return sliceHead(text, maxLength);
  }
  return sliceHead(text, maxLength - ELLIPSIS.length).trimEnd() + ELLIPSIS;
}

/** Q&A 형식의 본문을 질문과 답변으로 나눈다. 그 형식이 아니면 null. */
function splitQuestionAnswer(content: string): { question: string; answer: string } | null {
  if (!content.startsWith(QUESTION_LABEL)) {
    return null;
  }
  const separator = content.indexOf(`\n\n${ANSWER_LABEL}`);
  if (separator < 0) {
    return null;
  }
  return {
    question: content.slice(QUESTION_LABEL.length, separator).trim(),
    answer: content.slice(separator + 2 + ANSWER_LABEL.length).trim(),
  };
}

/**
 * 본문을 최대 maxLength 글자의 발췌로 줄인다.
 *
 * - maxLength 는 표지("질문:", "답변:")와 생략 표시("...")를 포함한 전체 길이의 상한이다.
 * - maxLength 이하인 본문은 그대로 돌려준다.
 * - Q&A 본문은 질문에 40%, 답변에 나머지를 배정한다. 한쪽이 제 몫보다 짧으면 남는 길이를
 *   다른 쪽에 준다. 답변이 있으면 그 앞부분이 반드시 들어간다.
 * - 그 밖의 본문(PDF 청크 등)과, 표지를 넣을 수 없을 만큼 작은 maxLength 는 앞에서부터 자른다.
 * - maxLength 가 1 이상의 유한한 수가 아니면 본문을 그대로 돌려준다.
 */
export function excerptKnowledgeContent(content: string, maxLength: number): string {
  const limit = Math.floor(maxLength);
  if (!Number.isFinite(limit) || limit < 1 || content.length <= limit) {
    return content;
  }

  const parts = splitQuestionAnswer(content);
  const budget = limit - FRAME_LENGTH;
  if (!parts || budget < 2) {
    return cut(content, limit);
  }

  const { question, answer } = parts;
  const questionShare = Math.floor(budget * QUESTION_SHARE);
  const questionLength = Math.min(question.length, Math.max(questionShare, budget - answer.length));
  const answerLength = Math.min(answer.length, budget - questionLength);

  return `${QUESTION_LABEL}\n${cut(question, questionLength)}\n\n${ANSWER_LABEL}\n${cut(answer, answerLength)}`;
}
