# 소부대 대드론 C2 시뮬레이터 v2.1

소부대 단위의 저비용 대드론(Counter-Drone) 지휘통제 시스템 시뮬레이터입니다.

## 🚀 주요 기능

### v2.1 신규 기능
- **자동 JSONL 로깅 시스템**: 모든 이벤트를 자동으로 JSONL 파일로 저장
- **자동 시나리오 생성기**: 랜덤 변수 기반 시나리오 대량 생성 (seed 지원)
- **레이더 UI 개선**: 정확한 중심 기준 회전 + 스캔 잔상 효과
- **Manual Action 로깅**: UI에서 수행한 모든 조작 자동 기록

### 핵심 기능
- **WebSocket 양방향 통신**: 시뮬레이터 서버와 C2 UI 간 실시간 데이터 스트리밍
- **Pseudo-Radar 시뮬레이션**: 노이즈, 오탐률, 미탐률이 모델링된 레이더 센서
- **음향 탐지 모델 (CRNN stub)**: WAV → Mel-Spectrogram → 드론 활동 상태 분류
- **적 드론 행동 모델**: NORMAL/RECON/ATTACK_RUN/EVADE 모드 구현
- **요격 드론 행동 모델**: 추격, 교전, 귀환 로직 및 요격 성공 확률 모델
- **레이더 스타일 맵 뷰**: 요격기 표시, 음향/레이더 이벤트 로그, 회피 상태 배지

## 📁 프로젝트 구조

```
드론지휘통제체계/
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
│   │   ├── core/
│   │   │   ├── logging/   # JSONL 로깅 시스템
│   │   │   │   ├── logger.ts        # 로거 구현
│   │   │   │   └── eventSchemas.ts  # 이벤트 스키마 정의
│   │   │   └── scenario/  # 시나리오 생성기
│   │   │       └── generator.ts     # 자동 시나리오 생성
│   │   ├── models/        # 행동 모델 (적/요격 드론)
│   │   ├── sensors/       # 센서 시뮬레이션 (레이더)
│   │   ├── websocket/     # WebSocket 서버
│   │   └── simulation.ts  # 시뮬레이션 엔진
│   ├── logs/              # JSONL 로그 파일 저장
│   ├── scenarios/generated/ # 생성된 시나리오 저장
│   └── package.json
│
├── audio_model/           # 음향 탐지 모델 (Python stub)
│   ├── model.py           # CRNN 모델 stub
│   ├── websocket_client.py
│   └── requirements.txt
│
├── shared/                # 공통 타입/스키마
│   └── schemas.ts
│
└── README.md
```

## 🛠️ 설치 및 실행

### 1. 시뮬레이터 서버 (Node.js)

```bash
cd simulator
npm install
npm run dev
```

→ `ws://localhost:8080` 에서 WebSocket 서버 실행

### 2. 프론트엔드 (C2 UI)

```bash
cd frontend
npm install
npm run dev
```

→ `http://localhost:3000` 에서 실행

### 3. 음향 모델 (Python, 선택사항)

```bash
cd audio_model
pip install -r requirements.txt
python websocket_client.py
```

---

## 📝 자동 로깅 시스템

### 로그 파일 위치
```
simulator/logs/{scenario_id}_{timestamp}.jsonl
```

### 로그 이벤트 타입

| 이벤트 | 설명 |
|--------|------|
| `scenario_start` | 시나리오 시작 (설정 포함) |
| `scenario_end` | 시나리오 종료 (통계 요약) |
| `drone_spawned` | 드론 생성 |
| `track_update` | 트랙 위치 업데이트 |
| `audio_detection` | 음향 탐지 |
| `radar_detection` | 레이더 탐지 |
| `threat_score_update` | 위협도 변경 |
| `engage_command` | 교전 명령 |
| `interceptor_spawned` | 요격기 발진 |
| `intercept_attempt` | 요격 시도 |
| `intercept_result` | 요격 결과 |
| `evade_start` / `evade_end` | 회피 시작/종료 |
| `manual_action` | UI 사용자 조작 |
| `selected_drone` | 드론 선택 |
| `clicked_engage` / `clicked_ignore` | 교전/무시 클릭 |
| `simulation_control` | 시뮬레이션 제어 |

### JSONL 예시
```json
{"timestamp":0,"event":"scenario_start","scenario_id":1,"scenario_name":"기본 시나리오 1","config":{"drone_count":3,"interceptor_count":2,"radar_config":{"scan_rate":1,"max_range":1000}}}
{"timestamp":2.5,"event":"radar_detection","drone_id":"DRONE-A1","range":450,"bearing":72,"altitude":85,"confidence":0.88,"is_false_alarm":false,"is_first_detection":true}
{"timestamp":5.2,"event":"manual_action","action":"clicked_engage","target_id":"DRONE-A1"}
{"timestamp":5.2,"event":"engage_command","drone_id":"DRONE-A1","method":"interceptor_drone","interceptor_id":"INT-1","issued_by":"user"}
{"timestamp":12.8,"event":"intercept_result","interceptor_id":"INT-1","target_id":"DRONE-A1","result":"success","engagement_duration":7.6}
```

---

## 🎲 자동 시나리오 생성기

### 생성 방법
1. **UI에서 생성**: 연결 후 "생성" 버튼 클릭
2. **프로그래밍 방식**: 
   ```typescript
   const generator = getGenerator();
   const scenario = generator.generate(12345);  // seed 지정
   generator.save(scenario);
   ```

### 생성되는 요소

| 요소 | 범위 |
|------|------|
| 드론 수 | 1~15대 |
| 요격기 수 | 1~5대 |
| 적대적 비율 | 30~100% |
| 행동 분포 | direct_attack / recon_loiter / evasive / random_walk |
| 레이더 노이즈 | σ = 5~20m (거리), 1~5° (방위) |
| 오탐률 | 0.5~3% |
| 미탐률 | 3~15% |

### 시나리오 파일 저장 위치
```
simulator/scenarios/generated/{scenario_id}.json
```

---

## 📊 연구 지표 분석

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

### 3. UI/지휘통제 효율성
```python
# 사용자 조작 패턴 분석
manual_actions = logs[logs.event == 'manual_action']
```

### 4. 요격 성공률
```python
results = logs[logs.event == 'intercept_result']
success_rate = (results.result == 'success').mean()
```

---

## 📡 WebSocket 통신 프로토콜

### 시뮬레이터 → C2 이벤트

```typescript
// 레이더 탐지
{ type: "radar_detection", drone_id: "...", range: 350, bearing: 72, altitude: 90, confidence: 0.84 }

// 음향 탐지
{ type: "audio_detection", drone_id: "...", state: "TAKEOFF", confidence: 0.91 }

// 드론 상태 업데이트
{ type: "drone_state_update", drone_id: "...", position: {...}, behavior: "EVADE", is_evading: true }

// 요격기 업데이트
{ type: "interceptor_update", interceptor_id: "...", state: "PURSUING", target_id: "..." }

// 요격 결과
{ type: "intercept_result", result: "SUCCESS", interceptor_id: "...", target_id: "..." }
```

### C2 → 시뮬레이터 명령

```typescript
// 교전 명령
{ type: "engage_command", drone_id: "...", method: "interceptor_drone" }

// 시뮬레이션 제어
{ type: "simulation_control", action: "start" | "pause" | "reset", scenario_id?: number | string }

// Manual Action (자동 로깅용)
{ type: "manual_action", action: "clicked_engage", target_id: "..." }

// 시나리오 생성 요청
{ type: "generate_scenario", seed?: number, count?: number }
```

---

## ⚙️ 센서 모델 파라미터

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

---

## 🎯 행동 모델

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

### 요격 성공 확률

```
P = base_rate × velocity_factor × evasion_factor × altitude_factor
```

- base_rate: 0.75
- velocity_factor: 상대속도 30m/s 이상 시 0.8
- evasion_factor: 회피 중 (1 - evasion_strength)
- altitude_factor: 고도차 30m 이상 시 0.85

---

## 📊 위협도 평가

| 요소 | 가중치 | 설명 |
|-----|--------|-----|
| 거리 | 30% | 기지까지 거리 (가까울수록 높음) |
| 속도 | 25% | 접근 속도 (빠를수록 높음) |
| 행동 | 15% | 위협적 행동 패턴 |
| 탑재체 | 15% | 무장 가능성 |
| 크기 | 15% | 드론 크기 |

위협 레벨:
- **CRITICAL**: 75점 이상 (🔴 즉각 대응)
- **DANGER**: 50~74점 (🟠 대응 준비)
- **CAUTION**: 25~49점 (🟡 주시)
- **INFO**: 24점 이하 (🔵 정보 수집)

---

## 🔬 연구 목표

1. **소부대 운용 개념**: 분대/소대급 대드론 방어 체계
2. **유무인 복합체계 구조**: 지휘관 + 요격 드론 협업
3. **위협 평가 알고리즘**: 다중 요소 가중 평가 모델
4. **시뮬레이션 비교**: 시나리오별 대응 효과 분석

---

## 📊 2차 성능 향상 평가 파이프라인

### 개요

분류/위협 평가 성능을 정량적으로 측정하기 위한 자동화 파이프라인입니다.
여러 시나리오×모드 조합을 자동으로 반복 실행하고, 성능 지표를 계산하여 리포트를 생성합니다.

### 평가 시나리오

- **all_hostile**: 모든 드론이 HOSTILE (100%)
- **mixed_civil**: HOSTILE 50%, CIVIL 50%
- **civil_only**: 모든 드론이 CIVIL (100%)

### 평가 모드

- **BASELINE**: 센서 융합 비활성화
- **FUSION**: 센서 융합 활성화

### 사용 방법

#### 1. 평가 실험 실행

**방법 1: Python 스크립트 사용 (권장)**

```bash
cd analysis
# Full 프로파일로 모든 모드 실행
python scripts/run_evaluation.py --profile full

# Fast 프로파일로 특정 모드만 실행
python scripts/run_evaluation.py --profile fast --modes baseline fusion_default
```

**방법 2: npm 스크립트 사용**

```bash
cd simulator
npm run eval          # Fast 프로파일 (기본값)
npm run eval:fast     # Fast 프로파일 (명시적)
npm run eval:full     # Full 프로파일
```

이 명령은 다음을 수행합니다:
- 6개 실험 조합 (3 시나리오 × 2 모드) × 20회 반복 = 총 120회 실행
- 각 실행은 120초 동안 시뮬레이션 수행
- 결과는 `simulator/logs/eval_full/{mode}/{experiment_name}/run_{i}.jsonl` 형태로 저장

#### 2. 성능 리포트 생성

```bash
cd analysis
# 기본 리포트 생성 (테이블만)
python scripts/generate_report.py

# 전체 리포트 생성 (플롯 포함)
python scripts/generate_report.py --full

# 플롯 없이 리포트만 생성
python scripts/generate_report.py --no-plots
```

또는 로그 디렉토리를 직접 분석:

```bash
python scripts/eval_classification_report.py --logs-dir ../simulator/logs/eval
```

#### 3. 결과 확인

생성되는 파일:
- `analysis/results/classification_summary.md`: 마크다운 형식의 성능 리포트
- `analysis/results/roc_pr_data/*.json`: ROC/PR Curve 데이터 (JSON)

### 리포트 내용

리포트에는 다음 지표가 포함됩니다:

- **Accuracy**: 전체 정확도
- **Precision (HOSTILE)**: HOSTILE 예측의 정밀도
- **Recall (HOSTILE)**: HOSTILE 탐지율
- **F1-Score (HOSTILE)**: HOSTILE F1 점수
- **FP_rate**: False Positive 비율
- **FN_rate**: False Negative 비율

### 예측 레이블 계산 규칙

시스템이 판단한 레이블(`pred_label`)은 다음 규칙으로 계산됩니다:

- `pred_label = "HOSTILE"` if `threat_score >= 70`
- `pred_label = "CIVIL"` if `classification == "CIVIL" AND class_confidence >= 0.7`
- 나머지는 `pred_label = "UNKNOWN"`

### 설정 변경

평가 실험 설정은 `simulator/src/evaluation/config.ts`에서 수정할 수 있습니다:

- 반복 횟수 (`runs`)
- 시뮬레이션 시간 (`duration`)
- 시나리오별 레이블 분포

---

## 🤖 자동 파라미터 튜닝 (Auto-Tuning)

### 개요

Threat/분류/센서 융합/PN 관련 파라미터를 자동으로 최적화하는 시스템입니다.
랜덤 서치 기반으로 여러 파라미터 조합을 시도하고, 평가 파이프라인을 통해
최적의 파라미터 세트를 찾습니다.

### 평가 프로파일: Fast vs Full

튜닝 속도를 위해 두 가지 프로파일을 제공합니다:

#### Fast 프로파일 (기본값)
- **목적**: 빠른 튜닝 탐색용, 상대적인 좋/나쁨 판단
- **시나리오**: `all_hostile`, `mixed_civil` (2개)
- **Runs**: 실험당 3회
- **소요 시간**: 약 10-20분/trial
- **사용 시기**: 파라미터 탐색 단계

#### Full 프로파일
- **목적**: 최종 보고서/논문용 정확한 성능 측정
- **시나리오**: `all_hostile`, `mixed_civil`, `civil_only` (3개)
- **Runs**: 실험당 20회
- **소요 시간**: 약 1-2시간/trial
- **사용 시기**: 최종 검증 단계

### 사용 방법

#### 1. 검색 공간 조정 (선택사항)

`analysis/auto_tuning_config.py`에서 최적화할 파라미터의 범위를 조정할 수 있습니다:

```python
@dataclass
class ParamSpace:
    threat_engage_threshold: Tuple[float, float] = (55.0, 85.0)
    civil_conf_threshold: Tuple[float, float] = (0.5, 0.9)
    pn_nav_constant: Tuple[float, float] = (2.0, 4.5)
    # ... 기타 파라미터
```

#### 2. 자동 튜닝 실행

**Fast 모드 (권장, 기본값)**:
```bash
cd analysis
python auto_tune.py --trials 30 --profile fast
# 또는 (기본값이 fast이므로)
python auto_tune.py --trials 30
```

**Full 모드 (최종 검증용)**:
```bash
python auto_tune.py --trials 5 --profile full
```

**시드 지정**:
```bash
python auto_tune.py --trials 30 --seed 12345 --profile fast
```

### 권장 워크플로우

1. **Fast 모드로 여러 번 튜닝**
   ```bash
   python auto_tune.py --trials 30 --profile fast
   ```
   - 빠르게 좋은 파라미터 후보 탐색
   - 여러 번 실행하여 다양한 후보 수집

2. **Best config 확인 및 선택**
   ```bash
   cat analysis/results/auto_tune_best_config.json
   ```
   - 여러 번 실행한 결과 중 가장 좋은 파라미터 선택

3. **Best config를 runtime_params로 고정**
   ```bash
   # run_full_pipeline.py가 자동으로 수행하거나
   # 수동으로 복사
   cp analysis/results/auto_tune_best_config.json \
      simulator/config/runtime_params.json
   ```

4. **Full 모드로 최종 성능 측정**
   ```bash
   # 방법 1: auto_tune의 full 모드 사용
   python auto_tune.py --trials 1 --profile full
   
   # 방법 2: 독립적으로 full 평가만 실행
   cd simulator
   npm run eval:full
   ```
   - 논문/보고서용 정확한 수치 확보

#### 3. 결과 확인

튜닝이 완료되면 다음 파일이 생성됩니다:

- `analysis/results/auto_tune_history.json`: 모든 시행의 파라미터와 점수 기록
- `analysis/results/auto_tune_best_config.json`: 최적 파라미터와 성능 지표

### 튜닝 프로세스

1. **파라미터 샘플링**: 검색 공간에서 무작위로 파라미터 세트 선택
2. **파라미터 주입**: `simulator/config/runtime_params.json`에 저장
3. **평가 실행**: `npm run eval` 실행 (여러 시나리오×모드 조합)
4. **성능 분석**: `eval_classification_report.py` 실행하여 metrics 계산
5. **Objective Score 계산**: F1, FP_rate 등을 종합한 점수 계산
6. **Best 업데이트**: 현재까지의 최고 점수보다 좋으면 best_params 갱신
7. **반복**: 지정된 횟수만큼 반복

### Objective 함수

현재 Objective는 다음을 최적화합니다:

- **HOSTILE F1 점수** (all_hostile, mixed_civil 시나리오) - 가중치 1.0
- **CIVIL False Positive 패널티** (mixed_civil) - 가중치 -2.0
- **Accuracy 보너스** (all_hostile) - 가중치 0.3

Objective 함수는 `analysis/auto_tune.py`의 `compute_objective_score()`에서 수정할 수 있습니다.

### 주의사항

- 튜닝은 시간이 오래 걸릴 수 있습니다 (50 trials × 평가 시간)
- 각 trial마다 평가 실험이 실행되므로, 로그 파일이 많이 생성됩니다
- `simulator/config/runtime_params.json`이 있으면 해당 파라미터가 사용되고, 없으면 기본값이 사용됩니다

---

## 📈 데이터 플로우

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   C2 UI         │◄───►│   시뮬레이터       │◄───►│   음향 모델       │
│   (React)       │     │   (Node.js)     │     │   (Python)      │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
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
│   (Python/R)    │
└─────────────────┘
```
