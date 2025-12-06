# AirSim 연동 설계 문서

**프로젝트**: anti-drone-c2 (소부대 대드론 C2 시뮬레이터)
**버전**: v2.2 → v3.0 (AirSim Integration)
**작성일**: 2025-12-05

---

## 목차

1. [현재 레포지토리 구조 분석](#1-현재-레포지토리-구조-분석)
2. [AirSim 연동 필요 컴포넌트](#2-airsim-연동-필요-컴포넌트)
3. [전체 연동 아키텍처](#3-전체-연동-아키텍처)
4. [모드 전환 설계 (INTERNAL vs EXTERNAL)](#4-모드-전환-설계)
5. [구현 로드맵](#5-구현-로드맵)

---

## 1. 현재 레포지토리 구조 분석

### 1.1 전체 구조 개요

```
드론지휘통제체계/
├── frontend/              # React + TypeScript C2 UI
│   ├── src/
│   │   ├── components/    # UI 컴포넌트
│   │   ├── hooks/         # useWebSocket
│   │   ├── logic/         # 로컬 시뮬레이션 로직
│   │   └── types/         # 타입 정의
│   └── package.json
│
├── simulator/             # Node.js + TypeScript 시뮬레이터 서버
│   ├── src/
│   │   ├── config/        # 환경 변수 검증 (Zod)
│   │   │   ├── env.ts
│   │   │   └── runtimeParams.ts
│   │   │
│   │   ├── core/          # 핵심 로직
│   │   │   ├── fusion/    # 센서 융합
│   │   │   │   ├── sensorFusion.ts     # 융합 엔진
│   │   │   │   ├── threatScore.ts      # 위협도 평가
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── engagement/  # 교전 관리
│   │   │   │   ├── engagementManager.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── config.ts
│   │   │   │
│   │   │   ├── logging/   # JSONL 로깅
│   │   │   │   ├── logger.ts
│   │   │   │   └── eventSchemas.ts
│   │   │   │
│   │   │   └── scenario/  # 시나리오 생성
│   │   │       └── generator.ts
│   │   │
│   │   ├── sensors/       # 센서 시뮬레이션 (현재 내부 구현)
│   │   │   ├── radar.ts           # 레이더 센서
│   │   │   ├── acousticSensor.ts  # 음향 센서
│   │   │   └── eoSensor.ts        # EO 카메라 센서
│   │   │
│   │   ├── models/        # 드론 물리/행동 모델 (현재 내부 구현)
│   │   │   ├── hostileDrone.ts    # 적 드론 모델
│   │   │   ├── interceptor.ts     # 요격 드론 모델
│   │   │   └── guidance.ts        # PN 유도
│   │   │
│   │   ├── websocket/     # WebSocket 서버
│   │   │   ├── server.ts          # 메인 서버
│   │   │   ├── security.ts        # 보안 미들웨어
│   │   │   └── errorHandler.ts    # 에러 핸들링
│   │   │
│   │   ├── types.ts       # 공통 타입
│   │   ├── config.ts      # 설정 관리
│   │   ├── simulation.ts  # 시뮬레이션 엔진 (메인)
│   │   └── index.ts       # 진입점
│   │
│   └── package.json
│
├── shared/                # 공통 스키마 (frontend ↔ simulator)
│   └── schemas.ts
│
└── audio_model/           # Python 음향 모델 (선택)
    ├── model.py
    └── websocket_client.py
```

### 1.2 핵심 모듈별 역할

#### A. `simulation.ts` (SimulationEngine)
**역할**: 시뮬레이션의 중앙 제어 허브

- **현재 기능**:
  - 100ms 틱 단위로 전체 시뮬레이션 진행
  - 모든 드론/센서 업데이트 호출
  - 센서 융합 실행
  - 교전 관리
  - 이벤트 브로드캐스트 (WebSocket)
  - JSONL 로깅

- **의존성**:
  - `RadarSensor`, `AcousticSensor`, `EOSensor` (내부 센서 시뮬)
  - `SensorFusion` (센서 융합)
  - `EngagementManager` (교전 관리)
  - `updateHostileDrone`, `updateInterceptor` (물리 업데이트)

- **AirSim 연동 시 변경 필요**:
  - 센서 데이터 소스 변경 (내부 → AirSim API)
  - 드론 물리 업데이트 변경 (내부 → AirSim 제어)

#### B. `sensors/` (센서 시뮬레이션)
**역할**: 가상 센서 데이터 생성

- **RadarSensor**:
  - 노이즈, 오탐률, 미탐률 포함
  - 거리, 방위각, 고도, 접근 속도 계산

- **AcousticSensor**:
  - 드론 활동 상태 분류 (TAKEOFF, HOVER 등)

- **EOSensor**:
  - 350m 이내 드론 분류 (HOSTILE/CIVIL)

- **AirSim 연동 시**:
  - 센서 데이터는 AirSim API에서 가져오되,
  - 노이즈 모델은 기존 로직 재사용 가능
  - **어댑터 패턴** 필요

#### C. `models/` (드론 물리 모델)
**역할**: 드론 위치/속도 업데이트

- **hostileDrone.ts**:
  - 행동 모드별 물리 계산 (NORMAL, RECON, ATTACK_RUN, EVADE)
  - 목표 추적, 회피 기동

- **interceptor.ts**:
  - PN 유도 알고리즘
  - 요격 방식별 상태 머신 (RAM, GUN, NET, JAM)

- **AirSim 연동 시**:
  - 물리 계산은 AirSim이 수행
  - 행동 로직(AI)만 유지하고 AirSim API로 명령 전송
  - **제어 어댑터** 필요

#### D. `core/fusion/` (센서 융합)
**역할**: 다중 센서 데이터 통합 및 위협도 평가

- **SensorFusion**:
  - 센서별 관측 데이터 결합
  - Fused Track 생성
  - 분류 결과 (HOSTILE/CIVIL) 추론

- **threatScore.ts**:
  - 거리, 속도, 행동, 탑재체, 크기 기반 위협도 계산
  - CRITICAL/DANGER/CAUTION/INFO 레벨

- **AirSim 연동 시**:
  - **변경 불필요** (센서 데이터 소스만 바뀜)
  - 센서 융합 로직은 그대로 유지

#### E. `core/engagement/` (교전 관리)
**역할**: 자동 교전 결정 및 요격 드론 할당

- **EngagementManager**:
  - 위협도 기반 자동 교전 판단
  - 요격 드론 할당 알고리즘
  - 교전 상태 추적

- **AirSim 연동 시**:
  - **변경 불필요**
  - 요격 명령만 AirSim API로 전송

#### F. `websocket/server.ts` (통신 서버)
**역할**: C2 UI와 양방향 통신

- **현재 기능**:
  - 인증, CORS, Rate Limiting
  - 이벤트 브로드캐스트
  - 명령 수신 (engage, simulation_control 등)

- **AirSim 연동 시**:
  - **변경 불필요**
  - 단, AirSim 브리지와 별도 통신 채널 필요

---

## 2. AirSim 연동 필요 컴포넌트

### 2.1 AirSim 개요

**AirSim (Aerial Informatics and Robotics Simulation)**
- Microsoft 개발, Unreal Engine 기반
- 실사 수준 3D 렌더링
- 물리 엔진 (Chaos Physics)
- Python/C++ API 제공
- ROS 연동 가능

### 2.2 연동 아키텍처 레이어

```
┌─────────────────────────────────────────────────────────────┐
│                       C2 UI (React)                         │
│                     (변경 없음)                              │
└─────────────────┬───────────────────────────────────────────┘
                  │ WebSocket
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              WebSocket Server (Node.js)                     │
│                (변경 최소화)                                 │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│            SimulationEngine (메인 로직)                      │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  SIM_MODE = 'INTERNAL' or 'EXTERNAL_AIRSIM'        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────┬─────────────────┐                     │
│  │  INTERNAL 모드   │  EXTERNAL 모드   │                     │
│  ├─────────────────┼─────────────────┤                     │
│  │ 기존 센서/모델   │  AirSim Adapter │                     │
│  │ (2D 시뮬)       │  (3D 시뮬)      │                     │
│  └─────────────────┴─────────────────┘                     │
│                          │                                  │
│                          ▼                                  │
│               ┌──────────────────────┐                      │
│               │ Sensor Fusion        │                      │
│               │ (공통)               │                      │
│               └──────────────────────┘                      │
│                          │                                  │
│                          ▼                                  │
│               ┌──────────────────────┐                      │
│               │ Engagement Manager   │                      │
│               │ (공통)               │                      │
│               └──────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
                          │
           ┌──────────────┴──────────────┐
           │ (EXTERNAL 모드일 때만)       │
           ▼                             ▼
┌──────────────────────┐      ┌──────────────────────┐
│  AirSim Bridge       │      │  Unreal Engine       │
│  (Python/Node.js)    │◄────►│  + AirSim Plugin     │
└──────────────────────┘      └──────────────────────┘
           │
           ▼
    Python AirSim API
```

### 2.3 신규 컴포넌트 설계

#### A. **ISensorProvider 인터페이스** (추상화)

**위치**: `simulator/src/adapters/ISensorProvider.ts`

```typescript
export interface SensorObservation {
  droneId: string;
  timestamp: number;
  position?: Position3D;
  velocity?: Velocity3D;
  sensorType: SensorType;
  confidence: number;
  // 센서별 추가 데이터
}

export interface ISensorProvider {
  // 레이더 스캔
  scanRadar(currentTime: number, drones: Map<string, DroneState>):
    Promise<RadarDetectionEvent[]>;

  // 음향 탐지
  detectAudio(currentTime: number, drones: Map<string, DroneState>):
    Promise<AudioDetectionEvent[]>;

  // EO 탐지
  detectEO(currentTime: number, drones: Map<string, DroneState>):
    Promise<EODetectionEvent[]>;

  // 센서 설정 업데이트
  updateConfig(config: SensorConfig): void;
}
```

#### B. **InternalSensorProvider** (기존 센서)

**위치**: `simulator/src/adapters/InternalSensorProvider.ts`

```typescript
export class InternalSensorProvider implements ISensorProvider {
  private radarSensor: RadarSensor;
  private acousticSensor: AcousticSensor;
  private eoSensor: EOSensor;

  constructor(basePosition: Position3D, config: SensorConfig) {
    this.radarSensor = new RadarSensor(basePosition, config.radar);
    this.acousticSensor = new AcousticSensor(basePosition);
    this.eoSensor = new EOSensor(basePosition, config.eo);
  }

  async scanRadar(currentTime: number, drones: Map<string, HostileDrone>):
    Promise<RadarDetectionEvent[]> {
    // 기존 RadarSensor.scan() 호출
    return this.radarSensor.scan(currentTime, drones);
  }

  // 나머지 메서드도 기존 센서 래핑
}
```

#### C. **AirSimSensorProvider** (AirSim 센서)

**위치**: `simulator/src/adapters/AirSimSensorProvider.ts`

```typescript
import { AirSimBridgeClient } from './AirSimBridgeClient';

export class AirSimSensorProvider implements ISensorProvider {
  private bridge: AirSimBridgeClient;
  private noiseModel: NoiseModel;  // 기존 노이즈 모델 재사용

  constructor(bridgeUrl: string, config: SensorConfig) {
    this.bridge = new AirSimBridgeClient(bridgeUrl);
    this.noiseModel = new NoiseModel(config);
  }

  async scanRadar(currentTime: number, drones: Map<string, DroneState>):
    Promise<RadarDetectionEvent[]> {
    // 1. AirSim에서 드론 위치 가져오기
    const droneStates = await this.bridge.getDroneStates();

    // 2. 레이더 시뮬레이션 (거리/방위각 계산)
    const detections: RadarDetectionEvent[] = [];
    for (const [droneId, state] of droneStates) {
      const range = this.calculateRange(state.position);
      const bearing = this.calculateBearing(state.position);

      // 3. 노이즈 적용 (기존 로직)
      const noisyRange = this.noiseModel.addRadialNoise(range);
      const noisyBearing = this.noiseModel.addAzimuthNoise(bearing);

      // 4. 오탐/미탐 처리 (기존 로직)
      if (this.noiseModel.shouldMiss()) continue;

      detections.push({
        type: 'radar_detection',
        timestamp: currentTime,
        drone_id: droneId,
        range: noisyRange,
        bearing: noisyBearing,
        altitude: state.position.altitude,
        confidence: this.calculateConfidence(range),
      });
    }

    return detections;
  }

  async detectEO(currentTime: number, drones: Map<string, DroneState>):
    Promise<EODetectionEvent[]> {
    // AirSim 카메라 API 활용
    const images = await this.bridge.getCameraImages();

    // 이미지 분석 (YOLO 등) 또는 AirSim 자체 센서 활용
    // 여기서는 간단히 거리 기반으로 분류
    const detections: EODetectionEvent[] = [];
    for (const [droneId, state] of await this.bridge.getDroneStates()) {
      const range = this.calculateRange(state.position);
      if (range > 350) continue;  // EO 최대 거리

      // 분류 (실제로는 이미지 분석 필요)
      const classification = this.classifyDrone(droneId, state);

      detections.push({
        type: 'eo_detection',
        timestamp: currentTime,
        drone_id: droneId,
        classification,
        confidence: this.calculateEOConfidence(range),
        range,
      });
    }

    return detections;
  }
}
```

#### D. **IDroneController 인터페이스** (제어 추상화)

**위치**: `simulator/src/adapters/IDroneController.ts`

```typescript
export interface DroneCommand {
  droneId: string;
  velocity?: Velocity3D;
  targetPosition?: Position3D;
  guidanceMode?: GuidanceMode;
}

export interface IDroneController {
  // 드론 생성/제거
  spawnDrone(config: DroneSpawnConfig): Promise<string>;
  removeDrone(droneId: string): Promise<void>;

  // 드론 상태 조회
  getDroneState(droneId: string): Promise<DroneState>;
  getAllDroneStates(): Promise<Map<string, DroneState>>;

  // 드론 제어
  updateDrone(droneId: string, command: DroneCommand): Promise<void>;

  // 요격 드론 특수 명령
  launchInterceptor(interceptorId: string, targetId: string): Promise<void>;
  executeIntercept(interceptorId: string, method: InterceptMethod): Promise<InterceptResult>;
}
```

#### E. **InternalDroneController** (기존 모델)

**위치**: `simulator/src/adapters/InternalDroneController.ts`

```typescript
export class InternalDroneController implements IDroneController {
  private world: SimulationWorld;

  constructor(world: SimulationWorld) {
    this.world = world;
  }

  async spawnDrone(config: DroneSpawnConfig): Promise<string> {
    const drone = createHostileDrone(
      config.position,
      config.velocity,
      config.behavior,
      config.config,
      config.targetPosition,
      config.trueLabel
    );
    this.world.hostileDrones.set(drone.id, drone);
    return drone.id;
  }

  async updateDrone(droneId: string, command: DroneCommand): Promise<void> {
    // 기존 updateHostileDrone() 호출
    const drone = this.world.hostileDrones.get(droneId);
    if (!drone) return;

    const updated = updateHostileDrone(
      drone,
      0.1,  // deltaTime
      this.world.basePosition,
      this.world.interceptors
    );

    this.world.hostileDrones.set(droneId, updated);
  }

  // 나머지 메서드도 기존 로직 래핑
}
```

#### F. **AirSimDroneController** (AirSim 제어)

**위치**: `simulator/src/adapters/AirSimDroneController.ts`

```typescript
import { AirSimBridgeClient } from './AirSimBridgeClient';

export class AirSimDroneController implements IDroneController {
  private bridge: AirSimBridgeClient;
  private droneRegistry: Map<string, AirSimDroneInfo> = new Map();

  constructor(bridgeUrl: string) {
    this.bridge = new AirSimBridgeClient(bridgeUrl);
  }

  async spawnDrone(config: DroneSpawnConfig): Promise<string> {
    // AirSim API로 드론 생성
    const droneId = await this.bridge.spawnDrone({
      vehicleName: `drone_${Date.now()}`,
      position: config.position,
      initialVelocity: config.velocity,
    });

    this.droneRegistry.set(droneId, {
      behavior: config.behavior,
      targetPosition: config.targetPosition,
      trueLabel: config.trueLabel,
    });

    return droneId;
  }

  async updateDrone(droneId: string, command: DroneCommand): Promise<void> {
    // 행동 로직 계산 (기존 hostileDrone.ts 활용)
    const info = this.droneRegistry.get(droneId);
    if (!info) return;

    // 목표 위치/속도 계산 (기존 알고리즘)
    const targetVelocity = this.calculateVelocity(info, command);

    // AirSim API로 속도 명령 전송
    await this.bridge.setVelocity(droneId, targetVelocity);
  }

  async launchInterceptor(interceptorId: string, targetId: string): Promise<void> {
    // PN 유도 루프 시작
    const pnController = new PNController(
      this.bridge,
      interceptorId,
      targetId,
      DEFAULT_PN_CONFIG
    );

    // 별도 스레드에서 지속적으로 유도 명령 전송
    pnController.start();
  }

  private calculateVelocity(info: AirSimDroneInfo, command: DroneCommand): Velocity3D {
    // 기존 hostileDrone.ts의 행동 로직 재사용
    // NORMAL, RECON, ATTACK_RUN, EVADE 모드별 계산
    // ...
    return velocity;
  }
}
```

#### G. **AirSimBridgeClient** (통신 계층)

**위치**: `simulator/src/adapters/AirSimBridgeClient.ts`

```typescript
import WebSocket from 'ws';

export interface AirSimDroneState {
  position: Position3D;
  velocity: Velocity3D;
  orientation: { roll: number; pitch: number; yaw: number };
}

export class AirSimBridgeClient {
  private ws: WebSocket;
  private requestId: number = 0;
  private pendingRequests: Map<number, any> = new Map();

  constructor(bridgeUrl: string) {
    this.ws = new WebSocket(bridgeUrl);
    this.setupHandlers();
  }

  // AirSim 명령 전송 (JSON-RPC 스타일)
  async call(method: string, params: any): Promise<any> {
    const id = this.requestId++;
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));

      // 타임아웃
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 5000);
    });
  }

  // 드론 생성
  async spawnDrone(config: any): Promise<string> {
    return this.call('spawnDrone', config);
  }

  // 드론 상태 조회
  async getDroneStates(): Promise<Map<string, AirSimDroneState>> {
    const states = await this.call('getDroneStates', {});
    return new Map(Object.entries(states));
  }

  // 속도 명령
  async setVelocity(droneId: string, velocity: Velocity3D): Promise<void> {
    await this.call('setVelocity', { droneId, velocity });
  }

  // 카메라 이미지
  async getCameraImages(): Promise<ImageData[]> {
    return this.call('getCameraImages', {});
  }

  private setupHandlers(): void {
    this.ws.on('message', (data) => {
      const response = JSON.parse(data.toString());
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    });
  }
}
```

#### H. **AirSimBridge (Python)** - 별도 프로세스

**위치**: `airsim_bridge/bridge.py`

```python
import airsim
import asyncio
import websockets
import json

class AirSimBridge:
    def __init__(self, airsim_host='localhost'):
        self.client = airsim.MultirotorClient()
        self.client.confirmConnection()
        self.drones = {}  # droneId -> vehicleName

    async def handle_request(self, websocket, path):
        async for message in websocket:
            request = json.loads(message)
            method = request['method']
            params = request['params']

            try:
                if method == 'spawnDrone':
                    result = await self.spawn_drone(params)
                elif method == 'getDroneStates':
                    result = await self.get_drone_states()
                elif method == 'setVelocity':
                    result = await self.set_velocity(params)
                elif method == 'getCameraImages':
                    result = await self.get_camera_images()
                else:
                    raise ValueError(f'Unknown method: {method}')

                response = {
                    'jsonrpc': '2.0',
                    'id': request['id'],
                    'result': result
                }
            except Exception as e:
                response = {
                    'jsonrpc': '2.0',
                    'id': request['id'],
                    'error': {'code': -32000, 'message': str(e)}
                }

            await websocket.send(json.dumps(response))

    async def spawn_drone(self, params):
        vehicle_name = params['vehicleName']
        position = params['position']

        # AirSim에 드론 생성
        pose = airsim.Pose(
            airsim.Vector3r(position['x'], position['y'], -position['altitude']),
            airsim.Quaternionr(0, 0, 0, 1)
        )
        self.client.simAddVehicle(vehicle_name, 'simpleflight', pose)
        self.client.enableApiControl(True, vehicle_name)
        self.client.armDisarm(True, vehicle_name)

        drone_id = f'airsim_{vehicle_name}'
        self.drones[drone_id] = vehicle_name
        return drone_id

    async def get_drone_states(self):
        states = {}
        for drone_id, vehicle_name in self.drones.items():
            state = self.client.getMultirotorState(vehicle_name)
            states[drone_id] = {
                'position': {
                    'x': state.kinematics_estimated.position.x_val,
                    'y': state.kinematics_estimated.position.y_val,
                    'altitude': -state.kinematics_estimated.position.z_val
                },
                'velocity': {
                    'vx': state.kinematics_estimated.linear_velocity.x_val,
                    'vy': state.kinematics_estimated.linear_velocity.y_val,
                    'climbRate': -state.kinematics_estimated.linear_velocity.z_val
                }
            }
        return states

    async def set_velocity(self, params):
        drone_id = params['droneId']
        velocity = params['velocity']
        vehicle_name = self.drones[drone_id]

        self.client.moveByVelocityAsync(
            velocity['vx'],
            velocity['vy'],
            -velocity['climbRate'],
            duration=0.1,  # 짧은 주기
            vehicle_name=vehicle_name
        )
        return True

# 실행
if __name__ == '__main__':
    bridge = AirSimBridge()
    start_server = websockets.serve(bridge.handle_request, 'localhost', 9000)
    asyncio.get_event_loop().run_until_complete(start_server)
    asyncio.get_event_loop().run_forever()
```

---

## 3. 전체 연동 아키텍처

### 3.1 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                        C2 UI (React)                                │
│  - 레이더 맵 뷰                                                       │
│  - 위협도 표시                                                        │
│  - 교전 제어 UI                                                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ WebSocket
                               │ (ws://localhost:8080)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  WebSocket Server (Node.js)                         │
│  - 인증, CORS, Rate Limiting                                        │
│  - 이벤트 브로드캐스트                                                │
│  - 명령 라우팅                                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│               SimulationEngine (메인 로직)                           │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ MODE_SELECTOR                                               │  │
│  │   SIM_MODE: 'INTERNAL' | 'EXTERNAL_AIRSIM'                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Adapter Factory                                            │  │
│  │  - createSensorProvider(mode)                              │  │
│  │  - createDroneController(mode)                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
│           │                              │                         │
│           ▼                              ▼                         │
│  ┌──────────────────┐         ┌──────────────────┐                │
│  │ ISensorProvider  │         │ IDroneController │                │
│  └────────┬─────────┘         └────────┬─────────┘                │
│           │                            │                           │
│    ┌──────┴───────┐            ┌───────┴────────┐                 │
│    │              │            │                │                 │
│    ▼              ▼            ▼                ▼                 │
│  Internal   AirSim       Internal        AirSim                   │
│  Sensor     Sensor       Drone           Drone                    │
│  Provider   Provider     Controller      Controller               │
│  (기존)     (신규)       (기존)          (신규)                     │
│    │          │            │                │                     │
│    └──────────┴────────────┴────────────────┘                     │
│                       │                                            │
│                       ▼                                            │
│           ┌───────────────────────┐                                │
│           │  SensorFusion         │ ◄─── 공통 로직 (변경 없음)     │
│           │  - 다중 센서 결합      │                                │
│           │  - 분류 추론           │                                │
│           └───────────┬───────────┘                                │
│                       │                                            │
│                       ▼                                            │
│           ┌───────────────────────┐                                │
│           │  ThreatScore          │ ◄─── 공통 로직 (변경 없음)     │
│           │  - 위협도 평가         │                                │
│           └───────────┬───────────┘                                │
│                       │                                            │
│                       ▼                                            │
│           ┌───────────────────────┐                                │
│           │  EngagementManager    │ ◄─── 공통 로직 (변경 없음)     │
│           │  - 자동 교전 결정      │                                │
│           │  - 요격 드론 할당      │                                │
│           └───────────┬───────────┘                                │
│                       │                                            │
│                       ▼                                            │
│           ┌───────────────────────┐                                │
│           │  Logger (JSONL)       │ ◄─── 공통 로직 (변경 없음)     │
│           └───────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │ (EXTERNAL 모드일 때만)   │
          ▼                         │
┌───────────────────────┐           │
│ AirSimBridgeClient    │           │
│ (Node.js WebSocket)   │           │
└──────────┬────────────┘           │
           │ WebSocket               │
           │ (ws://localhost:9000)   │
           ▼                         │
┌───────────────────────┐           │
│ AirSimBridge          │           │
│ (Python Server)       │           │
│  - WebSocket Server   │           │
│  - AirSim API 래핑    │           │
└──────────┬────────────┘           │
           │ AirSim Python API       │
           ▼                         │
┌───────────────────────────────────┴─┐
│  Unreal Engine + AirSim Plugin      │
│  - 3D 렌더링                         │
│  - 물리 시뮬레이션                    │
│  - 센서 시뮬레이션 (카메라, Lidar 등) │
│  - 드론 제어                         │
└─────────────────────────────────────┘
```

### 3.2 데이터 플로우 (EXTERNAL 모드)

#### 시나리오 시작 시퀀스

```
C2 UI                WebSocket         SimulationEngine    AirSimBridge      Unreal/AirSim
  │                     │                    │                  │                 │
  ├─ start scenario ───►│                    │                  │                 │
  │                     ├─ simulation_control│                  │                 │
  │                     │   (action: start)  │                  │                 │
  │                     │                    ├─ spawnDrone ────►│                 │
  │                     │                    │                  ├─ simAddVehicle─►│
  │                     │                    │                  │◄────OK──────────┤
  │                     │                    │◄─ droneId ───────┤                 │
  │                     │                    ├─ spawnDrone ────►│                 │
  │                     │                    │  (반복...)        │                 │
  │                     │                    │                  │                 │
  │◄─ scenario_start ───┤◄───broadcast───────┤                  │                 │
  │                     │                    │                  │                 │
```

#### 시뮬레이션 틱 (100ms마다)

```
SimulationEngine              AirSimBridge           Unreal/AirSim
     │                             │                      │
     ├─ tick()                     │                      │
     │                             │                      │
     ├─ getDroneStates() ─────────►│                      │
     │                             ├─ getMultirotorState─►│
     │                             │◄─────states──────────┤
     │◄────states───────────────────┤                      │
     │                             │                      │
     ├─ scanRadar(states)          │                      │
     │   (노이즈 추가, 오탐/미탐)    │                      │
     │                             │                      │
     ├─ detectEO(states)           │                      │
     │                             │                      │
     ├─ sensorFusion.update()      │                      │
     │   (융합 로직)                │                      │
     │                             │                      │
     ├─ threatScore.calculate()    │                      │
     │                             │                      │
     ├─ engagementManager.decide() │                      │
     │                             │                      │
     ├─ updateDrone(command) ──────►│                      │
     │                             ├─ moveByVelocity ────►│
     │                             │                      │
     ├─ broadcast(events) ─────────►WebSocket Server      │
     │                             │                      │
```

### 3.3 통신 프로토콜

#### A. C2 UI ↔ WebSocket Server (기존)

**변경 없음**, 기존 `shared/schemas.ts` 사용

#### B. Node.js ↔ AirSim Bridge (신규)

**프로토콜**: JSON-RPC 2.0 over WebSocket

**요청 형식**:
```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "method": "getDroneStates",
  "params": {}
}
```

**응답 형식**:
```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "result": {
    "airsim_drone_1": {
      "position": {"x": 100, "y": 200, "altitude": 50},
      "velocity": {"vx": 10, "vy": 5, "climbRate": 0}
    }
  }
}
```

**주요 메서드**:

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|---------|--------|------|
| `spawnDrone` | `{vehicleName, position, velocity}` | `droneId` | 드론 생성 |
| `removeDrone` | `{droneId}` | `ok` | 드론 제거 |
| `getDroneStates` | `{}` | `Map<droneId, state>` | 모든 드론 상태 |
| `setVelocity` | `{droneId, velocity}` | `ok` | 속도 명령 |
| `setPosition` | `{droneId, position}` | `ok` | 위치 명령 |
| `getCameraImages` | `{droneId, cameraName}` | `imageData[]` | 카메라 이미지 |
| `getLidarData` | `{droneId}` | `pointCloud` | Lidar 데이터 |

---

## 4. 모드 전환 설계

### 4.1 설정 방식

#### 환경 변수 (.env)

```env
# 시뮬레이션 모드
SIM_MODE=INTERNAL              # 또는 EXTERNAL_AIRSIM

# AirSim 브리지 설정 (EXTERNAL 모드일 때만)
AIRSIM_BRIDGE_URL=ws://localhost:9000
AIRSIM_SYNC_INTERVAL=100       # AirSim 동기화 간격 (ms)
AIRSIM_ENABLE_RENDERING=true   # 3D 렌더링 활성화
```

#### 런타임 파라미터 (simulator/config/runtime_params.json)

```json
{
  "simulation": {
    "mode": "INTERNAL",
    "tickInterval": 100
  },
  "airsim": {
    "enabled": false,
    "bridgeUrl": "ws://localhost:9000",
    "syncInterval": 100,
    "rendering": {
      "enabled": true,
      "quality": "high"
    },
    "physics": {
      "gravity": -9.81,
      "windSpeed": 0
    }
  }
}
```

### 4.2 모드별 동작 차이

| 구분 | INTERNAL 모드 | EXTERNAL_AIRSIM 모드 |
|------|---------------|---------------------|
| **물리 엔진** | 내부 수학 모델 | Unreal Chaos Physics |
| **센서 시뮬** | RadarSensor 등 | AirSim 센서 API + 노이즈 모델 |
| **3D 렌더링** | 없음 (2D 맵만) | Unreal Engine 실사 렌더링 |
| **드론 제어** | updateHostileDrone() | AirSim moveByVelocity() |
| **카메라** | 없음 | AirSim 카메라 (RGB, Depth, Segmentation) |
| **성능** | 매우 빠름 | 중간 (GPU 의존) |
| **용도** | 빠른 실험, 자동 튜닝 | 논문 영상, 데모, 리얼리즘 |

### 4.3 AdapterFactory 패턴

**위치**: `simulator/src/adapters/AdapterFactory.ts`

```typescript
import { SimMode } from '../config/env';
import { ISensorProvider } from './ISensorProvider';
import { IDroneController } from './IDroneController';
import { InternalSensorProvider } from './InternalSensorProvider';
import { AirSimSensorProvider } from './AirSimSensorProvider';
import { InternalDroneController } from './InternalDroneController';
import { AirSimDroneController } from './AirSimDroneController';

export class AdapterFactory {
  static createSensorProvider(
    mode: SimMode,
    config: SensorConfig,
    basePosition: Position3D
  ): ISensorProvider {
    switch (mode) {
      case 'INTERNAL':
        return new InternalSensorProvider(basePosition, config);

      case 'EXTERNAL_AIRSIM':
        const bridgeUrl = process.env.AIRSIM_BRIDGE_URL || 'ws://localhost:9000';
        return new AirSimSensorProvider(bridgeUrl, config);

      default:
        throw new Error(`Unknown simulation mode: ${mode}`);
    }
  }

  static createDroneController(
    mode: SimMode,
    world?: SimulationWorld
  ): IDroneController {
    switch (mode) {
      case 'INTERNAL':
        if (!world) throw new Error('INTERNAL mode requires SimulationWorld');
        return new InternalDroneController(world);

      case 'EXTERNAL_AIRSIM':
        const bridgeUrl = process.env.AIRSIM_BRIDGE_URL || 'ws://localhost:9000';
        return new AirSimDroneController(bridgeUrl);

      default:
        throw new Error(`Unknown simulation mode: ${mode}`);
    }
  }
}
```

### 4.4 SimulationEngine 수정 개요

**기존**:
```typescript
export class SimulationEngine {
  private radarSensor: RadarSensor;
  private acousticSensor: AcousticSensor;
  private eoSensor: EOSensor;

  constructor(onEvent: (event: SimulatorToC2Event) => void) {
    this.radarSensor = new RadarSensor(basePosition, config.radar);
    this.acousticSensor = new AcousticSensor(basePosition);
    this.eoSensor = new EOSensor(basePosition, config.eo);
  }

  private tick(): void {
    // 센서 스캔
    const radarDetections = this.radarSensor.scan(this.world.time, this.world.hostileDrones);

    // 드론 업데이트
    for (const [id, drone] of this.world.hostileDrones) {
      const updated = updateHostileDrone(drone, deltaTime, ...);
      this.world.hostileDrones.set(id, updated);
    }
  }
}
```

**변경 후**:
```typescript
export class SimulationEngine {
  private sensorProvider: ISensorProvider;
  private droneController: IDroneController;
  private simMode: SimMode;

  constructor(onEvent: (event: SimulatorToC2Event) => void) {
    const config = getConfig();
    this.simMode = config.simMode;

    // Adapter Factory로 모드별 구현체 생성
    this.sensorProvider = AdapterFactory.createSensorProvider(
      this.simMode,
      config.sensorConfig,
      basePosition
    );

    this.droneController = AdapterFactory.createDroneController(
      this.simMode,
      this.world  // INTERNAL 모드에서만 사용
    );
  }

  private async tick(): Promise<void> {
    // 센서 스캔 (추상화된 인터페이스 사용)
    const radarDetections = await this.sensorProvider.scanRadar(
      this.world.time,
      await this.droneController.getAllDroneStates()
    );

    // 드론 업데이트 (추상화된 인터페이스 사용)
    for (const [id, drone] of await this.droneController.getAllDroneStates()) {
      // 행동 계산 (공통)
      const command = this.calculateDroneCommand(drone);

      // 제어 명령 전송 (모드별 다름)
      await this.droneController.updateDrone(id, command);
    }
  }
}
```

---

## 5. 구현 로드맵

### Phase 1: 인터페이스 정의 및 리팩토링 (1주)

**목표**: 기존 코드를 어댑터 패턴으로 리팩토링

**작업**:
1. ✅ `ISensorProvider` 인터페이스 정의
2. ✅ `IDroneController` 인터페이스 정의
3. ✅ `InternalSensorProvider` 구현 (기존 센서 래핑)
4. ✅ `InternalDroneController` 구현 (기존 모델 래핑)
5. ✅ `AdapterFactory` 구현
6. ✅ `SimulationEngine` 리팩토링
   - 직접 센서/모델 호출 → 인터페이스 호출
7. ✅ 테스트 (INTERNAL 모드로 기존 기능 정상 작동 확인)

**검증**:
- `SIM_MODE=INTERNAL`로 실행 시 기존과 동일하게 작동
- 모든 기존 테스트 통과

### Phase 2: AirSim Bridge 구현 (1주)

**목표**: Python AirSim Bridge 서버 구현

**작업**:
1. ✅ Python 프로젝트 구조 생성
   ```
   airsim_bridge/
   ├── bridge.py          # 메인 서버
   ├── airsim_wrapper.py  # AirSim API 래핑
   ├── websocket_server.py # WebSocket 서버
   └── requirements.txt
   ```
2. ✅ WebSocket 서버 구현 (JSON-RPC)
3. ✅ AirSim API 래핑
   - `spawnDrone`, `getDroneStates`, `setVelocity`
   - 카메라 이미지 스트리밍
4. ✅ 테스트 (Unreal + AirSim 환경에서)

**검증**:
- AirSim에서 드론 생성/제어 가능
- WebSocket으로 상태 조회 가능

### Phase 3: AirSim Adapter 구현 (1주)

**목표**: Node.js에서 AirSim Bridge 연동

**작업**:
1. ✅ `AirSimBridgeClient` 구현
2. ✅ `AirSimSensorProvider` 구현
   - 레이더: AirSim 위치 → 거리/방위각 계산 + 노이즈
   - EO: AirSim 카메라 → 드론 분류
   - 음향: (옵션) 오디오 시뮬 또는 더미
3. ✅ `AirSimDroneController` 구현
   - 기존 행동 로직 재사용
   - AirSim API로 제어 명령 전송
4. ✅ 통합 테스트

**검증**:
- `SIM_MODE=EXTERNAL_AIRSIM`로 실행
- C2 UI에서 AirSim 드론 탐지/추적 확인

### Phase 4: 요격 드론 PN 유도 연동 (1주)

**목표**: AirSim에서 PN 유도 구현

**작업**:
1. ✅ `PNController` 클래스 (AirSim용)
   - 기존 `guidance.ts` 로직 활용
   - 100ms마다 AirSim API로 가속도 명령
2. ✅ 요격 시퀀스 구현
   - LAUNCHING → PURSUING → INTERCEPT_RAM
3. ✅ 충돌 판정 로직

**검증**:
- AirSim에서 요격 드론이 적 드론 추적
- PN 유도로 정확히 요격

### Phase 5: 센서 노이즈 및 오탐/미탐 모델 적용 (3일)

**목표**: AirSim 센서에 기존 노이즈 모델 적용

**작업**:
1. ✅ `NoiseModel` 클래스 분리
2. ✅ `AirSimSensorProvider`에 노이즈 적용
3. ✅ 오탐/미탐 로직 적용

**검증**:
- AirSim 모드에서도 레이더 노이즈 확인
- 센서 융합 정상 작동

### Phase 6: 문서화 및 최적화 (3일)

**목표**: 사용자 가이드 및 성능 최적화

**작업**:
1. ✅ `AIRSIM_SETUP.md` 작성
   - Unreal Engine 설치
   - AirSim 플러그인 설치
   - 환경 설정
2. ✅ 성능 프로파일링
   - AirSim 동기화 주기 최적화
   - 네트워크 지연 최소화
3. ✅ 예제 시나리오 작성

**검증**:
- 신규 사용자가 문서만으로 설정 가능
- 60 FPS 이상 렌더링 (고사양 PC)

### Phase 7: 선택적 기능 (추가)

**고급 기능**:
1. ⭕ ROS 연동 (AirSim → ROS → C2)
2. ⭕ 멀티플레이어 (여러 C2 UI가 동일 AirSim 관찰)
3. ⭕ VR 지원 (Unreal VR 플러그인)
4. ⭕ AI 적 드론 (Unreal Behavior Tree)

---

## 6. 예상 이슈 및 해결 방안

### 이슈 1: AirSim 동기화 지연

**문제**: AirSim API 호출이 느려서 100ms 틱을 맞추기 어려움

**해결**:
- WebSocket 대신 gRPC 사용 (더 빠름)
- 비동기 처리 (Promise.all로 병렬 호출)
- 동기화 주기를 200ms로 완화

### 이슈 2: 드론 수 제한

**문제**: Unreal Engine 성능 한계로 드론 수 제한

**해결**:
- LOD (Level of Detail) 적용
- 멀리 있는 드론은 저해상도 모델
- 최대 20대로 제한

### 이슈 3: 센서 시뮬레이션 정확도

**문제**: AirSim의 센서가 실제와 다를 수 있음

**해결**:
- AirSim 센서 파라미터 튜닝
- 기존 노이즈 모델로 보정
- 실험 데이터로 검증

### 이슈 4: 크로스 플랫폼 호환성

**문제**: Unreal Engine이 Windows/Linux만 지원

**해결**:
- AirSim은 Windows/Linux에서 실행
- Node.js 서버는 macOS에서도 가능 (원격 연결)
- Docker 컨테이너 제공

---

## 7. 예상 파일 구조 (v3.0)

```
드론지휘통제체계/
├── frontend/              # (변경 없음)
├── simulator/
│   ├── src/
│   │   ├── adapters/      # ✨ 신규
│   │   │   ├── ISensorProvider.ts
│   │   │   ├── IDroneController.ts
│   │   │   ├── InternalSensorProvider.ts
│   │   │   ├── InternalDroneController.ts
│   │   │   ├── AirSimSensorProvider.ts
│   │   │   ├── AirSimDroneController.ts
│   │   │   ├── AirSimBridgeClient.ts
│   │   │   ├── NoiseModel.ts
│   │   │   └── AdapterFactory.ts
│   │   │
│   │   ├── config/
│   │   │   ├── env.ts              # SIM_MODE 추가
│   │   │   └── airsim.ts           # ✨ 신규: AirSim 설정
│   │   │
│   │   ├── core/          # (변경 없음)
│   │   ├── sensors/       # (INTERNAL 모드에서만 사용)
│   │   ├── models/        # (INTERNAL 모드에서만 사용)
│   │   ├── websocket/     # (변경 없음)
│   │   ├── simulation.ts  # 리팩토링
│   │   └── ...
│   │
│   └── package.json       # airsim-client 패키지 추가
│
├── airsim_bridge/         # ✨ 신규 Python 프로젝트
│   ├── bridge.py
│   ├── airsim_wrapper.py
│   ├── websocket_server.py
│   ├── camera_handler.py
│   ├── requirements.txt
│   └── README.md
│
├── unreal_project/        # ✨ 신규 Unreal 프로젝트 (옵션)
│   ├── Content/
│   ├── Source/
│   └── ...
│
├── docs/
│   ├── AIRSIM_SETUP.md    # ✨ 신규
│   ├── AIRSIM_INTEGRATION_DESIGN.md  # 이 문서
│   └── ...
│
└── README.md              # v3.0 업데이트
```

---

## 8. 결론

### 주요 설계 원칙

1. **Adapter Pattern**: 센서/제어 로직을 추상화하여 모드 전환 용이
2. **Bridge Pattern**: AirSim과의 통신을 별도 계층으로 분리
3. **Strategy Pattern**: 모드별 다른 구현체를 런타임에 선택
4. **Minimal Change**: 기존 코드(센서 융합, 교전 관리 등) 최대한 재사용

### 핵심 장점

- ✅ **기존 기능 보존**: INTERNAL 모드로 기존 시뮬레이션 유지
- ✅ **점진적 마이그레이션**: Phase별로 단계적 구현
- ✅ **재사용성**: 센서 융합, 위협 평가 등 공통 로직 100% 재사용
- ✅ **확장성**: 향후 다른 시뮬레이터(Gazebo, Webots) 연동 가능
- ✅ **유지보수성**: 인터페이스 기반으로 테스트/디버깅 용이

### 다음 단계

**즉시 시작 가능**:
1. Phase 1 착수 (인터페이스 정의 및 리팩토링)
2. AirSim 환경 구축 (Unreal Engine + AirSim 플러그인 설치)
3. 간단한 PoC (Proof of Concept) 구현

**질문 또는 코드 구현을 시작하려면 말씀해주세요!**

---

**작성**: Claude Code
**문서 버전**: 1.0
**마지막 업데이트**: 2025-12-05
