# CLAUDE.md

이 파일은 Claude Code가 이 프로젝트를 이해하고 작업하는 데 필요한 컨텍스트를 제공합니다.

## 프로젝트 개요

**소부대 대드론 C2 시뮬레이터 (2D-only 버전)**

소부대 단위의 저비용 Counter-Drone 지휘통제 시스템 시뮬레이터입니다.
2D 시뮬레이션 전용 버전으로, AirSim/3D 기능은 제거되어 있습니다.

## 기술 스택

### Frontend (`/frontend`)
- React 18 + TypeScript
- Vite 5.0 (빌드 도구)
- TailwindCSS (스타일링)
- Framer Motion (애니메이션)
- WebSocket 클라이언트

### Simulator (`/simulator`)
- Node.js + TypeScript
- WebSocket 서버 (ws 라이브러리)
- Zod (스키마 검증)
- Jest (테스트)

### Analysis (`/analysis`)
- Python (pandas, matplotlib, seaborn, numpy)

## 디렉토리 구조

```
드론지휘통제체계-2D-only/
├── frontend/              # C2 UI (React)
│   └── src/
│       ├── components/    # UI 컴포넌트
│       ├── hooks/         # React 훅 (useWebSocket)
│       ├── logic/         # 클라이언트 시뮬레이션 로직
│       ├── types/         # TypeScript 타입
│       └── utils/         # 유틸리티
├── simulator/             # 시뮬레이터 서버
│   └── src/
│       ├── adapters/      # 센서/드론 제어 어댑터
│       ├── core/          # 핵심 기능 (fusion, engagement, logging, scenario)
│       ├── models/        # 드론 행동 모델
│       ├── sensors/       # 센서 시뮬레이션 (radar, acoustic, eo)
│       ├── websocket/     # WebSocket 서버
│       ├── batch/         # 배치 실험
│       └── evaluation/    # 성능 평가
├── shared/                # 공유 타입/스키마
└── analysis/              # Python 분석 도구
```

## 빌드 및 실행 명령어

### 시뮬레이터 서버
```bash
cd simulator
npm install
npm run dev          # 개발 서버 실행 (ws://localhost:8080)
npm run build        # TypeScript 컴파일
npm run test         # Jest 테스트 실행
npm run batch        # 배치 실험 실행
npm run eval:fast    # 빠른 성능 평가
npm run eval:full    # 전체 성능 평가 (논문용)
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # 개발 서버 실행 (http://localhost:3000)
npm run build        # 프로덕션 빌드
npm run preview      # 빌드 결과 미리보기
```

### 분석 도구
```bash
cd analysis
pip install -r requirements.txt
python scripts/generate_report.py --full
python auto_tune.py --trials 30 --profile fast
```

## 핵심 개념

### 센서 시뮬레이션
- **Pseudo-Radar**: 노이즈, 오탐률(7%), 미탐률(1.5%) 모델링
- **음향 센서**: CRNN 기반 드론 활동 상태 분류
- **EO 카메라**: 전자광학 센서

### 드론 행동 모델
- **적 드론**: NORMAL, RECON, ATTACK_RUN, EVADE 모드
- **요격 드론**: STANDBY, LAUNCHING, PURSUING, ENGAGING, RETURNING 상태

### 위협 평가
거리(30%), 속도(25%), 행동(15%), 탑재체(15%), 크기(15%) 기반 평가
- CRITICAL: 75점 이상
- DANGER: 50~74점
- CAUTION: 25~49점
- INFO: 24점 이하

## 환경 설정

`simulator/.env.example` 파일 참조:
- `SIMULATOR_PORT`: WebSocket 서버 포트 (기본: 8080)
- `LOG_ENABLED`: JSONL 로깅 활성화
- `SIM_MODE`: INTERNAL (2D-only 지원)

## 코딩 컨벤션

### TypeScript
- 엄격 모드(strict) 사용
- 타입 정의는 `types/` 또는 `types.ts` 파일에 모아서 관리
- 공유 타입은 `shared/schemas.ts`에 정의

### 테스트
- Jest 사용 (`simulator/__tests__/`)
- 단위 테스트 파일명: `*.test.ts`

### 로깅
- JSONL 포맷으로 `simulator/logs/`에 저장
- 이벤트 타입: drone_spawned, radar_detection, threat_score_update, intercept_result 등

## 주요 파일

- `simulator/src/simulation.ts`: 시뮬레이션 엔진 메인 로직
- `simulator/src/config.ts`: 시뮬레이터 설정
- `frontend/src/App.tsx`: 프론트엔드 진입점
- `frontend/src/hooks/useWebSocket.ts`: WebSocket 연결 관리
- `shared/schemas.ts`: 공유 Zod 스키마

## WebSocket 통신

- 서버: `ws://localhost:8080`
- 프론트엔드 프록시: `/ws` → `ws://localhost:8000` (vite.config.ts)
- 메시지 포맷: JSON (Zod 스키마로 검증)
