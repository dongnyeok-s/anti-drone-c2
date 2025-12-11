# 소부대 대드론 C2 시뮬레이터 프로젝트 종합 요약

## 1. 프로젝트 개요

소부대 단위의 저비용 Counter-Drone 지휘통제(C2) 시스템 시뮬레이터입니다. 2D 시뮬레이션 전용이며, AirSim/3D 기능은 제거되어 있습니다.

### 핵심 목표
- 다중 센서 융합 기반 드론 탐지 및 분류
- 위협 평가 및 자동 교전 의사결정
- 요격 성공률 최적화 및 성능 평가

## 2. 시스템 아키텍처

### 2.1 기술 스택
- **Frontend**: React 18 + TypeScript, Vite 5.0, TailwindCSS, Framer Motion
- **Simulator**: Node.js + TypeScript, WebSocket (ws), Zod, Jest
- **Analysis**: Python (pandas, matplotlib, seaborn, numpy)

### 2.2 통신 구조
- WebSocket 양방향 통신 (`ws://localhost:8080`)
- JSON 메시지 포맷 (Zod 스키마 검증)
- 실시간 이벤트 스트리밍

### 2.3 데이터 플로우
```
C2 UI (React) ↔ WebSocket ↔ 시뮬레이터 서버 (Node.js)
                              ↓
                        JSONL 로그 파일
                              ↓
                        분석 도구 (Python)
```

## 3. 핵심 기능 모듈

### 3.1 센서 시뮬레이션

#### 레이더 (Pseudo-Radar)
- **파라미터**:
  - 스캔 레이트: 1회/초
  - 최대 탐지 거리: 1000m
  - 거리 노이즈: σ = 10m (가우시안)
  - 방위각 노이즈: σ = 2°
  - 오탐률: 1.5%
  - 미탐률: 7%
- **구현**: Box-Muller 변환 기반 가우시안 노이즈, 거리 기반 신뢰도 계산

#### 음향 센서 (CRNN Stub)
- **기능**: 드론 활동 상태 분류 (NOISE, IDLE, TAKEOFF, HOVER, APPROACH, DEPART, LOITER)
- **파라미터**:
  - 탐지 범위: 500m
  - 기본 탐지 확률: 35%
  - 오탐률: 0.3%
  - 미탐률: 3%
- **특징**: 거리/속도 기반 활동 상태 추정, 지연 모델링

#### EO 카메라 (전자광학 센서)
- **기능**: 드론 분류 (HOSTILE/CIVIL/FRIENDLY/UNKNOWN), 무장 여부, 크기, 타입 식별
- **파라미터**:
  - 최대 탐지 거리: 350m
  - 기본 탐지 확률: 70%
  - 적대적 드론 정확도: 92%
  - 민간 드론 정확도: 85%
- **특징**: 거리 기반 신뢰도, 오분류 확률 모델링

### 3.2 센서 융합 시스템

#### 융합 알고리즘
- **모드**:
  1. **WEIGHTED_AVG**: 가중 평균 기반 위치/속도 융합
  2. **EKF**: Extended Kalman Filter (비선형 관측 모델)
  3. **KALMAN**: 표준 Kalman Filter

#### 융합 프로세스
1. **존재 확률 업데이트**: 베이즈 기반 (P(existence | observation))
2. **위치/속도 융합**: 센서별 신뢰도 가중 평균 또는 EKF
3. **분류 정보 융합**: 다수결 + 신뢰도 가중
4. **트랙 품질 계산**: 센서 다양성, 업데이트 빈도, 신뢰도 기반

#### 트랙 관리
- 트랙 생성: 첫 센서 관측 시 자동 생성
- 트랙 업데이트: 관측치 기반 지속 업데이트
- 트랙 소멸: 타임아웃, 무력화, 낮은 존재 확률 시 삭제

### 3.3 위협 평가 시스템

#### 위협 점수 계산 (0~100점)
- **요소 및 가중치**:
  1. **존재 확률** (최대 35점)
     - > 0.9: +35점
     - 0.7~0.9: +25점
     - 0.5~0.7: +12점
     - < 0.5: +5점
  2. **분류** (최대 +50점 또는 -40점)
     - HOSTILE: +50 × confidence
     - CIVIL: -40 × confidence
     - UNKNOWN: +8점
     - FRIENDLY: -60 × confidence
  3. **거리** (최대 25점)
     - < 80m: +25점
     - < 150m: +18점
     - < 250m: +10점
     - < 400m: +5점
  4. **행동 패턴** (최대 25점)
     - APPROACHING: +25점
     - CIRCLING: +15점
     - HOVERING: +12점
     - DEPARTING: -5점
  5. **무장 여부** (최대 20점)
     - 무장 확인: +20점
     - 불확실 + HOSTILE: +10점
     - 비무장: -5점
  6. **EO 확인 보너스**
     - HOSTILE + EO: +10 × confidence
     - CIVIL + EO: -15 × confidence

#### 위협 레벨 분류
- **CRITICAL**: 75점 이상 (즉각 대응)
- **DANGER**: 50~74점 (대응 준비)
- **CAUTION**: 25~49점 (주시)
- **INFO**: 24점 이하 (정보 수집)

#### 동적 위협 평가 (선택적)
- ETA(Estimated Time to Arrival) 계산
- 위협 점수 변화율 추적
- 궤적 분석 기반 예측

### 3.4 드론 행동 모델

#### 적 드론 행동 모드
1. **NORMAL**: 목표(기지) 방향 직선 비행
2. **RECON**: 지정 좌표 상공 선회 정찰 (반경 100m)
3. **ATTACK_RUN**: 저고도(50m) 고속 급접근
4. **EVADE**: 요격 드론 탐지 시 급선회 + 가속 회피

#### 요격 드론 상태 머신
- IDLE/STANDBY: 대기
- SCRAMBLE: 출격
- LAUNCHING: 발진 중 (2초)
- PURSUING: 표적 추격
- RECON: 정찰 모드 (EO 카메라, 150m 이내)
- INTERCEPT_RAM/GUN/NET/JAM: 교전 중
- RETURNING: 기지 귀환
- NEUTRALIZED: 무력화

#### 요격 방식
- **RAM**: 충돌 요격 (< 5m)
- **GUN**: 사격 요격 (100~400m)
- **NET**: 그물 요격 (< 100m)
- **JAM**: 전자전 재밍 (50~300m, 시간 누적)

### 3.5 유도 시스템

#### Proportional Navigation (PN)
- **상태 벡터**: 위치, 속도, 가속도
- **관측**: LOS(Line of Sight) 각도, 접근 속도
- **명령 가속도**: `a_cmd = N × λ_dot × V_c`
  - N: Navigation constant (기본값 3)
  - λ_dot: LOS 각속도
  - V_c: 접근 속도

#### 유도 모드 비교
- **PURE_PURSUIT**: 기존 직선 추격
- **PN**: 비례 항법 (제안 방식)
- **APN**: Augmented PN (타겟 가속도 보정)
- **OPTIMAL**: 최적 유도 (비교용)

### 3.6 요격 확률 모델

#### 확률 계산 모드
1. **SIMPLE**: 기본 확률 모델
2. **LOGISTIC**: 로지스틱 회귀 기반
3. **MONTE_CARLO**: 몬테카를로 시뮬레이션

#### 확률 요소
- 상대 속도
- 거리 (최적 거리 대비)
- 회피 상태
- 드론 크기
- 요격 방식별 특성

## 4. 평가 및 분석 시스템

### 4.1 자동 로깅 시스템
- **포맷**: JSONL (JSON Lines)
- **이벤트 타입**:
  - `drone_spawned`: 드론 생성
  - `radar_detection`: 레이더 탐지
  - `audio_detection`: 음향 탐지
  - `eo_detection`: EO 탐지
  - `fused_track_update`: 융합 트랙 업데이트
  - `threat_score_update`: 위협 점수 업데이트
  - `engage_command`: 교전 명령
  - `intercept_result`: 요격 결과
  - `manual_action`: 수동 조작

### 4.2 성능 지표
- **분류 성능**:
  - Accuracy, Precision, Recall, F1-Score
  - 클래스별 (HOSTILE/CIVIL/UNKNOWN) 성능
  - False Positive/Negative Rate
- **탐지 성능**:
  - 탐지율 (Detection Rate)
  - 탐지 지연 (Detection Delay)
  - 첫 탐지 시간
- **교전 성능**:
  - 요격 성공률 (Intercept Success Rate)
  - 교전 지연 (Engagement Delay)
  - 무력화율 (Neutralization Rate)

### 4.3 자동 파라미터 튜닝
- **방법**: 랜덤 서치 기반 최적화
- **Objective 함수**:
  ```
  score = F1_hostile_all_hostile 
        + F1_hostile_mixed_civil 
        - 2.0 × civil_fp_rate_mixed_civil 
        + 0.3 × accuracy_all_hostile
  ```
- **튜닝 파라미터**:
  - 레이더 설정 (노이즈, 오탐률, 미탐률)
  - 융합 가중치
  - 위협 평가 가중치
  - 교전 임계값

### 4.4 시나리오 생성기
- **기능**: 랜덤 변수 기반 시나리오 자동 생성
- **시드 기반 재현성** 보장
- **생성 요소**:
  - 드론 수 (최소/최대)
  - 드론 타입 분포
  - 행동 모드 분포
  - 레이블 분포 (HOSTILE/CIVIL)
  - 레이더 설정 변동
- **배치 생성**: 대량 실험용 시나리오 일괄 생성

## 5. 실험 설계

### 5.1 평가 프로파일
- **Fast 프로파일**: 빠른 테스트 (적은 시나리오, 짧은 시간)
- **Full 프로파일**: 논문용 평가 (다양한 시나리오, 충분한 반복)

### 5.2 실험 모드
- **BASELINE**: 레이더만 사용, 거리 기반 교전
- **FUSION**: 센서 융합 기반 교전

### 5.3 시나리오 타입
- **all_hostile**: 모든 드론이 적대적
- **civil_only**: 모든 드론이 민간
- **mixed_civil**: 적대적 + 민간 혼합

## 6. 연구 지표 및 분석

### 6.1 탐지 조기성
- 드론 생성 → 첫 탐지 시간 측정
- 센서별 첫 탐지 시간 비교

### 6.2 분류 성능
- ROC/PR 곡선
- Confusion Matrix
- 클래스별 Precision-Recall 곡선

### 6.3 위협 평가 성능
- 위협 점수 변화 추적
- 위협 레벨 분류 정확도
- False Alarm Rate 분석

### 6.4 요격 성능
- 요격 성공률
- 교전 지연 시간
- 유도 모드별 성능 비교

## 7. 주요 파일 구조

### 핵심 파일
- `simulator/src/simulation.ts`: 시뮬레이션 엔진 메인 로직
- `simulator/src/core/fusion/sensorFusion.ts`: 센서 융합 구현
- `simulator/src/core/fusion/threatScore.ts`: 위협 평가 구현
- `simulator/src/models/hostileDrone.ts`: 적 드론 행동 모델
- `simulator/src/models/interceptor.ts`: 요격 드론 모델
- `simulator/src/sensors/radar.ts`: 레이더 센서 구현
- `simulator/src/sensors/acousticSensor.ts`: 음향 센서 구현
- `simulator/src/core/scenario/generator.ts`: 시나리오 생성기
- `analysis/scripts/eval_classification_report.py`: 분류 성능 평가
- `analysis/auto_tune.py`: 파라미터 자동 튜닝

## 8. 논문 작성 시 강조할 포인트

### 기술적 기여
1. **다중 센서 융합**: 레이더, 음향, EO 통합 융합 알고리즘
2. **위협 평가**: 다변수 기반 위협 점수 계산 시스템
3. **자동 교전**: 위협 기반 자동 교전 의사결정
4. **성능 평가**: 체계적인 평가 파이프라인 및 자동 튜닝

### 실험적 검증
1. Baseline vs Fusion 비교
2. 다양한 시나리오에서의 성능 검증
3. 파라미터 민감도 분석
4. 분류 성능 정량적 평가

### 실용성
1. 소부대 단위 저비용 시스템 설계
2. 실시간 처리 가능한 구조
3. 확장 가능한 아키텍처

## 9. 상세 기술 사양

### 9.1 레이더 센서 상세
- **노이즈 모델**: 가우시안 분포 (Box-Muller 변환)
- **신뢰도 계산**: `confidence = max(0.5, min(0.99, distanceFactor + noise))`
- **오탐 생성**: 균등 분포 기반 랜덤 위치

### 9.2 음향 센서 상세
- **활동 상태 분류 규칙**:
  - TAKEOFF: 고도 < 50m + 상승률 > 2m/s
  - APPROACH: 접근 속도 > 5m/s + 거리 < 350m
  - DEPART: 접근 속도 < -5m/s
  - HOVER: 속도 < 2m/s
- **탐지 확률**: `base_prob + takeoff_boost + approach_boost`

### 9.3 EO 센서 상세
- **분류 정확도**: 거리 기반 감쇠
  - `confidence = max(0.5, min(0.95, 1 - distance/300))`
- **오분류 확률**: 10% (랜덤)
- **정찰 시간**: 3초 (150m 이내 접근 시)

### 9.4 센서 융합 상세 알고리즘

#### 가중 평균 모드
```typescript
// 위치 융합
fused_position = Σ(sensor_position × sensor_weight) / Σ(sensor_weight)

// 가중치 계산
weight = confidence × sensor_reliability × recency_factor
```

#### EKF 모드
- **상태 벡터**: [px, py, pz, vx, vy, vz, ax, ay]
- **관측 모델**:
  - RADAR: [range, bearing, altitude, radialVelocity] (비선형)
  - AUDIO: [bearing] (비선형)
  - EO: [range, bearing, altitude] (비선형)
- **예측 단계**: Constant Velocity 모델
- **업데이트 단계**: Extended Kalman Filter

### 9.5 위협 평가 상세 공식

#### 거리 점수
```typescript
if (distance < 80) score += 25
else if (distance < 150) score += 18
else if (distance < 250) score += 10
else if (distance < 400) score += 5
```

#### 행동 패턴 감지
```typescript
approachAngle = dot(velocity, direction_to_base)
if (approachAngle > 0.7) behavior = 'APPROACHING'
else if (approachAngle < -0.3) behavior = 'DEPARTING'
else if (speed < 2) behavior = 'HOVERING'
else behavior = 'CIRCLING'
```

### 9.6 PN 유도 상세

#### LOS 각도 계산
```typescript
lambda = atan2(target_y - interceptor_y, target_x - interceptor_x)
lambda_dot = d(lambda)/dt
```

#### 명령 가속도
```typescript
closing_speed = dot(relative_velocity, los_direction)
command_accel = N × lambda_dot × closing_speed
```

#### PN 상수 선택
- N = 3: 표준 값
- N > 3: 더 공격적 추격
- N < 3: 더 부드러운 추격

### 9.7 요격 확률 모델 상세

#### SIMPLE 모드
```typescript
prob = base_success_rate
prob -= relative_speed × speed_factor
if (target_is_evading) prob ×= (1 - evade_penalty)
prob ×= distance_factor
```

#### LOGISTIC 모드
```typescript
z = β₀ + β₁×speed + β₂×distance + β₃×evade + ...
prob = 1 / (1 + exp(-z))
```

#### MONTE_CARLO 모드
- 1000회 시뮬레이션 실행
- 성공 횟수 / 전체 시도 = 확률

## 10. 실험 결과 분석 항목

### 10.1 분류 성능 분석
- **Confusion Matrix**: 실제 레이블 vs 예측 레이블
- **ROC 곡선**: HOSTILE 클래스 기준
- **PR 곡선**: Precision-Recall 트레이드오프
- **클래스별 성능**: HOSTILE, CIVIL, UNKNOWN 각각의 Precision/Recall/F1

### 10.2 탐지 성능 분석
- **탐지율**: 탐지된 드론 / 전체 드론
- **평균 탐지 지연**: 드론 생성 → 첫 탐지 시간
- **센서별 기여도**: 레이더/음향/EO 각각의 첫 탐지 비율

### 10.3 교전 성능 분석
- **요격 성공률**: 성공한 요격 / 전체 요격 시도
- **교전 지연**: 위협 CRITICAL → 교전 명령 시간
- **유도 모드 비교**: PN vs Pure Pursuit 성공률

### 10.4 융합 효과 분석
- **Baseline vs Fusion**: 분류 정확도, False Positive Rate 비교
- **융합 모드 비교**: Weighted Avg vs EKF 성능
- **센서 조합 효과**: 레이더만 vs 레이더+음향 vs 레이더+음향+EO

## 11. 논문 구조 제안

### 11.1 Abstract
- 소부대 대드론 C2 시스템의 필요성
- 다중 센서 융합 기반 접근법
- 주요 기여 및 실험 결과 요약

### 11.2 Introduction
- 드론 위협의 증가
- 기존 시스템의 한계
- 제안 시스템의 목표

### 11.3 Related Work
- 드론 탐지 시스템
- 센서 융합 기법
- 위협 평가 시스템

### 11.4 System Architecture
- 전체 시스템 구조
- 센서 모델
- 융합 알고리즘
- 위협 평가 시스템

### 11.5 Methodology
- 센서 시뮬레이션
- 융합 알고리즘 상세
- 위협 평가 알고리즘
- 교전 의사결정

### 11.6 Experimental Setup
- 시나리오 생성
- 평가 지표
- 실험 설정

### 11.7 Results
- 분류 성능
- 탐지 성능
- 교전 성능
- 융합 효과 분석

### 11.8 Discussion
- 결과 해석
- 제한사항
- 향후 연구 방향

### 11.9 Conclusion
- 주요 기여 요약
- 실험 결과 요약
- 향후 계획

## 12. 주요 수치 및 파라미터 요약

### 센서 파라미터
| 센서 | 파라미터 | 값 |
|------|---------|-----|
| 레이더 | 최대 거리 | 1000m |
| 레이더 | 오탐률 | 1.5% |
| 레이더 | 미탐률 | 7% |
| 음향 | 최대 거리 | 500m |
| 음향 | 오탐률 | 0.3% |
| 음향 | 미탐률 | 3% |
| EO | 최대 거리 | 350m |
| EO | HOSTILE 정확도 | 92% |
| EO | CIVIL 정확도 | 85% |

### 위협 평가 가중치
| 요소 | 가중치 | 최대 점수 |
|------|--------|----------|
| 존재 확률 | - | 35점 |
| 분류 | - | ±50점 |
| 거리 | - | 25점 |
| 행동 패턴 | - | 25점 |
| 무장 여부 | - | 20점 |

### 드론 파라미터
| 타입 | 최대 속도 | 순항 속도 | 가속도 |
|------|----------|----------|--------|
| 적 드론 | 25 m/s | 15 m/s | 5 m/s² |
| 요격 드론 | 35 m/s | - | 8 m/s² |

### 요격 방식 파라미터
| 방식 | 최소 거리 | 최대 거리 | 기본 성공률 |
|------|----------|----------|------------|
| RAM | 0m | 5m | 75% |
| GUN | 100m | 400m | 60% |
| NET | 0m | 100m | 80% |
| JAM | 50m | 300m | 70% |

## 13. 코드 참조 위치

### 센서 구현
- 레이더: `simulator/src/sensors/radar.ts`
- 음향: `simulator/src/sensors/acousticSensor.ts`
- EO: `simulator/src/sensors/eoSensor.ts`

### 융합 구현
- 메인 융합: `simulator/src/core/fusion/sensorFusion.ts`
- 칼만 필터: `simulator/src/core/fusion/kalmanFilter.ts`
- 위협 평가: `simulator/src/core/fusion/threatScore.ts`

### 행동 모델
- 적 드론: `simulator/src/models/hostileDrone.ts`
- 요격 드론: `simulator/src/models/interceptor.ts`
- 유도: `simulator/src/models/guidance.ts`

### 평가 도구
- 분류 평가: `analysis/scripts/eval_classification_report.py`
- 파라미터 튜닝: `analysis/auto_tune.py`
- 리포트 생성: `analysis/scripts/generate_report.py`

## 14. 논문 작성 팁

### 데이터 시각화
- ROC/PR 곡선: `analysis/plots/plot_roc_pr_curve.py`
- Confusion Matrix: `analysis/plots/plot_confusion_matrix.py`
- 위협 동적 변화: `analysis/plots/plot_threat_dynamics.py`
- 센서 기여도: `analysis/plots/plot_sensor_contribution.py`

### 실험 재현성
- 시드 기반 시나리오 생성 사용
- 모든 파라미터를 설정 파일에 저장
- 로그 파일에 실험 메타데이터 포함

### 성능 비교
- Baseline (레이더만) vs Fusion (다중 센서)
- Weighted Average vs EKF 융합 모드
- PN vs Pure Pursuit 유도 모드

### 통계적 유의성
- 다중 시나리오 반복 실행 (최소 30회)
- 평균 및 표준편차 보고
- 신뢰구간 계산

---

**작성일**: 2025-12-04  
**프로젝트**: 소부대 대드론 C2 시뮬레이터 (2D-only 버전)  
**용도**: 논문 작성 기초 자료

