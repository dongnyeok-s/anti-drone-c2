# 보안 개선 업데이트 (v2.2)

**날짜**: 2025-12-05
**버전**: v2.2

## 📋 변경 사항 요약

세 가지 주요 보안 및 안정성 개선 사항이 구현되었습니다:

1. ✅ **환경 변수 검증 시스템**
2. ✅ **WebSocket 에러 핸들링 개선**
3. ✅ **기본 보안 기능 (인증, CORS, Rate Limiting)**

---

## 🔐 1. 환경 변수 검증 시스템

### 새로운 기능

- **Zod 스키마 기반 타입 안전 검증**
- 잘못된 환경 변수 설정 시 서버 시작 전 오류 발생
- 자동 디렉토리 생성 (logs, scenarios)
- 개발 모드에서 설정 값 출력

### 구현 파일

- `simulator/src/config/env.ts` (신규)
- `simulator/src/config.ts` (업데이트)

### 검증 항목

| 환경 변수 | 검증 규칙 |
|-----------|-----------|
| SIMULATOR_PORT | 1-65535 범위 |
| SIMULATOR_WS_URL | ws:// 또는 wss:// 시작 |
| NODE_ENV | development/production/test |
| AUTH_TOKEN | AUTH_ENABLED=true일 때 필수 |
| RATE_LIMIT_MAX_REQUESTS | 양수 |
| RATE_LIMIT_WINDOW_MS | 양수 |

### 사용 예시

```typescript
// 자동으로 검증 수행
import { getConfig } from './config';

const config = getConfig();
// 검증 통과한 설정만 반환됨
```

---

## ⚡ 2. WebSocket 에러 핸들링 개선

### 새로운 기능

#### 체계적인 에러 코드 시스템
- 14가지 에러 코드 정의 (4001-4503)
- 표준화된 에러 응답 형식
- 클라이언트 친화적인 에러 메시지

#### 자동 하트비트 (Heartbeat)
- 30초마다 Ping/Pong 자동 전송
- 응답 없는 연결 자동 종료
- 연결 상태 모니터링

#### 에러 로깅 및 통계
- 모든 에러 자동 기록
- 1분마다 에러 통계 출력
- 최근 100개 에러 메모리 저장

### 구현 파일

- `simulator/src/websocket/errorHandler.ts` (신규)
- `simulator/src/websocket/server.ts` (업데이트)

### 에러 코드 예시

```typescript
enum ErrorCode {
  AUTH_REQUIRED = 4001,
  AUTH_INVALID = 4002,
  RATE_LIMIT_EXCEEDED = 4029,
  CORS_VIOLATION = 4030,
  INVALID_MESSAGE = 4400,
  MESSAGE_TOO_LARGE = 4413,
  INTERNAL_ERROR = 4500,
  // ... 기타
}
```

### 에러 응답 형식

```json
{
  "type": "error",
  "code": 4029,
  "message": "요청 제한을 초과했습니다. 잠시 후 다시 시도하세요",
  "timestamp": 1234567890000,
  "details": { }
}
```

---

## 🛡️ 3. 기본 보안 기능

### 3.1 인증 (Authentication)

#### 기능
- 토큰 기반 인증
- URL 파라미터 또는 Authorization 헤더 지원
- 토큰 마스킹 (로그 출력 시)

#### 설정
```env
AUTH_ENABLED=true
AUTH_TOKEN=your-secure-token-here
```

#### 클라이언트 연결
```javascript
// 방법 1: URL 파라미터
const ws = new WebSocket('ws://localhost:8080?token=your-token');

// 방법 2: Authorization 헤더
const ws = new WebSocket('ws://localhost:8080', {
  headers: { 'Authorization': 'Bearer your-token' }
});
```

### 3.2 CORS (Cross-Origin Resource Sharing)

#### 기능
- Origin 기반 접근 제어
- 단일/다중 도메인 지정 가능
- 프로덕션 환경 경고

#### 설정
```env
CORS_ENABLED=true
CORS_ORIGIN=https://yourdomain.com
# 또는 여러 도메인
CORS_ORIGIN=https://domain1.com,https://domain2.com
```

### 3.3 Rate Limiting

#### 기능
- IP 기반 연결 속도 제한
- 클라이언트별 메시지 속도 제한
- 자동 정리 메커니즘
- DoS 공격 방지

#### 설정
```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
```

#### 제한 수준
- **연결 레벨**: IP당 최대 요청 수
- **메시지 레벨**: 연결당 메시지 속도 (연결 제한의 1/10)
- **동시 연결**: 최대 100개 동시 연결

### 구현 파일

- `simulator/src/websocket/security.ts` (신규)

---

## 📦 새로운 의존성

```json
{
  "dependencies": {
    "dotenv": "^16.x",
    "zod": "^3.x"
  }
}
```

설치 방법:
```bash
cd simulator
npm install
```

---

## 📝 환경 변수 업데이트

### .env.example 업데이트

새로운 환경 변수가 추가되었습니다:

```env
# 보안 설정
AUTH_ENABLED=false
AUTH_TOKEN=your-secret-token-here

# CORS 설정
CORS_ENABLED=true
CORS_ORIGIN=*

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
```

### 마이그레이션 가이드

기존 프로젝트 업데이트 시:

1. `.env.example` 파일 확인
2. 새로운 환경 변수 `.env`에 추가
3. 서버 재시작

```bash
# 1. 의존성 설치
npm install

# 2. 빌드
npm run build

# 3. 서버 시작
npm run dev
```

---

## 🔍 테스트 방법

### 1. 환경 변수 검증 테스트

잘못된 포트 번호로 테스트:
```bash
SIMULATOR_PORT=99999 npm run dev
```

예상 결과:
```
[Config] 환경 변수 검증 실패:
  - SIMULATOR_PORT: SIMULATOR_PORT는 1-65535 사이여야 합니다
```

### 2. 인증 테스트

서버 시작:
```bash
AUTH_ENABLED=true AUTH_TOKEN=test123 npm run dev
```

클라이언트 연결:
```javascript
// 성공
const ws = new WebSocket('ws://localhost:8080?token=test123');

// 실패 (401 Unauthorized)
const ws = new WebSocket('ws://localhost:8080?token=wrong');
```

### 3. Rate Limiting 테스트

짧은 시간 내 여러 연결 시도:
```javascript
for (let i = 0; i < 150; i++) {
  new WebSocket('ws://localhost:8080');
}
```

예상 결과: 100개 이후 연결 거부 (429 Too Many Requests)

---

## 📊 서버 시작 로그 예시

```
[Config] .env 파일 로드됨: /path/to/.env
[Config] 환경 변수 검증 성공
========================================
  환경 설정
========================================
환경: development
포트: 8080
WebSocket URL: ws://localhost:8080
로그 디렉토리: ./logs
로그 활성화: true
콘솔 로그 출력: false
시나리오 디렉토리: ./scenarios/generated
----------------------------------------
인증 활성화: false
CORS 활성화: true
CORS Origin: *
Rate Limiting: true
  - 최대 요청: 100/60000ms
========================================
[Simulator] WebSocket 서버 시작: ws://localhost:8080
[Simulator] CORS 활성화: *
[Simulator] Rate Limiting: 100/60000ms
[Simulator] 기본 시나리오 로드 완료
[Simulator] 서버 준비 완료
```

---

## 🚀 프로덕션 배포 가이드

상세한 프로덕션 배포 가이드는 `SECURITY.md` 참조

### 필수 체크리스트

- [ ] `AUTH_ENABLED=true` 설정
- [ ] 강력한 `AUTH_TOKEN` 생성
- [ ] `CORS_ORIGIN`에 실제 도메인 지정 (no `*`)
- [ ] `NODE_ENV=production` 설정
- [ ] WSS (암호화된 WebSocket) 사용
- [ ] SSL/TLS 인증서 설정

---

## 📚 문서

- **보안 가이드**: `SECURITY.md`
- **메인 README**: `README.md` (보안 섹션 추가 예정)
- **이 변경로그**: `CHANGELOG_SECURITY.md`

---

## 🔧 주요 코드 변경

### 파일 생성

- `simulator/src/config/env.ts` - 환경 변수 검증
- `simulator/src/websocket/security.ts` - 보안 미들웨어
- `simulator/src/websocket/errorHandler.ts` - 에러 핸들링
- `SECURITY.md` - 보안 문서
- `CHANGELOG_SECURITY.md` - 이 파일

### 파일 수정

- `simulator/src/config.ts` - 보안 설정 추가
- `simulator/src/websocket/server.ts` - 보안 통합
- `.env.example` - 보안 환경 변수 추가
- `simulator/package.json` - 의존성 추가

---

## 🎯 다음 단계

향후 개선 가능 항목:

1. **JWT 기반 인증**: 토큰 만료 및 갱신 지원
2. **IP 화이트리스트**: 특정 IP만 허용
3. **TLS/SSL**: wss:// 지원 (현재는 리버스 프록시 권장)
4. **감사 로그**: 보안 이벤트 별도 로깅
5. **브루트포스 방지**: 실패 시도 횟수 제한

---

## ✅ 호환성

- **Node.js**: 14.x 이상
- **TypeScript**: 5.x
- **기존 클라이언트**: 완전 호환 (보안 비활성화 시)
- **기존 시나리오**: 영향 없음

---

**구현자**: Claude Code
**검토 필요**: 프로덕션 배포 전 보안 감사 권장
