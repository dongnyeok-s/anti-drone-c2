/**
 * WebSocket 보안 미들웨어
 * - 인증 (토큰 기반)
 * - Rate Limiting
 * - CORS 검증
 */

import { IncomingMessage } from 'http';
import { SimulatorConfig } from '../config';

/**
 * Rate Limiter 클래스
 * IP 기반 요청 제한
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // 주기적으로 오래된 기록 정리
    setInterval(() => this.cleanup(), this.windowMs);
  }

  /**
   * Rate limit 체크
   */
  check(clientId: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(clientId) || [];

    // 윈도우 내의 요청만 유지
    const validTimestamps = timestamps.filter(
      (ts) => now - ts < this.windowMs
    );

    if (validTimestamps.length >= this.maxRequests) {
      this.requests.set(clientId, validTimestamps);
      return false; // Rate limit 초과
    }

    // 새 요청 기록
    validTimestamps.push(now);
    this.requests.set(clientId, validTimestamps);
    return true;
  }

  /**
   * 오래된 기록 정리
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [clientId, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(
        (ts) => now - ts < this.windowMs
      );
      if (validTimestamps.length === 0) {
        this.requests.delete(clientId);
      } else {
        this.requests.set(clientId, validTimestamps);
      }
    }
  }

  /**
   * 특정 클라이언트의 기록 삭제
   */
  reset(clientId: string): void {
    this.requests.delete(clientId);
  }
}

/**
 * 메시지 Rate Limiter
 * 클라이언트별 메시지 전송 속도 제한
 */
export class MessageRateLimiter {
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * 메시지 전송 가능 여부 확인
   */
  canSendMessage(clientId: string): boolean {
    let limiter = this.rateLimiters.get(clientId);
    if (!limiter) {
      limiter = new RateLimiter(this.maxRequests, this.windowMs);
      this.rateLimiters.set(clientId, limiter);
    }
    return limiter.check(clientId);
  }

  /**
   * 클라이언트 제거
   */
  removeClient(clientId: string): void {
    this.rateLimiters.delete(clientId);
  }
}

/**
 * 인증 검증
 */
export function validateAuth(
  request: IncomingMessage,
  config: SimulatorConfig
): { valid: boolean; reason?: string } {
  if (!config.authEnabled) {
    return { valid: true };
  }

  if (!config.authToken) {
    console.error('[Security] AUTH_ENABLED=true이지만 AUTH_TOKEN이 설정되지 않음');
    return { valid: false, reason: '서버 설정 오류' };
  }

  // URL 파라미터에서 토큰 추출
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  // Authorization 헤더에서 토큰 추출
  const authHeader = request.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  const providedToken = token || headerToken;

  if (!providedToken) {
    return { valid: false, reason: '인증 토큰이 필요합니다' };
  }

  if (providedToken !== config.authToken) {
    return { valid: false, reason: '잘못된 인증 토큰입니다' };
  }

  return { valid: true };
}

/**
 * CORS 검증
 */
export function validateCORS(
  request: IncomingMessage,
  config: SimulatorConfig
): { valid: boolean; reason?: string } {
  if (!config.corsEnabled) {
    return { valid: true };
  }

  const origin = request.headers.origin;

  // 로컬 연결은 항상 허용
  if (!origin) {
    return { valid: true };
  }

  // 모든 origin 허용
  if (config.corsOrigin === '*') {
    return { valid: true };
  }

  // 특정 origin 검증
  const allowedOrigins = config.corsOrigin.split(',').map((o) => o.trim());
  if (allowedOrigins.includes(origin)) {
    return { valid: true };
  }

  return { valid: false, reason: 'CORS: 허용되지 않은 Origin입니다' };
}

/**
 * 클라이언트 IP 추출
 */
export function getClientId(request: IncomingMessage): string {
  // X-Forwarded-For 헤더 확인 (프록시 뒤에 있는 경우)
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }

  // 직접 연결
  return request.socket.remoteAddress || 'unknown';
}

/**
 * 메시지 검증
 * 기본적인 입력 검증 및 sanitization
 */
export function validateMessage(message: any): {
  valid: boolean;
  reason?: string;
} {
  // null/undefined 체크
  if (!message) {
    return { valid: false, reason: '메시지가 비어있습니다' };
  }

  // type 필드 필수
  if (!message.type || typeof message.type !== 'string') {
    return { valid: false, reason: 'type 필드가 필요합니다' };
  }

  // type 길이 제한 (DoS 방지)
  if (message.type.length > 100) {
    return { valid: false, reason: 'type 필드가 너무 깁니다' };
  }

  // 메시지 크기 제한 (1MB)
  const messageStr = JSON.stringify(message);
  if (messageStr.length > 1024 * 1024) {
    return { valid: false, reason: '메시지 크기가 너무 큽니다 (최대 1MB)' };
  }

  return { valid: true };
}

/**
 * 보안 컨텍스트
 */
export interface SecurityContext {
  rateLimiter: RateLimiter;
  messageRateLimiter: MessageRateLimiter;
}

/**
 * 보안 컨텍스트 생성
 */
export function createSecurityContext(
  config: SimulatorConfig
): SecurityContext {
  return {
    rateLimiter: new RateLimiter(
      config.rateLimitMaxRequests,
      config.rateLimitWindowMs
    ),
    messageRateLimiter: new MessageRateLimiter(
      Math.floor(config.rateLimitMaxRequests / 10), // 메시지는 더 엄격하게
      config.rateLimitWindowMs
    ),
  };
}
