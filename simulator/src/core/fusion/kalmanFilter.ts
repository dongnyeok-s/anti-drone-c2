/**
 * 칼만 필터 구현 모듈
 *
 * 센서 융합을 위한 Extended Kalman Filter (EKF) 구현
 *
 * 상태 벡터 (8차원):
 *   x = [px, py, pz, vx, vy, vz, ax, ay]^T
 *
 * 관측 모델:
 *   - RADAR: [range, bearing, altitude, radialVelocity] (비선형)
 *   - AUDIO: [bearing] (비선형)
 *   - EO: [range, bearing, altitude] (비선형)
 *
 * 알고리즘 비교:
 *   - Weighted Average: 기존 Baseline
 *   - Standard KF: 선형 상태 모델
 *   - EKF: 비선형 관측 모델 (제안 방식)
 *   - Particle Filter: 다봉분포 처리 (선택적 비교)
 */

import { SensorType, TrackPosition, TrackVelocity } from './types';

// ============================================
// 행렬 연산 유틸리티
// ============================================

/**
 * 행렬 덧셈: A + B
 */
function matrixAdd(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0].length;
  const result: number[][] = [];
  for (let i = 0; i < rows; i++) {
    result[i] = [];
    for (let j = 0; j < cols; j++) {
      result[i][j] = A[i][j] + B[i][j];
    }
  }
  return result;
}

/**
 * 행렬 뺄셈: A - B
 */
function matrixSubtract(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0].length;
  const result: number[][] = [];
  for (let i = 0; i < rows; i++) {
    result[i] = [];
    for (let j = 0; j < cols; j++) {
      result[i][j] = A[i][j] - B[i][j];
    }
  }
  return result;
}

/**
 * 행렬 곱셈: A * B
 */
function matrixMultiply(A: number[][], B: number[][]): number[][] {
  const rowsA = A.length;
  const colsA = A[0].length;
  const colsB = B[0].length;
  const result: number[][] = [];
  for (let i = 0; i < rowsA; i++) {
    result[i] = [];
    for (let j = 0; j < colsB; j++) {
      let sum = 0;
      for (let k = 0; k < colsA; k++) {
        sum += A[i][k] * B[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

/**
 * 행렬 전치: A^T
 */
function matrixTranspose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0].length;
  const result: number[][] = [];
  for (let j = 0; j < cols; j++) {
    result[j] = [];
    for (let i = 0; i < rows; i++) {
      result[j][i] = A[i][j];
    }
  }
  return result;
}

/**
 * 행렬 스칼라 곱: c * A
 */
function matrixScalarMultiply(c: number, A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0].length;
  const result: number[][] = [];
  for (let i = 0; i < rows; i++) {
    result[i] = [];
    for (let j = 0; j < cols; j++) {
      result[i][j] = c * A[i][j];
    }
  }
  return result;
}

/**
 * 단위 행렬 생성: I_n
 */
function identityMatrix(n: number): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    result[i] = [];
    for (let j = 0; j < n; j++) {
      result[i][j] = i === j ? 1 : 0;
    }
  }
  return result;
}

/**
 * 영 행렬 생성
 */
function zeroMatrix(rows: number, cols: number): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < rows; i++) {
    result[i] = new Array(cols).fill(0);
  }
  return result;
}

/**
 * 대각 행렬 생성
 */
function diagonalMatrix(diag: number[]): number[][] {
  const n = diag.length;
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    result[i] = [];
    for (let j = 0; j < n; j++) {
      result[i][j] = i === j ? diag[i] : 0;
    }
  }
  return result;
}

/**
 * 행렬 역행렬 (가우스-조던 소거법)
 * 작은 행렬(4x4 이하)에 대해 안정적
 */
function matrixInverse(A: number[][]): number[][] {
  const n = A.length;

  // 증강 행렬 [A | I] 생성
  const augmented: number[][] = [];
  for (let i = 0; i < n; i++) {
    augmented[i] = [...A[i]];
    for (let j = 0; j < n; j++) {
      augmented[i].push(i === j ? 1 : 0);
    }
  }

  // 가우스-조던 소거
  for (let col = 0; col < n; col++) {
    // 피벗 찾기 (부분 피벗팅)
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) {
        maxRow = row;
      }
    }

    // 행 교환
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

    // 피벗이 0에 가까우면 정규화 적용
    const pivot = augmented[col][col];
    if (Math.abs(pivot) < 1e-10) {
      // 특이 행렬 - 정규화된 역행렬 반환
      console.warn('KalmanFilter: Near-singular matrix, applying regularization');
      return matrixInverse(matrixAdd(A, matrixScalarMultiply(1e-6, identityMatrix(n))));
    }

    // 피벗 행을 피벗으로 나눔
    for (let j = 0; j < 2 * n; j++) {
      augmented[col][j] /= pivot;
    }

    // 다른 행에서 피벗 열 소거
    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = augmented[row][col];
        for (let j = 0; j < 2 * n; j++) {
          augmented[row][j] -= factor * augmented[col][j];
        }
      }
    }
  }

  // 역행렬 추출
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    result[i] = augmented[i].slice(n);
  }
  return result;
}

/**
 * 벡터를 열벡터(행렬)로 변환
 */
function vectorToColumnMatrix(v: number[]): number[][] {
  return v.map(val => [val]);
}

/**
 * 열벡터(행렬)를 벡터로 변환
 */
function columnMatrixToVector(m: number[][]): number[] {
  return m.map(row => row[0]);
}

// ============================================
// 칼만 필터 타입 정의
// ============================================

/**
 * 칼만 필터 상태
 */
export interface KalmanState {
  /** 상태 벡터 [px, py, pz, vx, vy, vz, ax, ay] */
  x: number[];
  /** 공분산 행렬 [8x8] */
  P: number[][];
  /** 마지막 업데이트 시간 */
  lastUpdateTime: number;
  /** 연속 예측 횟수 (관측 없이) */
  predictionCount: number;
}

/**
 * 프로세스 노이즈 설정
 */
export interface ProcessNoiseConfig {
  /** 위치 노이즈 표준편차 (m) */
  positionNoise: number;
  /** 속도 노이즈 표준편차 (m/s) */
  velocityNoise: number;
  /** 가속도 노이즈 표준편차 (m/s^2) */
  accelerationNoise: number;
}

/**
 * 관측 노이즈 설정
 */
export interface MeasurementNoiseConfig {
  /** 레이더 노이즈 [range, bearing, altitude, radialVel] */
  radar: {
    range: number;      // m
    bearing: number;    // rad
    altitude: number;   // m
    radialVel: number;  // m/s
  };
  /** 음향 노이즈 [bearing] */
  audio: {
    bearing: number;    // rad
  };
  /** EO 노이즈 [range, bearing, altitude] */
  eo: {
    range: number;      // m
    bearing: number;    // rad
    altitude: number;   // m
  };
}

/**
 * 칼만 필터 설정
 */
export interface KalmanConfig {
  /** 프로세스 노이즈 */
  processNoise: ProcessNoiseConfig;
  /** 관측 노이즈 */
  measurementNoise: MeasurementNoiseConfig;
  /** 초기 공분산 대각 요소 */
  initialCovariance: number[];
  /** 최대 예측 횟수 (관측 없이) */
  maxPredictionCount: number;
}

/**
 * 센서 관측치 (칼만 필터용)
 */
export interface KalmanObservation {
  /** 센서 타입 */
  sensor: SensorType;
  /** 관측 시간 */
  time: number;
  /** 거리 (m) - RADAR, EO */
  range?: number;
  /** 방위각 (rad) - 모든 센서 */
  bearing?: number;
  /** 고도 (m) - RADAR, EO */
  altitude?: number;
  /** 접근 속도 (m/s) - RADAR */
  radialVelocity?: number;
  /** 신뢰도 (0~1) */
  confidence: number;
}

// ============================================
// 기본 설정값
// ============================================

export const DEFAULT_PROCESS_NOISE: ProcessNoiseConfig = {
  positionNoise: 1.0,      // 1m
  velocityNoise: 0.5,      // 0.5 m/s
  accelerationNoise: 2.0,  // 2 m/s^2 (기동 고려)
};

export const DEFAULT_MEASUREMENT_NOISE: MeasurementNoiseConfig = {
  radar: {
    range: 15,                    // 15m
    bearing: 2 * Math.PI / 180,   // 2도
    altitude: 10,                 // 10m
    radialVel: 2,                 // 2 m/s
  },
  audio: {
    bearing: 6 * Math.PI / 180,   // 6도
  },
  eo: {
    range: 4,                     // 4m
    bearing: 2.5 * Math.PI / 180, // 2.5도
    altitude: 5,                  // 5m
  },
};

// 초기 공분산: [px, py, pz, vx, vy, vz, ax, ay]
export const DEFAULT_INITIAL_COVARIANCE = [
  100,   // px: 10m 불확실성
  100,   // py: 10m 불확실성
  100,   // pz: 10m 불확실성
  25,    // vx: 5 m/s 불확실성
  25,    // vy: 5 m/s 불확실성
  25,    // vz: 5 m/s 불확실성
  4,     // ax: 2 m/s^2 불확실성
  4,     // ay: 2 m/s^2 불확실성
];

export const DEFAULT_KALMAN_CONFIG: KalmanConfig = {
  processNoise: DEFAULT_PROCESS_NOISE,
  measurementNoise: DEFAULT_MEASUREMENT_NOISE,
  initialCovariance: DEFAULT_INITIAL_COVARIANCE,
  maxPredictionCount: 20,  // 2초 (100ms 틱 기준)
};

// ============================================
// 칼만 필터 클래스
// ============================================

export class ExtendedKalmanFilter {
  private config: KalmanConfig;
  private basePosition: TrackPosition;

  constructor(basePosition: TrackPosition, config: Partial<KalmanConfig> = {}) {
    this.basePosition = basePosition;
    this.config = {
      ...DEFAULT_KALMAN_CONFIG,
      ...config,
      processNoise: { ...DEFAULT_PROCESS_NOISE, ...config.processNoise },
      measurementNoise: {
        ...DEFAULT_MEASUREMENT_NOISE,
        ...config.measurementNoise,
        radar: { ...DEFAULT_MEASUREMENT_NOISE.radar, ...config.measurementNoise?.radar },
        audio: { ...DEFAULT_MEASUREMENT_NOISE.audio, ...config.measurementNoise?.audio },
        eo: { ...DEFAULT_MEASUREMENT_NOISE.eo, ...config.measurementNoise?.eo },
      },
    };
  }

  // ============================================
  // 초기화
  // ============================================

  /**
   * 초기 칼만 상태 생성
   */
  createInitialState(
    position: TrackPosition,
    velocity: TrackVelocity = { vx: 0, vy: 0, climbRate: 0 },
    time: number = 0
  ): KalmanState {
    // 상태 벡터: [px, py, pz, vx, vy, vz, ax, ay]
    const x = [
      position.x,
      position.y,
      position.altitude,
      velocity.vx,
      velocity.vy,
      velocity.climbRate,
      0,  // ax
      0,  // ay
    ];

    // 초기 공분산 행렬
    const P = diagonalMatrix(this.config.initialCovariance);

    return {
      x,
      P,
      lastUpdateTime: time,
      predictionCount: 0,
    };
  }

  /**
   * 관측치로부터 초기 상태 생성
   */
  createInitialStateFromObservation(
    obs: KalmanObservation,
    time: number
  ): KalmanState {
    // 극좌표 → 직교좌표 변환
    const position = this.polarToCartesian(obs);
    return this.createInitialState(position, { vx: 0, vy: 0, climbRate: 0 }, time);
  }

  // ============================================
  // 예측 단계 (Predict)
  // ============================================

  /**
   * 상태 예측 (시간 경과)
   *
   * 상태 전이 모델: x(k+1) = F * x(k) + w(k)
   * - Constant Velocity with Acceleration 모델
   */
  predict(state: KalmanState, dt: number): KalmanState {
    if (dt <= 0) return state;

    const { x, P } = state;

    // 상태 전이 행렬 F (8x8)
    const F = this.getStateTransitionMatrix(dt);

    // 프로세스 노이즈 행렬 Q
    const Q = this.getProcessNoiseMatrix(dt);

    // 상태 예측: x_pred = F * x
    const x_pred = this.applyStateTransition(x, F);

    // 공분산 예측: P_pred = F * P * F^T + Q
    const FP = matrixMultiply(F, P);
    const FPFt = matrixMultiply(FP, matrixTranspose(F));
    const P_pred = matrixAdd(FPFt, Q);

    return {
      x: x_pred,
      P: P_pred,
      lastUpdateTime: state.lastUpdateTime + dt,
      predictionCount: state.predictionCount + 1,
    };
  }

  /**
   * 상태 전이 행렬 생성
   *
   * 상태: [px, py, pz, vx, vy, vz, ax, ay]
   *
   * px(k+1) = px(k) + vx(k)*dt + 0.5*ax(k)*dt^2
   * vx(k+1) = vx(k) + ax(k)*dt
   * ax(k+1) = ax(k)  (가속도는 유지)
   */
  private getStateTransitionMatrix(dt: number): number[][] {
    const dt2 = 0.5 * dt * dt;
    return [
      [1, 0, 0, dt, 0, 0, dt2, 0],    // px
      [0, 1, 0, 0, dt, 0, 0, dt2],    // py
      [0, 0, 1, 0, 0, dt, 0, 0],      // pz (수직 가속도 미사용)
      [0, 0, 0, 1, 0, 0, dt, 0],      // vx
      [0, 0, 0, 0, 1, 0, 0, dt],      // vy
      [0, 0, 0, 0, 0, 1, 0, 0],       // vz
      [0, 0, 0, 0, 0, 0, 1, 0],       // ax
      [0, 0, 0, 0, 0, 0, 0, 1],       // ay
    ];
  }

  /**
   * 상태 전이 적용
   */
  private applyStateTransition(x: number[], F: number[][]): number[] {
    const result: number[] = [];
    for (let i = 0; i < F.length; i++) {
      let sum = 0;
      for (let j = 0; j < x.length; j++) {
        sum += F[i][j] * x[j];
      }
      result.push(sum);
    }
    return result;
  }

  /**
   * 프로세스 노이즈 행렬 Q 생성
   *
   * 이산 노이즈 모델 (piece-wise constant acceleration)
   */
  private getProcessNoiseMatrix(dt: number): number[][] {
    const { positionNoise, velocityNoise, accelerationNoise } = this.config.processNoise;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt3 * dt;

    // 가속도 기반 프로세스 노이즈
    const qa = accelerationNoise * accelerationNoise;
    const qv = velocityNoise * velocityNoise;
    const qp = positionNoise * positionNoise;

    // 간단화된 Q 행렬 (대각 우세)
    return [
      [qp + qa * dt4 / 4, 0, 0, qa * dt3 / 2, 0, 0, qa * dt2 / 2, 0],
      [0, qp + qa * dt4 / 4, 0, 0, qa * dt3 / 2, 0, 0, qa * dt2 / 2],
      [0, 0, qp, 0, 0, qv * dt, 0, 0],
      [qa * dt3 / 2, 0, 0, qv + qa * dt2, 0, 0, qa * dt, 0],
      [0, qa * dt3 / 2, 0, 0, qv + qa * dt2, 0, 0, qa * dt],
      [0, 0, qv * dt, 0, 0, qv, 0, 0],
      [qa * dt2 / 2, 0, 0, qa * dt, 0, 0, qa, 0],
      [0, qa * dt2 / 2, 0, 0, qa * dt, 0, 0, qa],
    ];
  }

  // ============================================
  // 업데이트 단계 (Update) - EKF
  // ============================================

  /**
   * 센서 관측치로 상태 업데이트
   */
  update(state: KalmanState, obs: KalmanObservation): KalmanState {
    // 예측된 관측치
    const z_pred = this.predictMeasurement(state.x, obs.sensor);

    // 실제 관측치
    const z = this.extractMeasurement(obs);

    if (!z || z.length === 0) {
      return state;
    }

    // 야코비안 행렬 H
    const H = this.computeJacobian(state.x, obs.sensor);

    // 관측 노이즈 행렬 R
    const R = this.getMeasurementNoiseMatrix(obs.sensor, obs.confidence);

    // 혁신 (Innovation): y = z - h(x)
    const y = this.computeInnovation(z, z_pred, obs.sensor);

    // 혁신 공분산: S = H * P * H^T + R
    const HP = matrixMultiply(H, state.P);
    const HPHt = matrixMultiply(HP, matrixTranspose(H));
    const S = matrixAdd(HPHt, R);

    // 칼만 이득: K = P * H^T * S^-1
    const PHt = matrixMultiply(state.P, matrixTranspose(H));
    const S_inv = matrixInverse(S);
    const K = matrixMultiply(PHt, S_inv);

    // 상태 업데이트: x = x + K * y
    const Ky = matrixMultiply(K, vectorToColumnMatrix(y));
    const x_new = state.x.map((xi, i) => xi + Ky[i][0]);

    // 공분산 업데이트: P = (I - K*H) * P
    const KH = matrixMultiply(K, H);
    const I_KH = matrixSubtract(identityMatrix(8), KH);
    const P_new = matrixMultiply(I_KH, state.P);

    return {
      x: x_new,
      P: P_new,
      lastUpdateTime: obs.time,
      predictionCount: 0,
    };
  }

  /**
   * 센서 관측치로 상태 업데이트 (센서 타입별)
   */
  updateWithRadar(state: KalmanState, obs: KalmanObservation): KalmanState {
    return this.update(state, { ...obs, sensor: 'RADAR' });
  }

  updateWithAudio(state: KalmanState, obs: KalmanObservation): KalmanState {
    return this.update(state, { ...obs, sensor: 'AUDIO' });
  }

  updateWithEO(state: KalmanState, obs: KalmanObservation): KalmanState {
    return this.update(state, { ...obs, sensor: 'EO' });
  }

  // ============================================
  // 관측 모델 (비선형)
  // ============================================

  /**
   * 예측된 관측치 계산: h(x)
   */
  private predictMeasurement(x: number[], sensor: SensorType): number[] {
    const [px, py, pz, vx, vy] = x;

    // 기지 상대 좌표
    const dx = px - this.basePosition.x;
    const dy = py - this.basePosition.y;
    const dz = pz - this.basePosition.altitude;

    const range2D = Math.sqrt(dx * dx + dy * dy);
    const range3D = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const bearing = Math.atan2(dx, dy);  // 북쪽 기준 시계방향

    switch (sensor) {
      case 'RADAR':
        // [range, bearing, altitude, radialVelocity]
        const radialVel = range2D > 0.1 ? (dx * vx + dy * vy) / range2D : 0;
        return [range3D, bearing, pz, radialVel];

      case 'AUDIO':
        // [bearing]
        return [bearing];

      case 'EO':
        // [range, bearing, altitude]
        return [range2D, bearing, pz];

      default:
        return [];
    }
  }

  /**
   * 실제 관측치 추출
   */
  private extractMeasurement(obs: KalmanObservation): number[] {
    switch (obs.sensor) {
      case 'RADAR':
        if (obs.range !== undefined && obs.bearing !== undefined) {
          return [
            obs.range,
            obs.bearing,
            obs.altitude ?? 100,
            obs.radialVelocity ?? 0,
          ];
        }
        break;

      case 'AUDIO':
        if (obs.bearing !== undefined) {
          return [obs.bearing];
        }
        break;

      case 'EO':
        if (obs.range !== undefined && obs.bearing !== undefined) {
          return [obs.range, obs.bearing, obs.altitude ?? 100];
        }
        break;
    }
    return [];
  }

  /**
   * 야코비안 행렬 계산 (EKF 핵심)
   *
   * H = dh/dx (관측 함수의 상태에 대한 편미분)
   */
  computeJacobian(x: number[], sensor: SensorType): number[][] {
    const [px, py, pz, vx, vy] = x;

    const dx = px - this.basePosition.x;
    const dy = py - this.basePosition.y;
    const dz = pz - this.basePosition.altitude;

    const range2D_sq = dx * dx + dy * dy;
    const range2D = Math.sqrt(range2D_sq);
    const range3D_sq = range2D_sq + dz * dz;
    const range3D = Math.sqrt(range3D_sq);

    // 수치 안정성을 위한 최소값
    const eps = 0.01;
    const r2D = Math.max(range2D, eps);
    const r3D = Math.max(range3D, eps);

    switch (sensor) {
      case 'RADAR':
        // z = [range, bearing, altitude, radialVelocity]
        // drange/dpx = dx/r3D, drange/dpy = dy/r3D, drange/dpz = dz/r3D
        // dbearing/dpx = dy/r2D^2, dbearing/dpy = -dx/r2D^2
        // dalt/dpz = 1
        // dradialVel/dpx, dradialVel/dpy, dradialVel/dvx, dradialVel/dvy
        const drVel_dpx = vx / r2D - dx * (dx * vx + dy * vy) / (r2D * r2D * r2D);
        const drVel_dpy = vy / r2D - dy * (dx * vx + dy * vy) / (r2D * r2D * r2D);
        const drVel_dvx = dx / r2D;
        const drVel_dvy = dy / r2D;

        return [
          [dx / r3D, dy / r3D, dz / r3D, 0, 0, 0, 0, 0],       // drange
          [dy / (r2D * r2D), -dx / (r2D * r2D), 0, 0, 0, 0, 0, 0], // dbearing
          [0, 0, 1, 0, 0, 0, 0, 0],                              // daltitude
          [drVel_dpx, drVel_dpy, 0, drVel_dvx, drVel_dvy, 0, 0, 0], // dradialVel
        ];

      case 'AUDIO':
        // z = [bearing]
        return [
          [dy / (r2D * r2D), -dx / (r2D * r2D), 0, 0, 0, 0, 0, 0],
        ];

      case 'EO':
        // z = [range, bearing, altitude]
        return [
          [dx / r2D, dy / r2D, 0, 0, 0, 0, 0, 0],              // drange (2D)
          [dy / (r2D * r2D), -dx / (r2D * r2D), 0, 0, 0, 0, 0, 0], // dbearing
          [0, 0, 1, 0, 0, 0, 0, 0],                              // daltitude
        ];

      default:
        return [];
    }
  }

  /**
   * 혁신 (Innovation) 계산: y = z - h(x)
   *
   * 각도 차이는 -pi ~ pi 범위로 정규화
   */
  private computeInnovation(z: number[], z_pred: number[], sensor: SensorType): number[] {
    const y: number[] = [];

    for (let i = 0; i < z.length; i++) {
      let diff = z[i] - z_pred[i];

      // 방위각의 경우 각도 정규화
      if (sensor === 'RADAR' && i === 1) {
        diff = this.normalizeAngle(diff);
      } else if (sensor === 'AUDIO' && i === 0) {
        diff = this.normalizeAngle(diff);
      } else if (sensor === 'EO' && i === 1) {
        diff = this.normalizeAngle(diff);
      }

      y.push(diff);
    }

    return y;
  }

  /**
   * 각도 정규화 (-pi ~ pi)
   */
  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * 관측 노이즈 행렬 R 생성
   *
   * 신뢰도에 따라 노이즈 조정 (신뢰도 높을수록 노이즈 감소)
   */
  private getMeasurementNoiseMatrix(sensor: SensorType, confidence: number): number[][] {
    // 신뢰도 기반 스케일링 (0.5 ~ 2.0)
    const confidenceScale = 2.0 - confidence;

    switch (sensor) {
      case 'RADAR':
        const { range, bearing, altitude, radialVel } = this.config.measurementNoise.radar;
        return diagonalMatrix([
          (range * confidenceScale) ** 2,
          (bearing * confidenceScale) ** 2,
          (altitude * confidenceScale) ** 2,
          (radialVel * confidenceScale) ** 2,
        ]);

      case 'AUDIO':
        const audioBearing = this.config.measurementNoise.audio.bearing;
        return diagonalMatrix([
          (audioBearing * confidenceScale) ** 2,
        ]);

      case 'EO':
        const eo = this.config.measurementNoise.eo;
        return diagonalMatrix([
          (eo.range * confidenceScale) ** 2,
          (eo.bearing * confidenceScale) ** 2,
          (eo.altitude * confidenceScale) ** 2,
        ]);

      default:
        return [];
    }
  }

  // ============================================
  // 좌표 변환
  // ============================================

  /**
   * 극좌표 → 직교좌표 변환
   */
  private polarToCartesian(obs: KalmanObservation): TrackPosition {
    const range = obs.range ?? 500;  // 기본 거리
    const bearing = obs.bearing ?? 0;
    const altitude = obs.altitude ?? 100;

    return {
      x: this.basePosition.x + range * Math.sin(bearing),
      y: this.basePosition.y + range * Math.cos(bearing),
      altitude: altitude,
    };
  }

  // ============================================
  // 상태 추출
  // ============================================

  /**
   * 칼만 상태에서 위치 추출
   */
  getPosition(state: KalmanState): TrackPosition {
    return {
      x: state.x[0],
      y: state.x[1],
      altitude: state.x[2],
    };
  }

  /**
   * 칼만 상태에서 속도 추출
   */
  getVelocity(state: KalmanState): TrackVelocity {
    return {
      vx: state.x[3],
      vy: state.x[4],
      climbRate: state.x[5],
    };
  }

  /**
   * 칼만 상태에서 가속도 추출
   */
  getAcceleration(state: KalmanState): { ax: number; ay: number } {
    return {
      ax: state.x[6],
      ay: state.x[7],
    };
  }

  /**
   * 위치 불확실성 (표준편차) 추출
   */
  getPositionUncertainty(state: KalmanState): { x: number; y: number; z: number } {
    return {
      x: Math.sqrt(state.P[0][0]),
      y: Math.sqrt(state.P[1][1]),
      z: Math.sqrt(state.P[2][2]),
    };
  }

  /**
   * 상태 예측 유효성 체크
   */
  isStateValid(state: KalmanState): boolean {
    // 연속 예측 횟수가 너무 많으면 무효
    if (state.predictionCount > this.config.maxPredictionCount) {
      return false;
    }

    // 공분산이 너무 크면 무효
    const maxCov = Math.max(state.P[0][0], state.P[1][1], state.P[2][2]);
    if (maxCov > 10000) {  // 100m 표준편차
      return false;
    }

    return true;
  }

  // ============================================
  // 기동 감지
  // ============================================

  /**
   * 기동 강도 추정 (가속도 크기)
   */
  getManeuverIntensity(state: KalmanState): number {
    const ax = state.x[6];
    const ay = state.x[7];
    return Math.sqrt(ax * ax + ay * ay);
  }

  /**
   * 기동 감지 시 프로세스 노이즈 증가
   */
  adaptProcessNoise(state: KalmanState): KalmanState {
    const maneuver = this.getManeuverIntensity(state);

    if (maneuver > 3.0) {
      // 기동 중: 프로세스 노이즈 증가
      const scaleFactor = 1 + maneuver / 5;
      const Q_extra = matrixScalarMultiply(
        scaleFactor - 1,
        diagonalMatrix([1, 1, 1, 2, 2, 2, 4, 4])
      );

      return {
        ...state,
        P: matrixAdd(state.P, Q_extra),
      };
    }

    return state;
  }

  // ============================================
  // 설정 업데이트
  // ============================================

  /**
   * 기지 위치 업데이트
   */
  updateBasePosition(position: TrackPosition): void {
    this.basePosition = position;
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<KalmanConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================
// 표준 칼만 필터 (비교용)
// ============================================

/**
 * 선형 칼만 필터 (비교용)
 *
 * 관측 모델이 선형이라고 가정 (직교좌표 관측)
 * EKF와 성능 비교를 위해 제공
 */
export class StandardKalmanFilter extends ExtendedKalmanFilter {
  /**
   * 선형 관측 모델 사용
   * z = H * x + v
   *
   * 직교좌표 관측: z = [px, py, pz]
   */
  updateLinear(state: KalmanState, position: TrackPosition, confidence: number): KalmanState {
    // 관측 행렬 H (직교좌표)
    const H: number[][] = [
      [1, 0, 0, 0, 0, 0, 0, 0],  // px
      [0, 1, 0, 0, 0, 0, 0, 0],  // py
      [0, 0, 1, 0, 0, 0, 0, 0],  // pz
    ];

    // 관측 노이즈 R
    const posNoise = 10 * (2 - confidence);  // 신뢰도 기반
    const R = diagonalMatrix([
      posNoise * posNoise,
      posNoise * posNoise,
      posNoise * posNoise,
    ]);

    // 관측치
    const z = [position.x, position.y, position.altitude];

    // 예측 관측치
    const z_pred = [state.x[0], state.x[1], state.x[2]];

    // 혁신
    const y = z.map((zi, i) => zi - z_pred[i]);

    // 혁신 공분산: S = H * P * H^T + R
    const HP = matrixMultiply(H, state.P);
    const HPHt = matrixMultiply(HP, matrixTranspose(H));
    const S = matrixAdd(HPHt, R);

    // 칼만 이득: K = P * H^T * S^-1
    const PHt = matrixMultiply(state.P, matrixTranspose(H));
    const S_inv = matrixInverse(S);
    const K = matrixMultiply(PHt, S_inv);

    // 상태 업데이트
    const Ky = matrixMultiply(K, vectorToColumnMatrix(y));
    const x_new = state.x.map((xi, i) => xi + Ky[i][0]);

    // 공분산 업데이트
    const KH = matrixMultiply(K, H);
    const I_KH = matrixSubtract(identityMatrix(8), KH);
    const P_new = matrixMultiply(I_KH, state.P);

    return {
      x: x_new,
      P: P_new,
      lastUpdateTime: state.lastUpdateTime,
      predictionCount: 0,
    };
  }
}

// ============================================
// 융합 모드 타입
// ============================================

export type FusionMode = 'WEIGHTED_AVG' | 'KALMAN' | 'EKF' | 'PARTICLE';

export default ExtendedKalmanFilter;
