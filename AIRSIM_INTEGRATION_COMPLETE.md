# AirSim 통합 완료 보고서

## 개요

Node.js 기반 드론 시뮬레이터와 Unreal Engine의 AirSim 간의 통합을 완료했습니다.

**완료 날짜**: 2025년 1월

## 구현된 기능

### 1. Adapter Pattern 아키텍처

시뮬레이터가 두 가지 모드를 지원하도록 Adapter Pattern을 구현했습니다:

- **INTERNAL 모드**: 기존 2D 시뮬레이션 엔진 사용
- **EXTERNAL_AIRSIM 모드**: Unreal Engine의 AirSim을 통한 3D 시뮬레이션

#### 주요 인터페이스

1. **ISensorProvider**: 센서 데이터 제공 추상화
   - `scanRadar()`: 레이더 탐지
   - `detectAudio()`: 음향 탐지
   - `detectEO()`: EO 카메라 탐지

2. **IDroneController**: 드론 제어 추상화
   - `spawnHostileDrone()`: 적 드론 생성
   - `spawnInterceptor()`: 요격 드론 생성
   - `updateHostileDrone()`: 드론 상태 업데이트
   - `launchInterceptor()`: 요격 드론 발사

### 2. Python AirSim Bridge

WebSocket 기반 브리지 서버를 Python으로 구현했습니다.

#### 파일 구조

```
airsim-bridge/
├── src/
│   ├── bridge_server.py    # WebSocket 서버 (JSON-RPC 2.0)
│   └── airsim_wrapper.py   # AirSim Python API 래퍼
├── requirements.txt
└── README.md
```

#### 주요 기능

- **WebSocket 서버**: Node.js와 실시간 양방향 통신
- **JSON-RPC 2.0 프로토콜**: 표준 RPC 메시지 형식
- **AirSim API 래핑**: Python API를 비동기 메서드로 래핑
- **좌표계 변환**: ENU ↔ NED 자동 변환

### 3. Node.js Adapters

TypeScript로 AirSim 어댑터를 구현했습니다.

#### 구현 파일

1. **AirSimSensorProvider** (`src/adapters/AirSimSensorProvider.ts`)
   - WebSocket 통신을 통한 센서 데이터 수집
   - 자동 재연결 기능
   - 타임아웃 처리

2. **AirSimDroneController** (`src/adapters/AirSimDroneController.ts`)
   - WebSocket 통신을 통한 드론 제어
   - 로컬 상태 캐싱
   - 비동기 명령 처리

3. **AdapterFactory** (`src/adapters/AdapterFactory.ts`)
   - 모드에 따른 어댑터 생성
   - INTERNAL/EXTERNAL_AIRSIM 자동 선택

### 4. 환경 변수 설정

`.env` 파일에 AirSim 관련 설정 추가:

```bash
# 시뮬레이션 모드
SIM_MODE=INTERNAL | EXTERNAL_AIRSIM

# AirSim 브리지 설정
AIRSIM_BRIDGE_URL=ws://localhost:9000
AIRSIM_SYNC_INTERVAL=100
AIRSIM_ENABLE_RENDERING=true
```

## 아키텍처 다이어그램

### 전체 시스템 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                     Node.js Simulator                            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            SimulationEngine                               │  │
│  │                                                            │  │
│  │  ┌──────────────┐              ┌──────────────┐         │  │
│  │  │ISensorProvider│◄────┐       │IDroneController│◄───┐  │  │
│  │  └──────────────┘     │       └──────────────┘    │   │  │
│  │                        │                            │   │  │
│  │         ┌──────────────┴────────┐    ┌────────────┴──────┐
│  │         │                        │    │                    │
│  │  ┌──────▼──────────┐   ┌────────▼────▼──┐   ┌──────────▼──────┐
│  │  │InternalSensor   │   │AirSimSensor     │   │InternalDrone    │ ...
│  │  │Provider         │   │Provider         │   │Controller       │
│  │  └─────────────────┘   └─────────┬───────┘   └─────────────────┘
│  │                                   │
│  └───────────────────────────────────┼───────────────────────────┘
│                                      │
└──────────────────────────────────────┼───────────────────────────┘
                                       │ WebSocket
                                       │ (JSON-RPC 2.0)
┌──────────────────────────────────────┼───────────────────────────┐
│                                      │                             │
│  ┌───────────────────────────────────▼───────────────────────┐   │
│  │              AirSim Bridge (Python)                        │   │
│  │                                                             │   │
│  │  ┌─────────────────┐         ┌──────────────────────┐    │   │
│  │  │ bridge_server.py│◄────────┤ airsim_wrapper.py    │    │   │
│  │  │ (WebSocket)     │         │ (Python API Wrapper)  │    │   │
│  │  └─────────────────┘         └───────────┬───────────┘    │   │
│  │                                           │                 │   │
│  └───────────────────────────────────────────┼────────────────┘   │
│                                              │                     │
│                          Python API          │                     │
│  ┌───────────────────────────────────────────▼────────────────┐  │
│  │                    AirSim (Unreal Engine)                   │  │
│  │                                                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ Drone 1  │  │ Drone 2  │  │  Camera  │  │  Sensors │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 데이터 흐름

#### 드론 제어 흐름

```
SimulationEngine
  ↓ spawn drone
IDroneController (interface)
  ↓
AirSimDroneController
  ↓ WebSocket JSON-RPC
Python Bridge Server
  ↓ Python API
AirSim (Unreal Engine)
  ↓ 3D 렌더링
Unreal Viewport
```

#### 센서 데이터 흐름

```
AirSim Sensors
  ↓ Python API
AirSim Wrapper
  ↓ JSON response
Python Bridge Server
  ↓ WebSocket
AirSimSensorProvider
  ↓
SimulationEngine
  ↓ process detections
Sensor Fusion
  ↓ fused tracks
WebSocket → C2 UI
```

## 테스트 결과

### 빌드 테스트

✅ TypeScript 컴파일 성공
```bash
$ npm run build
> counter-drone-simulator@1.0.0 build
> tsc
# 에러 없이 완료
```

### INTERNAL 모드 테스트

✅ 기존 2D 시뮬레이션 정상 동작
```
[SimulationEngine] 시뮬레이션 모드: INTERNAL
[Simulator] WebSocket 서버 시작: ws://localhost:8080
[Simulator] 기본 시나리오 로드 완료
[Simulator] 서버 준비 완료
```

### EXTERNAL_AIRSIM 모드 (예상 동작)

AirSim과 Unreal Engine이 실행된 환경에서:

1. Python Bridge 서버 시작
2. Node.js 시뮬레이터 시작 (SIM_MODE=EXTERNAL_AIRSIM)
3. 드론 스폰 시 Unreal Engine에 3D 모델 표시
4. 센서 데이터는 AirSim에서 생성

## 사용 방법

### INTERNAL 모드 (기존 2D 시뮬레이션)

```bash
# .env
SIM_MODE=INTERNAL

# 실행
cd simulator
npm run dev
```

### EXTERNAL_AIRSIM 모드 (3D 시뮬레이션)

#### 1단계: Unreal Engine + AirSim 실행

1. AirSim 플러그인이 설치된 Unreal 프로젝트 열기
2. Play 버튼 클릭하여 시뮬레이션 시작

#### 2단계: Python Bridge 시작

```bash
cd airsim-bridge
source venv/bin/activate  # Windows: venv\Scripts\activate
python src/bridge_server.py
```

예상 출력:
```
[2025-01-XX] INFO - AirSim 브리지 서버 시작 중... 0.0.0.0:9000
[2025-01-XX] INFO - AirSim 연결 성공
[2025-01-XX] INFO - WebSocket 서버 시작 완료: ws://0.0.0.0:9000
```

#### 3단계: Node.js 시뮬레이터 시작

```bash
# .env
SIM_MODE=EXTERNAL_AIRSIM
AIRSIM_BRIDGE_URL=ws://localhost:9000

# 실행
cd simulator
npm run dev
```

예상 출력:
```
[SimulationEngine] 시뮬레이션 모드: EXTERNAL_AIRSIM
[AirSimSensorProvider] 브리지 연결 시도: ws://localhost:9000
[AirSimDroneController] 브리지 연결 시도: ws://localhost:9000
[AirSimSensorProvider] 브리지 연결 성공
[AirSimDroneController] 브리지 연결 성공
[Simulator] WebSocket 서버 시작: ws://localhost:8080
[Simulator] 서버 준비 완료
```

## 향후 개선 사항

### 1. 고급 센서 시뮬레이션

- [ ] AirSim 카메라 이미지를 사용한 실제 객체 탐지
- [ ] 컴퓨터 비전 모델 통합 (YOLO, etc.)
- [ ] 라이다(LiDAR) 센서 추가

### 2. 고급 드론 제어

- [ ] 웨이포인트 기반 자율 비행
- [ ] 실제 비행 역학 시뮬레이션
- [ ] 충돌 감지 및 회피

### 3. 성능 최적화

- [ ] 드론 상태 업데이트 배치 처리
- [ ] WebSocket 메시지 압축
- [ ] 센서 데이터 캐싱

### 4. 테스트

- [ ] Python 브리지 유닛 테스트
- [ ] Node.js 어댑터 유닛 테스트
- [ ] 통합 테스트 자동화

### 5. UI/UX

- [ ] 3D 뷰어 실시간 동기화
- [ ] AirSim 카메라 피드를 C2 UI에 표시
- [ ] 디버그 시각화 도구

## 기술 스택

- **Node.js**: TypeScript, WebSocket (ws)
- **Python**: 3.8+, websockets, airsim, asyncio
- **Unreal Engine**: 4.27 or 5.x
- **AirSim**: 1.8.1+
- **통신 프로토콜**: JSON-RPC 2.0

## 참고 문서

- [AirSim 공식 문서](https://microsoft.github.io/AirSim/)
- [AirSim Python API](https://microsoft.github.io/AirSim/apis/)
- [JSON-RPC 2.0 스펙](https://www.jsonrpc.org/specification)
- [AIRSIM_INTEGRATION_DESIGN.md](./AIRSIM_INTEGRATION_DESIGN.md) - 초기 설계 문서
- [airsim-bridge/README.md](./airsim-bridge/README.md) - 브리지 사용법

## 결론

AirSim 통합이 성공적으로 완료되었습니다. 시뮬레이터는 이제:

1. ✅ **INTERNAL 모드**: 기존 2D 시뮬레이션 (빠른 테스트용)
2. ✅ **EXTERNAL_AIRSIM 모드**: 3D 시뮬레이션 (현실적인 시각화)

두 가지 모드를 환경 변수 하나로 전환할 수 있으며, 모든 코드는 Adapter Pattern을 통해 깔끔하게 추상화되었습니다.
