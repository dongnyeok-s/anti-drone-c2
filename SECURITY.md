# 보안 가이드

대드론 C2 시뮬레이터의 보안 기능 및 설정 가이드입니다.

## 📋 목차

- [환경 변수 검증](#환경-변수-검증)
- [인증 (Authentication)](#인증-authentication)
- [CORS 설정](#cors-설정)
- [Rate Limiting](#rate-limiting)
- [에러 핸들링](#에러-핸들링)
- [프로덕션 배포 체크리스트](#프로덕션-배포-체크리스트)

---

## 환경 변수 검증

### 개요

Zod 스키마 기반으로 환경 변수를 검증하여 런타임 오류를 방지합니다.

### 설정 방법

1. `.env.example`을 복사하여 `.env` 파일 생성:
   ```bash
   cp .env.example .env
   ```

2. 필요한 환경 변수 설정:
   ```env
   # 서버 설정
   SIMULATOR_PORT=8080
   SIMULATOR_WS_URL=ws://localhost:8080

   # 보안 설정
   AUTH_ENABLED=true
   AUTH_TOKEN=your-secure-token-here

   CORS_ENABLED=true
   CORS_ORIGIN=https://yourdomain.com

   RATE_LIMIT_ENABLED=true
   RATE_LIMIT_MAX_REQUESTS=100
   RATE_LIMIT_WINDOW_MS=60000
   ```

### 검증 규칙

- **SIMULATOR_PORT**: 1-65535 사이의 유효한 포트 번호
- **SIMULATOR_WS_URL**: `ws://` 또는 `wss://`로 시작
- **NODE_ENV**: `development`, `production`, `test` 중 하나
- **AUTH_TOKEN**: `AUTH_ENABLED=true`일 때 필수

### 검증 실패 시

서버 시작 시 환경 변수 검증에 실패하면 다음과 같은 오류 메시지와 함께 종료됩니다:

```
[Config] 환경 변수 검증 실패:
  - SIMULATOR_PORT: SIMULATOR_PORT는 1-65535 사이여야 합니다
  - AUTH_TOKEN: AUTH_ENABLED가 true일 때 AUTH_TOKEN은 필수입니다
```

---

## 인증 (Authentication)

### 개요

토큰 기반 인증으로 무단 접근을 방지합니다.

### 활성화 방법

`.env` 파일에서 설정:

```env
AUTH_ENABLED=true
AUTH_TOKEN=your-very-secure-random-token-12345
```

### 클라이언트 연결 방법

#### 방법 1: URL 파라미터

```javascript
const ws = new WebSocket('ws://localhost:8080?token=your-very-secure-random-token-12345');
```

#### 방법 2: Authorization 헤더

```javascript
const ws = new WebSocket('ws://localhost:8080', {
  headers: {
    'Authorization': 'Bearer your-very-secure-random-token-12345'
  }
});
```

### 인증 실패 시

잘못된 토큰으로 연결 시도 시:
- HTTP 401 Unauthorized 응답
- 연결 즉시 종료
- 에러 로그 기록

```json
{
  "type": "error",
  "code": 4002,
  "message": "잘못된 인증 토큰입니다",
  "timestamp": 1234567890000
}
```

### 보안 권장사항

1. **강력한 토큰 사용**: 최소 32자 이상의 무작위 문자열
   ```bash
   # 토큰 생성 예시 (Linux/Mac)
   openssl rand -base64 32
   ```

2. **토큰 주기적 갱신**: 정기적으로 토큰 변경

3. **환경 변수 보호**: `.env` 파일을 Git에 커밋하지 않음 (`.gitignore`에 추가됨)

---

## CORS 설정

### 개요

Cross-Origin Resource Sharing 정책으로 허용된 도메인만 접근 가능하도록 제한합니다.

### 설정 방법

`.env` 파일에서 설정:

```env
CORS_ENABLED=true
CORS_ORIGIN=https://yourdomain.com
```

### 여러 도메인 허용

쉼표로 구분하여 여러 도메인 지정:

```env
CORS_ORIGIN=https://yourdomain.com,https://staging.yourdomain.com,http://localhost:3000
```

### 모든 도메인 허용 (개발 환경)

```env
CORS_ORIGIN=*
```

⚠️ **경고**: 프로덕션 환경에서는 `*` 사용을 피하세요!

### CORS 위반 시

허용되지 않은 도메인에서 연결 시도 시:
- HTTP 403 Forbidden 응답
- 연결 즉시 종료

---

## Rate Limiting

### 개요

DoS 공격 및 과도한 요청을 방지하기 위한 속도 제한 기능입니다.

### 설정 방법

`.env` 파일에서 설정:

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100    # 최대 요청 수
RATE_LIMIT_WINDOW_MS=60000     # 시간 윈도우 (밀리초)
```

### 제한 수준

1. **연결 레벨**: IP당 연결 시도 횟수 제한
2. **메시지 레벨**: 클라이언트당 메시지 전송 속도 제한 (연결 제한의 1/10)

### Rate Limit 초과 시

제한을 초과하면:
- 새 연결 거부 (HTTP 429)
- 메시지 전송 차단
- 에러 응답 전송

```json
{
  "type": "error",
  "code": 4029,
  "message": "요청 제한을 초과했습니다. 잠시 후 다시 시도하세요",
  "timestamp": 1234567890000
}
```

### 권장 설정값

| 환경 | MAX_REQUESTS | WINDOW_MS | 설명 |
|------|--------------|-----------|------|
| 개발 | 1000 | 60000 | 느슨한 제한 |
| 스테이징 | 200 | 60000 | 중간 제한 |
| 프로덕션 | 100 | 60000 | 엄격한 제한 |

---

## 에러 핸들링

### 에러 코드 체계

| 코드 | 이름 | 설명 |
|------|------|------|
| 4001 | AUTH_REQUIRED | 인증 필요 |
| 4002 | AUTH_INVALID | 잘못된 인증 정보 |
| 4003 | AUTH_EXPIRED | 인증 만료 |
| 4029 | RATE_LIMIT_EXCEEDED | Rate Limit 초과 |
| 4030 | CORS_VIOLATION | CORS 정책 위반 |
| 4400 | INVALID_MESSAGE | 잘못된 메시지 형식 |
| 4413 | MESSAGE_TOO_LARGE | 메시지 크기 초과 (최대 1MB) |
| 4404 | INVALID_COMMAND | 알 수 없는 명령 |
| 4408 | CONNECTION_TIMEOUT | 연결 시간 초과 |
| 4429 | TOO_MANY_CONNECTIONS | 동시 연결 수 초과 |
| 4500 | INTERNAL_ERROR | 내부 서버 오류 |
| 4503 | SERVICE_UNAVAILABLE | 서비스 사용 불가 |

### 에러 응답 형식

```typescript
{
  type: 'error',
  code: 4029,  // 에러 코드
  message: '요청 제한을 초과했습니다. 잠시 후 다시 시도하세요',
  timestamp: 1234567890000,
  details?: {  // 선택적 상세 정보
    // 추가 컨텍스트
  }
}
```

### 클라이언트 에러 처리 예시

```javascript
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'error') {
    switch (data.code) {
      case 4001:
      case 4002:
        // 인증 실패 - 토큰 갱신 필요
        console.error('인증 오류:', data.message);
        // 재인증 로직
        break;

      case 4029:
        // Rate Limit - 재시도 대기
        console.warn('요청 제한 초과, 1분 후 재시도');
        setTimeout(() => reconnect(), 60000);
        break;

      case 4500:
        // 서버 오류 - 관리자에게 보고
        console.error('서버 오류:', data.message);
        reportError(data);
        break;

      default:
        console.error('알 수 없는 오류:', data);
    }
  }
});
```

### 하트비트 (Heartbeat)

연결 상태 모니터링을 위한 자동 Ping/Pong:

- **간격**: 30초마다
- **타임아웃**: 응답 없으면 연결 종료
- **자동 처리**: 클라이언트 측 별도 구현 불필요

---

## 프로덕션 배포 체크리스트

### 필수 사항

- [ ] **인증 활성화**
  ```env
  AUTH_ENABLED=true
  AUTH_TOKEN=<강력한-랜덤-토큰>
  ```

- [ ] **CORS 제한**
  ```env
  CORS_ORIGIN=https://your-production-domain.com
  ```
  ⚠️ `CORS_ORIGIN=*` 사용 금지!

- [ ] **Rate Limiting 활성화**
  ```env
  RATE_LIMIT_ENABLED=true
  RATE_LIMIT_MAX_REQUESTS=100
  ```

- [ ] **프로덕션 모드 설정**
  ```env
  NODE_ENV=production
  ```

- [ ] **WSS (암호화) 사용**
  - `ws://` 대신 `wss://` 사용
  - SSL/TLS 인증서 설정
  - 리버스 프록시 (Nginx, Apache) 활용 권장

### 권장 사항

- [ ] **로그 레벨 조정**
  ```env
  LOG_CONSOLE_OUTPUT=false  # 성능 향상
  LOG_ENABLED=true          # 파일 로깅은 유지
  ```

- [ ] **리버스 프록시 설정**
  - Nginx 또는 Apache 사용
  - SSL/TLS 종료
  - 추가 보안 헤더 설정

- [ ] **방화벽 규칙**
  - 필요한 포트만 개방
  - IP 화이트리스트 고려

- [ ] **모니터링 설정**
  - 에러 로그 모니터링
  - Rate Limit 초과 알림
  - 리소스 사용량 모니터링

### Nginx 설정 예시

```nginx
upstream websocket_backend {
    server localhost:8080;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /ws {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 타임아웃 설정
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

## 보안 감사 로그

### 에러 통계 확인

서버는 1분마다 에러 통계를 자동으로 출력합니다:

```
========================================
  WebSocket 에러 통계 (지난 1분)
========================================
  요청 제한을 초과했습니다: 12회
  잘못된 인증 토큰입니다: 3회
========================================
```

### 최근 에러 조회 (코드)

```typescript
import { ErrorLogger } from './websocket/errorHandler';

const logger = ErrorLogger.getInstance();
const recentErrors = logger.getRecentErrors(10);

console.log('최근 10개 에러:', recentErrors);
```

---

## 문의 및 보고

보안 취약점 발견 시:
- GitHub Issues에 **private security advisory**로 보고
- 또는 프로젝트 관리자에게 직접 연락

---

**마지막 업데이트**: 2025-12-05
