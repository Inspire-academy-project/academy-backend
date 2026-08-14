import { createHash, randomInt } from 'node:crypto';

/**
 * 학생이 손으로 옮겨 적거나 카톡으로 받아 입력하는 값이라
 * 헷갈리는 글자(I·O·0·1)를 뺀다. 0을 O로 잘못 쳐서 가입이 막히면
 * 원장님에게 다시 물어봐야 한다.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** 코드 유효기간. 전달하고 가입할 때까지 넉넉하되 방치되지 않을 정도. */
export const INVITE_TTL_DAYS = 7;

/** A7K2-9QX4 처럼 네 자리씩 끊어 준다. 읽어 주기도 옮겨 적기도 쉽다. */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * 소문자로 치거나 하이픈을 빼먹어도 같은 코드로 본다.
 * 학생이 왜 안 되는지 모른 채 막히는 일을 줄인다.
 */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * 코드는 자격증명이므로 원문을 저장하지 않는다.
 * 조회할 때마다 같은 값이 나와야 하므로 솔트 없는 단방향 해시를 쓴다.
 * 32^8 가지라 대입으로 맞히기 어렵고, 1회용이며 7일 뒤 만료된다.
 */
export function hashInviteCode(input: string): string {
  return createHash('sha256').update(normalizeInviteCode(input)).digest('hex');
}

export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
