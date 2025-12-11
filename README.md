# 소부대 대드론 C2 시뮬레이터 (2D-only 버전)

소부대 단위의 저비용 대드론(Counter-Drone) 지휘통제 시스템 시뮬레이터입니다.

> **Note**: 이 버전은 2D 시뮬레이션 전용입니다. AirSim/3D 시뮬레이션 기능이 제거되어 있습니다.

## 주요 기능

### 핵심 기능
- **WebSocket 양방향 통신**: 시뮬레이터 서버와 C2 UI 간 실시간 데이터 스트리밍
- **Pseudo-Radar 시뮬레이션**: 노이즈, 오탐률, 미탐률이 모델링된 레이더 센서
- **음향 탐지 모델 (CRNN stub)**: WAV → Mel-Spectrogram → 드론 활동 상태 분류
- **적 드론 행동 모델**: NORMAL/RECON/ATTACK_RUN/EVADE 모드 구현
- **요격 드론 행동 모델**: 추격, 교전, 귀환 로직 및 요격 성공 확률 모델
- **다중 센서 융합**: 레이더, 음향, EO 카메라 데이터 융합
- **위협 평가 시스템**: 다중 요소 기반 위협도 평가

### 분석 기능
- **자동 JSONL 로깅 시스템**: 모든 이벤트를 자동으로 JSONL 파일로 저장
- **자동 시나리오 생성기**: 랜덤 변수 기반 시나리오 대량 생성 (seed 지원)
- **분류 성능 평가**: Accuracy, Precision, Recall, F1-Score 자동 계산
- **파라미터 자동 튜닝**: 랜덤 서치 기반 최적화

## 프로젝트 구조

```
드론지휘통제체계-2D-only/
├── frontend/              # C2 UI (React + TypeScript)
│   ├── src/
│   │   ├── components/    # UI 컴포넌트
│   │   ├── hooks/         # React 훅 (WebSocket 등)
│   │   ├── logic/         # 로컬 시뮬레이션 로직
│   │   ├── types/         # TypeScript 타입 정의
│   │   └── utils/         # 유틸리티 함수
│   └── package.json
│
├── simulator/             # 시뮬레이터 서버 (Node.js + TypeScript)
│   ├── src/
│   │   ├── adapters/      # 센서/드론 제어 어댑터 (2D Internal만 지원)
│   │   ├── config/        # 설정 관리
│   │   ├── core/
│   │   │   ├── logging/   # JSONL 로깅 시스템
│   │   │   ├── fusion/    # 센서 융합
│   │   │   ├── engagement/# 교전 관리
│   │   │   └── scenario/  # 시나리오 생성기
│   │   ├── models/        # 행동 모델 (적/요격 드론)
│   │   ├── sensors/       # 센서 시뮬레이션 (레이더, 음향, EO)
│   │   ├── websocket/     # WebSocket 서버
│   │   └── simulation.ts  # 시뮬레이션 엔진
│   ├── logs/              # JSONL 로그 파일 저장
│   ├── scenarios/         # 시나리오 파일
│   └── package.json
│
├── shared/                # 공통 타입/스키마
│   └── schemas.ts
│
├── analysis/              # 성능 분석 도구 (Python)
│   ├── auto_tune.py       # 파라미터 자동 튜닝
│   ├── scripts/           # 분석 스크립트
│   └── lib/               # 분석 라이브러리
│
└── README.md
```

## 설치 및 실행

### 1. 시뮬레이터 서버 (Node.js)

```bash
cd simulator
npm install
npm run dev
```

> `ws://localhost:8080` 에서 WebSocket 서버 실행

### 2. 프론트엔드 (C2 UI)

```bash
cd frontend
npm install
npm run dev
```

> `http://localhost:3000` 에서 실행

### 3. 환경 변수 설정 (선택사항)

```bash
cd simulator
cp .env.example .env
# 필요시 .env 파일 수정
```

## 평가 파이프라인

### 분류 성능 평가 실행

```bash
cd simulator

# Fast 프로파일 (빠른 테스트)
npm run eval:fast

# Full 프로파일 (논문용)
npm run eval:full
```

### 성능 리포트 생성

```bash
cd analysis
python scripts/generate_report.py --full
```

### 자동 파라미터 튜닝

```bash
cd analysis

# Fast 모드로 튜닝
python auto_tune.py --trials 30 --profile fast

# 결과 확인
cat results/auto_tune_best_config.json
```

## 센서 모델 파라미터

### 레이더

| 파라미터 | 기본값 | 설명 |
|---------|--------|-----|
| scan_rate | 1 | 초당 스캔 횟수 |
| max_range | 1000m | 최대 탐지 거리 |
| radial_noise_sigma | 10m | 거리 측정 노이즈 |
| azimuth_noise_sigma | 2° | 방위각 노이즈 |
| false_alarm_rate | 1.5% | 오탐률 |
| miss_probability | 7% | 미탐률 |

### 음향 센서 (CRNN)

| 파라미터 | 값 | 설명 |
|---------|-----|-----|
| sample_rate | 22050Hz | 오디오 샘플링 레이트 |
| n_mels | 128 | Mel 필터뱅크 수 |
| window | 3초 | 분석 윈도우 |
| classes | 6 | NOISE/IDLE/TAKEOFF/HOVER/APPROACH/DEPART |

## 행동 모델

### 적 드론 행동 모드

- **NORMAL**: 목표(기지) 방향 직선 비행
- **RECON**: 지정 좌표 상공 선회 정찰
- **ATTACK_RUN**: 저고도 고속 급접근
- **EVADE**: 요격 드론 탐지 시 급선회 + 가속 회피

### 요격 드론 상태

- **STANDBY**: 대기
- **LAUNCHING**: 발진 중 (2초)
- **PURSUING**: 표적 추격 (선도각 적용)
- **ENGAGING**: 교전 거리 내 요격 판정
- **RETURNING**: 기지 귀환

## 위협도 평가

| 요소 | 가중치 | 설명 |
|-----|--------|-----|
| 거리 | 30% | 기지까지 거리 (가까울수록 높음) |
| 속도 | 25% | 접근 속도 (빠를수록 높음) |
| 행동 | 15% | 위협적 행동 패턴 |
| 탑재체 | 15% | 무장 가능성 |
| 크기 | 15% | 드론 크기 |

위협 레벨:
- **CRITICAL**: 75점 이상 (즉각 대응)
- **DANGER**: 50~74점 (대응 준비)
- **CAUTION**: 25~49점 (주시)
- **INFO**: 24점 이하 (정보 수집)

## 연구 지표 분석

로그 데이터로 다음 연구 지표를 산출할 수 있습니다:

### 1. 탐지 조기성 비교
```python
# 드론 생성 → 첫 탐지 시간 계산
spawned = logs[logs.event == 'drone_spawned']
first_detect = logs[(logs.event == 'radar_detection') & (logs.is_first_detection == True)]
detection_delay = first_detect.timestamp - spawned.timestamp
```

### 2. 위협 평가 성능
```python
# 위협 점수 변화 추적
threat_changes = logs[logs.event == 'threat_score_update']
```

### 3. 요격 성공률
```python
results = logs[logs.event == 'intercept_result']
success_rate = (results.result == 'success').mean()
```

## 데이터 플로우

```
┌─────────────────┐     ┌─────────────────┐
│   C2 UI         │◄───►│   시뮬레이터       │
│   (React)       │     │   (Node.js)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │ manual_action         │ 모든 이벤트
         │ engagement_state      │
         ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    JSONL 로그 파일                                │
│                    simulator/logs/*.jsonl                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   분석 도구      │
│   (Python)      │
└─────────────────┘
```

## 버전 정보

- **2D-only 버전**: AirSim/3D 기능 제거, 2D 시뮬레이션 전용
- 원본 프로젝트에서 분리: 2025-12
