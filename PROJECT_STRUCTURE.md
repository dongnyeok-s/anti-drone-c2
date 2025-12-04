# 프로젝트 구조 가이드

## 📁 전체 구조

```
드론지휘통제체계/
├── simulator/          # 시뮬레이터 서버 (TypeScript)
│   ├── src/
│   │   ├── index.ts                    # 진입점
│   │   ├── simulation.ts               # 시뮬레이션 엔진
│   │   ├── websocket/server.ts         # WebSocket 서버
│   │   ├── core/                       # 핵심 로직
│   │   │   ├── fusion/                 # 센서 융합
│   │   │   ├── engagement/             # 교전 관리
│   │   │   ├── scenario/               # 시나리오 생성
│   │   │   └── logging/                # 로깅 시스템
│   │   ├── models/                     # 드론/요격기 모델
│   │   ├── sensors/                    # 센서 구현
│   │   ├── evaluation/                 # 평가 설정
│   │   └── scripts/                    # 실행 스크립트
│   └── config/
│       └── runtime_params.json         # 런타임 파라미터
│
├── frontend/           # C2 UI (React + TypeScript)
│   └── src/
│       ├── components/                 # UI 컴포넌트
│       ├── hooks/                      # React Hooks
│       └── logic/                      # 프론트엔드 로직
│
├── analysis/           # 분석 및 평가 (Python)
│   ├── scripts/                        # 분석 스크립트
│   │   ├── eval_classification_report.py
│   │   ├── run_full_evaluation.py
│   │   └── ...
│   ├── plots/                          # 시각화 스크립트
│   ├── results/                        # 결과 파일
│   └── create_reports.py               # 리포트 생성
│
├── shared/             # 공유 타입 정의 (TypeScript)
│   └── schemas.ts
│
├── audio_model/        # 오디오 모델 (Python)
└── backend/           # 백엔드 (현재 비어있음)
```

## 🔄 주요 워크플로우

### 1. 시뮬레이션 실행
```
simulator/src/index.ts
  → SimulatorWebSocketServer
    → SimulationEngine
      → 시나리오 생성 → 센서 융합 → 위협 평가 → 교전
```

### 2. 평가 파이프라인
```
analysis/scripts/run_full_evaluation.py
  → simulator/src/scripts/run_evaluation_experiments.ts
    → 시뮬레이션 실행 (N회 반복)
      → JSONL 로그 생성
        → analysis/scripts/eval_classification_report.py
          → metrics.json 생성
            → analysis/create_reports.py
              → 리포트 생성
```

### 3. 자동 튜닝
```
analysis/auto_tune.py
  → 파라미터 샘플링
    → runtime_params.json 생성
      → 평가 실행
        → objective score 계산
          → best_config 저장
```

## 📝 주요 설정 파일

1. **시뮬레이터 설정**
   - `simulator/src/config.ts` - 기본 설정
   - `simulator/config/runtime_params.json` - 런타임 파라미터 (튜닝 결과)

2. **평가 설정**
   - `simulator/src/evaluation/config.ts` - 평가 실험 설정

3. **분석 설정**
   - `analysis/auto_tuning_config.py` - 튜닝 파라미터 범위

## 🎯 주요 진입점

### 시뮬레이터
```bash
cd simulator
npm run dev          # 개발 모드
npm run eval         # 평가 실행
npm run eval:full    # Full 평가
```

### 분석
```bash
cd analysis
python scripts/run_full_evaluation.py    # Full 평가
python create_reports.py                  # 리포트 생성
python auto_tune.py --trials 20           # 자동 튜닝
```

## ⚠️ 복잡도 이슈

### 현재 문제점
1. **스크립트 분산**: 평가 관련 스크립트가 여러 곳에 분산
   - `simulator/src/scripts/`
   - `analysis/scripts/`
   - `analysis/plots/`

2. **설정 파일 중복**: 여러 곳에 설정이 분산
   - `simulator/src/config.ts`
   - `simulator/src/evaluation/config.ts`
   - `simulator/config/runtime_params.json`
   - `analysis/auto_tuning_config.py`

3. **로그 경로 복잡**: 로그가 여러 디렉토리에 저장
   - `simulator/logs/`
   - `simulator/logs/eval/`
   - `simulator/logs/eval_full/`
   - `simulator/logs/eval_comparison/`

### 개선 제안
1. **스크립트 통합**: 평가 관련 스크립트를 `analysis/scripts/`로 통합
2. **설정 중앙화**: 모든 설정을 `config/` 디렉토리로 통합
3. **로그 구조 단순화**: 단일 로그 디렉토리 구조로 정리

## 📚 사용 가이드

### 기본 시뮬레이션 실행
```bash
cd simulator
npm run dev
```

### 평가 실행
```bash
# Fast 모드
cd simulator
npm run eval:fast

# Full 모드
npm run eval:full
```

### 리포트 생성
```bash
cd analysis
python create_reports.py
```

### 자동 튜닝
```bash
cd analysis
python auto_tune.py --trials 20 --profile fast
```

