# PX4 SITL Bridge

PX4 SITL ↔ Anti-Drone C2 Server 통신 브리지

## 개요

이 브리지는 PX4 Autopilot (SITL 또는 실기체)와 Node.js 기반 C2 서버를 WebSocket으로 연결합니다.
기존 AirSim 브리지와 동일한 메시지 포맷을 사용하므로 C2 서버 코드 수정 없이 사용 가능합니다.

## 특징

✅ **PX4 SITL 및 실기체 지원**
- SITL: `udp://:14540`, `udp://:14541`, ...
- 실기체: `serial:///dev/ttyUSB0:57600`, `serial:///dev/ttyACM0:115200`

✅ **기존 C2 서버 호환**
- AirSim 브리지와 동일한 WebSocket 프로토콜
- ENU 좌표계 사용 (C2 서버 기준)
- 메시지 타입 호환 (`drone_state_update`, `radar_detection`, etc.)

✅ **다중 드론 지원**
- 적 드론 (hostile) + 요격 드론 (interceptor) 동시 제어
- 각 드론별 독립적인 MAVLink 연결

✅ **설정 파일 기반**
- `config.yaml`로 모든 연결 설정 관리
- SITL ↔ 실기체 전환 용이

## 설치

### 1. Python 환경 설정

```bash
cd ~/anti-drone-dev/sim_bridge
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. PX4 SITL 설정 (시뮬레이션용)

```bash
cd ~/anti-drone-dev

# PX4 클론 (아직 없는 경우)
git clone https://github.com/PX4/PX4-Autopilot.git px4
cd px4

# 빌드
make px4_sitl gazebo

# SITL 실행 (여러 드론 띄우기)
# Terminal 1: Hostile drone 1
PX4_SIM_MODEL=iris PX4_SYS_AUTOSTART=4001 \
    ./build/px4_sitl_default/bin/px4 -i 0

# Terminal 2: Hostile drone 2
PX4_SIM_MODEL=iris PX4_SYS_AUTOSTART=4001 \
    ./build/px4_sitl_default/bin/px4 -i 1

# Terminal 3: Interceptor drone 1
PX4_SIM_MODEL=iris PX4_SYS_AUTOSTART=4001 \
    ./build/px4_sitl_default/bin/px4 -i 10
```

**참고**: `-i 0`은 MAVLink 포트 14540, `-i 1`은 14541, `-i 10`은 14550 사용

### 3. Gazebo 실행 (시각화)

```bash
# Gazebo 실행 (별도 터미널)
gazebo ~/anti-drone-dev/px4/Tools/simulation/gazebo/sitl_gazebo/worlds/empty.world
```

## 사용법

### 1. 설정 파일 수정

`config.yaml`에서 드론 연결 설정:

```yaml
px4_connections:
  - id: "hostile_1"
    connection_string: "udp://:14540"  # SITL instance 0
    role: "hostile"
    auto_arm: true

  - id: "interceptor_1"
    connection_string: "udp://:14550"  # SITL instance 10
    role: "interceptor"
    auto_arm: false
```

**실기체 사용 시**:
```yaml
px4_connections:
  - id: "interceptor_real_1"
    connection_string: "serial:///dev/ttyUSB0:57600"
    role: "interceptor"
    auto_arm: false
```

### 2. C2 서버 실행

```bash
# Node.js C2 서버 실행 (별도 터미널)
cd /Users/donghyeok/드론지휘통제체계/simulator
npm run dev
```

### 3. 브리지 실행

```bash
cd ~/anti-drone-dev/sim_bridge
source venv/bin/activate
python main.py --config config.yaml
```

예상 출력:
```
[2025-01-XX XX:XX:XX] INFO     main     Initializing PX4 connections...
[2025-01-XX XX:XX:XX] INFO     px4_adapter  [hostile_1] Connecting to udp://:14540
[2025-01-XX XX:XX:XX] INFO     px4_adapter  [hostile_1] Drone connected!
[2025-01-XX XX:XX:XX] INFO     main     ✓ Connected to hostile_1 (hostile)
[2025-01-XX XX:XX:XX] INFO     websocket_client  Connecting to C2 server: ws://localhost:8080
[2025-01-XX XX:XX:XX] INFO     websocket_client  Connected to C2 server
[2025-01-XX XX:XX:XX] INFO     main     ✓ All systems connected. Bridge running.
```

### 4. 프론트엔드 실행

```bash
# React C2 UI 실행 (별도 터미널)
cd /Users/donghyeok/드론지휘통제체계/frontend
npm run dev

# 브라우저에서 http://localhost:3000 열기
# - 드론이 맵에 나타남
# - 레이더 스캔 확인
# - 교전 명령 가능
```

## 아키텍처

```
┌─────────────────┐
│   PX4 SITL #1   │ udp://:14540
│   (hostile_1)   │
└────────┬────────┘
         │ MAVLink
         │
┌────────▼────────┐     WebSocket      ┌─────────────────┐
│  PX4 Adapter    │ ◄─────────────────►│  C2 Server      │
│  (MAVSDK)       │   JSON Messages    │  (Node.js)      │
└────────┬────────┘                     └────────┬────────┘
         │                                       │
┌────────▼────────┐                     ┌───────▼────────┐
│  Message Mapper │                     │   C2 UI        │
│  (GPS ↔ ENU)   │                     │   (React)      │
└─────────────────┘                     └────────────────┘
```

## 메시지 포맷

### C2 Server → Bridge (Commands)

```json
// 교전 명령
{
  "type": "engage_command",
  "drone_id": "interceptor_1",
  "target_id": "hostile_1",
  "method": "ram"
}

// 이동 명령
{
  "type": "move_command",
  "drone_id": "hostile_1",
  "position": {"x": 100, "y": 200, "z": 50}
}

// RTL 명령
{
  "type": "rtl_command",
  "drone_id": "interceptor_1"
}
```

### Bridge → C2 Server (Telemetry)

```json
// 드론 상태
{
  "type": "drone_state_update",
  "drone_id": "hostile_1",
  "position": {"x": 150, "y": 250, "z": 45},
  "velocity": {"vx": 10, "vy": 5, "vz": 0},
  "armed": true,
  "in_air": true,
  "battery": 87.5,
  "role": "hostile",
  "timestamp": 1234567890.123
}

// 레이더 탐지 (시뮬레이션)
{
  "type": "radar_detection",
  "drone_id": "hostile_1",
  "range": 283.5,
  "bearing": 45.2,
  "altitude": 48.3,
  "confidence": 0.85,
  "sensor_type": "radar",
  "timestamp": 1234567890.123
}
```

## 좌표계 변환

- **PX4**: GPS (위도/경도/고도) + NED 속도 (North-East-Down)
- **C2 Server**: ENU 로컬 좌표 (East-North-Up, 기지 기준 상대 위치)

**변환**:
- GPS → ENU: 평면 근사 (10km 이내)
- NED 속도 → ENU 속도: 축 회전

기지 위치는 `config.yaml`의 `base_position`에서 설정.

## 트러블슈팅

### PX4 연결 실패

**문제**: `[hostile_1] Connection failed: ...`

**해결**:
1. PX4 SITL이 실행 중인지 확인
2. 포트 번호 확인 (`-i 0` → 14540, `-i 1` → 14541)
3. 방화벽 확인
4. `netstat -an | grep 14540` 으로 포트 리스닝 확인

### C2 서버 연결 안됨

**문제**: `Connection failed: [Errno 111] Connection refused`

**해결**:
1. C2 서버가 실행 중인지 확인 (`npm run dev`)
2. 포트 8080 확인
3. `config.yaml`의 `c2_server.url` 확인

### 드론이 맵에 안 보임

**문제**: 프론트엔드에서 드론이 표시되지 않음

**해결**:
1. 브리지 로그에서 `drone_state_update` 메시지 전송 확인
2. C2 서버 콘솔에서 메시지 수신 확인
3. 브라우저 개발자 도구 → Network → WS 탭 확인

### Gazebo 시각화 안됨

**문제**: Gazebo에서 드론 모델이 안 보임

**해결**:
```bash
# 환경 변수 설정
export GAZEBO_MODEL_PATH=$GAZEBO_MODEL_PATH:~/anti-drone-dev/px4/Tools/simulation/gazebo/sitl_gazebo/models

# Gazebo 재시작
killall gzserver gzclient
gazebo ~/anti-drone-dev/px4/Tools/simulation/gazebo/sitl_gazebo/worlds/iris.world
```

## 실기체 전환

시뮬레이션에서 실기체로 전환 시:

1. **config.yaml 수정**:
```yaml
px4_connections:
  - id: "interceptor_real_1"
    connection_string: "serial:///dev/ttyUSB0:57600"  # 또는 ttyACM0
    role: "interceptor"
    auto_arm: false  # 안전을 위해 수동 arm
```

2. **시리얼 포트 권한**:
```bash
sudo usermod -a -G dialout $USER
# 재로그인 필요
```

3. **안전 확인**:
- 프로펠러 제거 후 테스트
- 실내에서 arm/disarm만 테스트
- GPS fix 확인 (`gpsstatus` 명령)

## 향후 개선 사항

- [ ] YOLO 기반 EO 카메라 인식 통합 (`perception/` 모듈)
- [ ] 요격 드론 자동 추적 알고리즘 구현
- [ ] 다중 기지 지원
- [ ] 실시간 궤적 예측 및 요격 최적화
- [ ] QGroundControl 연동

## 라이선스

MIT License
