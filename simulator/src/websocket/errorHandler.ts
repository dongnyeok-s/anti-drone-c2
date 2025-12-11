/**
 * WebSocket 에러 핸들링
 * 체계적인 에러 처리 및 로깅
 */

import WebSocket from 'ws';

/**
 * 에러 코드 정의
 */
export enum ErrorCode {
  // 인증 관련
  AUTH_REQUIRED = 4001,
  AUTH_INVALID = 4002,
  AUTH_EXPIRED = 4003,

  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 4029,

  // CORS
  CORS_VIOLATION = 4030,

  // 메시지 관련
  INVALID_MESSAGE = 4400,
  MESSAGE_TOO_LARGE = 4413,
  INVALID_COMMAND = 4404,

  // 서버 에러
  INTERNAL_ERROR = 4500,
  SERVICE_UNAVAILABLE = 4503,

  // 연결 관련
  CONNECTION_TIMEOUT = 4408,
  TOO_MANY_CONNECTIONS = 4429,
}

/**
 * 에러 메시지 정의
 */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.AUTH_REQUIRED]: '인증이 필요합니다',
  [ErrorCode.AUTH_INVALID]: '잘못된 인증 정보입니다',
  [ErrorCode.AUTH_EXPIRED]: '인증이 만료되었습니다',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: '요청 제한을 초과했습니다. 잠시 후 다시 시도하세요',
  [ErrorCode.CORS_VIOLATION]: 'CORS 정책 위반',
  [ErrorCode.INVALID_MESSAGE]: '잘못된 메시지 형식입니다',
  [ErrorCode.MESSAGE_TOO_LARGE]: '메시지 크기가 너무 큽니다',
  [ErrorCode.INVALID_COMMAND]: '알 수 없는 명령입니다',
  [ErrorCode.INTERNAL_ERROR]: '내부 서버 오류',
  [ErrorCode.SERVICE_UNAVAILABLE]: '서비스를 사용할 수 없습니다',
  [ErrorCode.CONNECTION_TIMEOUT]: '연결 시간 초과',
  [ErrorCode.TOO_MANY_CONNECTIONS]: '동시 연결 수 제한 초과',
};

/**
 * 에러 응답 인터페이스
 */
interface ErrorResponse {
  type: 'error';
  code: ErrorCode;
  message: string;
  timestamp: number;
  details?: any;
}

/**
 * 에러 응답 생성
 */
export function createErrorResponse(
  code: ErrorCode,
  details?: any
): ErrorResponse {
  return {
    type: 'error',
    code,
    message: ERROR_MESSAGES[code] || '알 수 없는 오류',
    timestamp: Date.now(),
    details,
  };
}

/**
 * WebSocket으로 에러 전송
 */
export function sendError(
  ws: WebSocket,
  code: ErrorCode,
  details?: any
): void {
  if (ws.readyState === WebSocket.OPEN) {
    const errorResponse = createErrorResponse(code, details);
    ws.send(JSON.stringify(errorResponse));
  }
}

/**
 * WebSocket 연결 종료 (에러와 함께)
 */
export function closeWithError(
  ws: WebSocket,
  code: ErrorCode,
  details?: any
): void {
  sendError(ws, code, details);

  // 에러 코드와 메시지로 연결 종료
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, ERROR_MESSAGES[code]);
    }
  }, 100); // 에러 메시지 전송 시간 확보
}

/**
 * 에러 로거
 */
export class ErrorLogger {
  private static instance: ErrorLogger;
  private errorCounts: Map<ErrorCode, number> = new Map();
  private lastErrors: Array<{
    code: ErrorCode;
    timestamp: number;
    clientId: string;
    details?: any;
  }> = [];

  private constructor() {
    // 주기적으로 에러 통계 출력
    setInterval(() => this.printStats(), 60000); // 1분마다
  }

  static getInstance(): ErrorLogger {
    if (!ErrorLogger.instance) {
      ErrorLogger.instance = new ErrorLogger();
    }
    return ErrorLogger.instance;
  }

  /**
   * 에러 기록
   */
  log(code: ErrorCode, clientId: string, details?: any): void {
    // 카운트 증가
    const count = this.errorCounts.get(code) || 0;
    this.errorCounts.set(code, count + 1);

    // 최근 에러 기록 (최대 100개)
    this.lastErrors.push({
      code,
      timestamp: Date.now(),
      clientId,
      details,
    });

    if (this.lastErrors.length > 100) {
      this.lastErrors.shift();
    }

    // 콘솔 로그
    console.error(
      `[WS Error] ${ERROR_MESSAGES[code]} (Code: ${code}, Client: ${clientId})`,
      details || ''
    );
  }

  /**
   * 에러 통계 출력
   */
  private printStats(): void {
    if (this.errorCounts.size === 0) return;

    console.log('========================================');
    console.log('  WebSocket 에러 통계 (지난 1분)');
    console.log('========================================');

    for (const [code, count] of this.errorCounts.entries()) {
      console.log(`  ${ERROR_MESSAGES[code]}: ${count}회`);
    }

    console.log('========================================');

    // 통계 초기화
    this.errorCounts.clear();
  }

  /**
   * 최근 에러 조회
   */
  getRecentErrors(limit: number = 10): typeof this.lastErrors {
    return this.lastErrors.slice(-limit);
  }
}

/**
 * 에러 핸들링 헬퍼
 */
export function handleWebSocketError(
  error: Error,
  ws: WebSocket,
  clientId: string
): void {
  const logger = ErrorLogger.getInstance();

  // 에러 타입에 따른 처리
  if (error.message.includes('parse')) {
    sendError(ws, ErrorCode.INVALID_MESSAGE);
    logger.log(ErrorCode.INVALID_MESSAGE, clientId, error.message);
  } else if (error.message.includes('timeout')) {
    closeWithError(ws, ErrorCode.CONNECTION_TIMEOUT);
    logger.log(ErrorCode.CONNECTION_TIMEOUT, clientId, error.message);
  } else {
    sendError(ws, ErrorCode.INTERNAL_ERROR);
    logger.log(ErrorCode.INTERNAL_ERROR, clientId, error.message);
  }

  // 스택 트레이스 출력 (개발 모드)
  if (process.env.NODE_ENV === 'development') {
    console.error('[WS Error Stack]', error.stack);
  }
}

/**
 * 연결 타임아웃 헬퍼
 */
export function setupConnectionTimeout(
  ws: WebSocket,
  clientId: string,
  timeoutMs: number = 30000
): NodeJS.Timeout {
  return setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) {
      console.warn(`[WS] 연결 타임아웃: ${clientId}`);
      closeWithError(ws, ErrorCode.CONNECTION_TIMEOUT);
      ErrorLogger.getInstance().log(ErrorCode.CONNECTION_TIMEOUT, clientId);
    }
  }, timeoutMs);
}

/**
 * Ping/Pong 하트비트 설정
 */
export function setupHeartbeat(
  ws: WebSocket,
  clientId: string,
  intervalMs: number = 30000
): { interval: NodeJS.Timeout; cleanup: () => void } {
  let isAlive = true;

  ws.on('pong', () => {
    isAlive = true;
  });

  const interval = setInterval(() => {
    if (!isAlive) {
      console.warn(`[WS] 하트비트 실패, 연결 종료: ${clientId}`);
      ws.terminate();
      return;
    }

    isAlive = false;
    ws.ping();
  }, intervalMs);

  const cleanup = () => {
    clearInterval(interval);
  };

  return { interval, cleanup };
}
