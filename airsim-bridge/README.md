# AirSim Bridge

Node.js 시뮬레이터와 AirSim(Unreal Engine) 간의 통신 브리지

## 개요

AirSim Bridge는 Python으로 작성된 WebSocket 서버로, Node.js 기반 드론 시뮬레이터와 Unreal Engine의 AirSim 플러그인 간의 통신을 중계합니다.

### 아키텍처

```
┌─────────────────────┐      WebSocket       ┌──────────────────┐      Python API      ┌─────────────────┐
│  Node.js Simulator  │ ◄──────────────────► │  AirSim Bridge   │ ◄──────────────────► │  AirSim/Unreal  │
│  (TypeScript)       │   JSON-RPC 2.0       │  (Python)        │   airsim.Client      │  (C++)          │
└─────────────────────┘                       └──────────────────┘                       └─────────────────┘
```

### 주요 기능

- **드론 제어**: 적 드론 및 요격 드론 생성, 이동, 제거
- **센서 시뮬레이션**: 레이더, 음향, EO 카메라 센서 데이터 생성
- **실시간 통신**: WebSocket을 통한 실시간 양방향 통신
- **JSON-RPC 2.0**: 표준 RPC 프로토콜 사용

## 설치

### 1. Python 환경 설정

```bash
cd airsim-bridge
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. AirSim 설치

Unreal Engine에 AirSim 플러그인을 설치해야 합니다:
- [AirSim 공식 설치 가이드](https://microsoft.github.io/AirSim/build_windows/)

### 3. Unreal Engine 프로젝트 설정

AirSim 설정 파일 (`~/Documents/AirSim/settings.json`):

```json
{
  "SettingsVersion": 1.2,
  "SimMode": "Multirotor",
  "ClockSpeed": 1,
  "Vehicles": {
    "hostile_1": {
      "VehicleType": "SimpleFlight",
      "X": 0, "Y": 0, "Z": 0
    },
    "interceptor_1": {
      "VehicleType": "SimpleFlight",
      "X": 0, "Y": 0, "Z": 0
    }
  }
}
```

## 사용법

### 1. Unreal Engine 실행

1. AirSim 플러그인이 설치된 Unreal Engine 프로젝트 실행
2. Play 버튼을 눌러 시뮬레이션 시작

### 2. AirSim Bridge 서버 시작

```bash
cd airsim-bridge
source venv/bin/activate
python src/bridge_server.py
```

출력 예시:
```
[2025-01-XX XX:XX:XX] INFO - AirSim 브리지 서버 시작 중... 0.0.0.0:9000
[2025-01-XX XX:XX:XX] INFO - AirSim 연결 성공
[2025-01-XX XX:XX:XX] INFO - WebSocket 서버 시작 완료: ws://0.0.0.0:9000
```

### 3. Node.js 시뮬레이터 설정

`.env` 파일에서 AirSim 모드 활성화:

```bash
# 시뮬레이션 모드
SIM_MODE=EXTERNAL_AIRSIM

# AirSim 브리지 설정
AIRSIM_BRIDGE_URL=ws://localhost:9000
AIRSIM_SYNC_INTERVAL=100
AIRSIM_ENABLE_RENDERING=true
```

### 4. Node.js 시뮬레이터 실행

```bash
cd ../simulator
npm run dev
```

## API 문서

### JSON-RPC 2.0 메서드

모든 요청은 다음 형식을 따릅니다:

```json
{
  "jsonrpc": "2.0",
  "method": "methodName",
  "params": { ... },
  "id": 1
}
```

응답:

```json
{
  "jsonrpc": "2.0",
  "result": { ... },
  "id": 1
}
```

### 드론 제어 메서드

#### spawnDrone

드론 생성

**요청**:
```json
{
  "method": "spawnDrone",
  "params": {
    "droneId": "hostile_1",
    "type": "hostile" | "interceptor",
    "position": { "x": 0, "y": 0, "z": 100 },
    "velocity": { "x": 10, "y": 0, "z": 0 },
    "config": { ... }
  }
}
```

**응답**:
```json
{
  "result": {
    "success": true,
    "droneId": "hostile_1",
    "vehicleName": "hostile_hostile_1"
  }
}
```

#### removeDrone

드론 제거

**요청**:
```json
{
  "method": "removeDrone",
  "params": {
    "droneId": "hostile_1"
  }
}
```

#### updateDrone

드론 상태 업데이트

**요청**:
```json
{
  "method": "updateDrone",
  "params": {
    "droneId": "hostile_1",
    "position": { "x": 100, "y": 50, "z": 100 },
    "velocity": { "x": 15, "y": 5, "z": 0 }
  }
}
```

#### getDroneState

드론 상태 조회

**요청**:
```json
{
  "method": "getDroneState",
  "params": {
    "droneId": "hostile_1"
  }
}
```

**응답**:
```json
{
  "result": {
    "success": true,
    "state": {
      "position": { "x": 100, "y": 50, "z": 100 },
      "velocity": { "x": 15, "y": 5, "z": 0 }
    }
  }
}
```

### 센서 메서드

#### scanRadar

레이더 스캔

**요청**:
```json
{
  "method": "scanRadar",
  "params": {
    "currentTime": 123.45,
    "droneIds": ["hostile_1", "hostile_2"]
  }
}
```

**응답**:
```json
{
  "result": {
    "success": true,
    "detections": [
      {
        "timestamp": 123.45,
        "track_id": "Thostile_1",
        "position": { "x": 100, "y": 50, "z": 100 },
        "radial_distance": 111.8,
        "azimuth": 26.57,
        "sensor_type": "radar"
      }
    ]
  }
}
```

#### detectAudio

음향 탐지

**요청**:
```json
{
  "method": "detectAudio",
  "params": {
    "currentTime": 123.45,
    "droneIds": ["hostile_1"]
  }
}
```

#### detectEO

EO 카메라 탐지

**요청**:
```json
{
  "method": "detectEO",
  "params": {
    "currentTime": 123.45,
    "droneIds": ["hostile_1"]
  }
}
```

### 유틸리티 메서드

#### ping

연결 상태 확인

**요청**:
```json
{
  "method": "ping",
  "params": {
    "timestamp": 123.45
  }
}
```

**응답**:
```json
{
  "result": {
    "pong": true,
    "timestamp": 123.45
  }
}
```

#### reset

시뮬레이션 리셋

**요청**:
```json
{
  "method": "reset",
  "params": {}
}
```

## 좌표계 변환

AirSim은 NED(North-East-Down) 좌표계를 사용하지만, 시뮬레이터는 ENU(East-North-Up) 좌표계를 사용합니다.

변환:
- **X**: 동일 (동쪽 방향)
- **Y**: 동일 (북쪽 방향)
- **Z**: 부호 반전 (AirSim: Down, 시뮬레이터: Up)

```python
# ENU → NED
airsim_z = -simulator_z

# NED → ENU
simulator_z = -airsim_z
```

## 트러블슈팅

### AirSim 연결 실패

**문제**: `AirSim 연결 실패 - Unreal Engine이 실행 중인지 확인하세요`

**해결**:
1. Unreal Engine이 실행 중인지 확인
2. AirSim 플러그인이 활성화되어 있는지 확인
3. Play 버튼을 눌러 시뮬레이션이 시작되었는지 확인

### WebSocket 연결 오류

**문제**: Node.js에서 `AirSim 브리지가 연결되지 않음` 오류

**해결**:
1. Bridge 서버가 실행 중인지 확인
2. 포트 9000이 사용 가능한지 확인
3. 방화벽 설정 확인

### 드론 스폰 실패

**문제**: `spawnDrone` 호출 시 오류

**해결**:
1. `settings.json`에 충분한 vehicle 슬롯이 있는지 확인
2. 동일한 droneId로 중복 생성하지 않았는지 확인

## 개발

### 프로젝트 구조

```
airsim-bridge/
├── src/
│   ├── bridge_server.py    # WebSocket 서버 및 JSON-RPC 핸들러
│   └── airsim_wrapper.py   # AirSim Python API 래퍼
├── requirements.txt        # Python 의존성
└── README.md              # 이 문서
```

### 테스트

Python 유닛 테스트 (향후 추가 예정):

```bash
python -m pytest tests/
```

## 라이선스

MIT License
