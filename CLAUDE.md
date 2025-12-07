# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Counter-Drone Command & Control (C2) Simulator for small unit operations. The system simulates hostile drones, interceptor drones, multi-sensor detection (radar, acoustic, EO camera), sensor fusion, threat assessment, and engagement management.

**Key Architecture**: The project uses a **monorepo structure** with three main components that communicate via WebSocket:
1. **Simulator Server** (Node.js/TypeScript) - Physics engine, sensor models, drone behaviors
2. **C2 UI Frontend** (React/TypeScript) - Command & Control interface
3. **AirSim Bridge** (Python) - Optional 3D visualization via Unreal Engine

**Critical Design Pattern**: The simulator implements an **Adapter Pattern** to support two simulation modes:
- `INTERNAL`: Fast 2D simulation (no external dependencies)
- `EXTERNAL_AIRSIM`: 3D simulation via Unreal Engine + AirSim

## Development Commands

### Simulator Server (Node.js)
```bash
cd simulator

# Development (hot reload)
npm run dev

# Build TypeScript
npm run build

# Production
npm start

# Testing
npm test
npm run test:watch
npm run test:coverage
```

### Frontend (React)
```bash
cd frontend

npm run dev      # Development server (localhost:3000)
npm run build    # Production build
```

### AirSim Bridge (Python)
```bash
cd airsim-bridge

# Setup
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run bridge server
python src/bridge_server.py
```

### Evaluation & Analysis
```bash
cd simulator

# Run classification performance evaluation
npm run eval              # Fast profile (default)
npm run eval:fast         # Fast profile (2 scenarios, 3 runs each)
npm run eval:full         # Full profile (3 scenarios, 20 runs each)

# Generate performance report
cd ../analysis
python scripts/generate_report.py --full
```

### Auto-Tuning
```bash
cd analysis

# Fast tuning (parameter exploration)
python auto_tune.py --trials 30 --profile fast

# Full tuning (final verification)
python auto_tune.py --trials 5 --profile full
```

## High-Level Architecture

### 1. Adapter Pattern for Dual Simulation Modes

**Location**: `simulator/src/adapters/`

The simulator abstracts sensor and drone control through two interfaces:

**ISensorProvider** (`adapters/ISensorProvider.ts`):
- Abstracts sensor data collection (radar, acoustic, EO camera)
- Implementations:
  - `InternalSensorProvider`: Uses built-in 2D sensor models
  - `AirSimSensorProvider`: Fetches data from AirSim via WebSocket

**IDroneController** (`adapters/IDroneController.ts`):
- Abstracts drone lifecycle (spawn, update, control, remove)
- Implementations:
  - `InternalDroneController`: Manages 2D drone physics directly
  - `AirSimDroneController`: Controls 3D drones in Unreal Engine via WebSocket

**AdapterFactory** (`adapters/AdapterFactory.ts`):
- Creates appropriate implementation based on `SIM_MODE` environment variable
- Handles dependency injection for `SimulationEngine`

**Why this matters**: When adding new sensor types or drone capabilities, you must implement them in BOTH adapters (Internal and AirSim) to maintain parity between simulation modes.

### 2. WebSocket Communication Architecture

**Three separate WebSocket connections**:

1. **Simulator ↔ C2 UI** (`simulator/src/websocket/server.ts` ↔ `frontend/src/hooks/useWebSocket.ts`)
   - Port: 8080
   - Protocol: Custom JSON events (not JSON-RPC)
   - Events: `radar_detection`, `drone_state_update`, `interceptor_update`, etc.

2. **Simulator ↔ Audio Model** (Python client connects to simulator)
   - Port: 8080
   - Protocol: Custom JSON events
   - Events: `audio_detection`

3. **Simulator ↔ AirSim Bridge** (`simulator/src/adapters/AirSim*.ts` ↔ `airsim-bridge/src/bridge_server.py`)
   - Port: 9000
   - Protocol: **JSON-RPC 2.0** (important!)
   - Methods: `spawnDrone`, `scanRadar`, `getDroneState`, etc.

**Critical distinction**: The AirSim bridge uses JSON-RPC 2.0 (with `jsonrpc`, `method`, `params`, `id` fields), while the main simulator WebSocket uses plain event objects.

### 3. Shared Type System

**Location**: `shared/schemas.ts`

This file defines ALL types shared between simulator, frontend, and audio model:
- Event types (`RadarDetectionEvent`, `DroneStateUpdateEvent`, etc.)
- Configuration types (`RadarConfig`, `InterceptorConfig`, etc.)
- Enums (`HostileDroneBehavior`, `InterceptorState`, `GuidanceMode`, etc.)

**Important**: There are TWO versions of some event types:
- **Client-facing** (`shared/schemas.ts`): Minimal fields for WebSocket transmission
- **Internal logging** (`simulator/src/core/logging/eventSchemas.ts`): Extended fields for JSONL logs (includes `is_first_detection`, `sensor`, etc.)

The adapters use the internal version since they're part of the simulation core, not the client interface.

### 4. Sensor Fusion & Threat Assessment Pipeline

**Data flow** (`simulator/src/simulation.ts`):

```
Raw Sensor Data (radar/audio/EO)
    ↓
SensorFusion (simulator/src/core/fusion.ts)
    - Track association
    - Kalman filtering
    - Classification fusion
    ↓
Fused Tracks (with classification probabilities)
    ↓
Threat Assessment (simulator/src/core/threatAssessment.ts)
    - Multi-factor scoring (distance, velocity, behavior, payload, size)
    - Weighted combination → threat_score (0-100)
    ↓
Engagement Manager (simulator/src/core/engagement.ts)
    - Auto-engage if enabled + score > threshold
    - Manual engage via C2 UI
    ↓
Interceptor Launch
```

**Tunable parameters** (`simulator/config/runtime_params.json`):
- `threat_engage_threshold`: Auto-engage threshold
- `civil_conf_threshold`: Confidence threshold for CIVIL classification
- `pn_nav_constant`: Proportional Navigation guidance constant
- Fusion weights, sensor detection probabilities, etc.

These parameters can be automatically optimized using the auto-tuning pipeline.

### 5. JSONL Logging System

**Location**: `simulator/src/core/logging/logger.ts`

ALL simulation events are automatically logged to JSONL files:
- Path: `simulator/logs/{scenario_id}_{timestamp}.jsonl`
- Each line is a complete JSON object
- Includes scenario metadata, sensor detections, manual actions, engagement results

**Event schemas** (`simulator/src/core/logging/eventSchemas.ts`):
- `ScenarioStartLogEvent`: Initial config and parameters
- `DroneSpawnedLogEvent`: Drone creation with ground truth label
- `RadarDetectionEvent`, `AudioDetectionEvent`, `EODetectionEvent`
- `ManualActionLogEvent`: User clicks in C2 UI
- `EngageCommandLogEvent`, `InterceptResultLogEvent`
- `ScenarioEndLogEvent`: Summary statistics

These logs are consumed by the evaluation pipeline to compute classification metrics (accuracy, precision, recall, F1, FP rate, FN rate).

### 6. Environment Variable Validation

**Location**: `simulator/src/config/env.ts`

Uses **Zod schemas** to validate ALL environment variables at server startup:
- Type checking (string, number, boolean, enum)
- Range validation
- URL format validation
- Default values

**Critical**: If validation fails, the server will NOT start. This prevents misconfiguration.

**Security settings** (`.env`):
- `AUTH_ENABLED`, `AUTH_TOKEN`: Token-based authentication
- `CORS_ENABLED`, `CORS_ORIGIN`: Cross-origin restrictions
- `RATE_LIMIT_ENABLED`, `RATE_LIMIT_MAX_REQUESTS`: DoS prevention
- `SIM_MODE`: `INTERNAL` or `EXTERNAL_AIRSIM`
- `AIRSIM_BRIDGE_URL`: WebSocket URL for AirSim bridge

### 7. Scenario System

**Two types of scenarios**:

1. **Static scenarios** (`simulator/scenarios/*.json`):
   - Manually crafted test cases
   - Version controlled

2. **Generated scenarios** (`simulator/scenarios/generated/*.json`):
   - Created by `simulator/src/core/scenario/generator.ts`
   - Random parameters with seed support
   - Used for batch evaluation
   - NOT version controlled (in `.gitignore`)

**Generator parameters**:
- Drone count: 1-15
- Hostile ratio: 30-100%
- Behavior distribution: direct_attack, recon_loiter, evasive, random_walk
- Radar noise: σ = 5-20m (radial), 1-5° (azimuth)
- False alarm rate: 0.5-3%
- Miss probability: 3-15%

### 8. Evaluation & Auto-Tuning System

**Two-stage pipeline**:

**Stage 1: Evaluation** (`simulator/src/scripts/run_evaluation_experiments.ts`):
- Runs multiple scenarios × modes × repetitions
- Saves JSONL logs to `simulator/logs/eval_{profile}/{mode}/{experiment_name}/run_{i}.jsonl`
- Profiles: `fast` (quick testing) vs `full` (publication-quality)

**Stage 2: Analysis** (`analysis/scripts/eval_classification_report.py`):
- Parses JSONL logs
- Computes classification metrics (accuracy, precision, recall, F1, FP/FN rates)
- Generates `analysis/results/classification_summary.md`

**Auto-tuning** (`analysis/auto_tune.py`):
- Random search over parameter space (defined in `analysis/auto_tuning_config.py`)
- Each trial: sample parameters → inject to `runtime_params.json` → run evaluation → compute objective score
- Best parameters saved to `analysis/results/auto_tune_best_config.json`
- Objective function optimizes HOSTILE F1 score while penalizing CIVIL false positives

## Code Organization Principles

### When to modify Adapters vs Core Simulation

**Modify Adapters** when:
- Adding new drone control capabilities (spawn, command, etc.)
- Adding new sensor types or sensor configurations
- Changing coordinate systems or unit conversions
- Implementing AirSim-specific features (cameras, LiDAR, etc.)

**Modify Core Simulation** when:
- Changing threat assessment logic
- Updating sensor fusion algorithms
- Modifying engagement rules
- Adding new event types to JSONL logs
- Changing drone behavior models

### Type Synchronization

When adding new event types or changing existing ones:
1. Define in `shared/schemas.ts` (client-facing)
2. If needed for logging, extend in `simulator/src/core/logging/eventSchemas.ts`
3. Update frontend types in `frontend/src/types/index.ts` (usually re-exported from shared)
4. Add logging calls in `simulator/src/simulation.ts`
5. Update WebSocket handlers in both simulator and frontend

### Adding New Tunable Parameters

1. Add to `ParamSpace` in `analysis/auto_tuning_config.py` (define search range)
2. Add to `RuntimeParams` interface in `simulator/src/config.ts`
3. Add to `loadRuntimeParams()` in `simulator/src/config.ts`
4. Use the parameter in simulation code (threat assessment, fusion, guidance, etc.)
5. Test with auto-tuning: `python auto_tune.py --trials 30 --profile fast`

## Common Pitfalls

1. **AudioDetectionEvent type mismatch**: There are TWO versions. Use the internal version (`core/logging/eventSchemas`) in adapters, not the shared version.

2. **Coordinate systems**: AirSim uses NED (North-East-Down), simulator uses ENU (East-North-Up). The bridge handles conversion, but be careful when debugging positions.

3. **InterceptorState vs status**: The type is `InterceptorState` (uppercase enum like `'STANDBY'`, `'LAUNCHING'`), not lowercase strings. See `shared/schemas.ts` for valid values.

4. **Velocity3D fields**: `{vx, vy, climbRate}` NOT `{x, y, z}`. See `simulator/src/types.ts`.

5. **Async adapter methods**: ALL adapter methods are `async` even if the internal implementation is synchronous. This enables future network calls without breaking the interface.

6. **Runtime params vs environment variables**: Runtime params (`runtime_params.json`) override defaults and are used by auto-tuning. Environment variables (`.env`) control server settings like ports, auth, CORS.

7. **Generated scenarios in git**: The `simulator/scenarios/generated/` directory should be in `.gitignore`. Only commit static scenarios.

## Testing & Verification

### Quick smoke test
```bash
# Terminal 1: Start simulator
cd simulator && npm run dev

# Terminal 2: Start frontend
cd frontend && npm run dev

# Browser: Open http://localhost:3000
# - Should auto-connect to ws://localhost:8080
# - Click "Start" → drones should appear
# - Radar should scan
# - Click a drone → "Engage" button should appear
```

### AirSim integration test
```bash
# 1. Start Unreal Engine + AirSim
# 2. Start Python bridge
cd airsim-bridge && python src/bridge_server.py

# 3. Set environment
cd simulator
echo "SIM_MODE=EXTERNAL_AIRSIM" >> .env

# 4. Start simulator
npm run dev

# Should see: "[AirSimSensorProvider] 브리지 연결 성공"
```

### Evaluation test
```bash
cd simulator
npm run eval:fast  # Should complete in ~10-20 minutes

cd ../analysis
python scripts/generate_report.py
# Check: analysis/results/classification_summary.md should exist
```

## Documentation References

- **README.md**: User guide, feature overview, installation
- **SECURITY.md**: Security features, authentication, CORS, rate limiting
- **AIRSIM_INTEGRATION_DESIGN.md**: Original design doc for AirSim integration
- **AIRSIM_INTEGRATION_COMPLETE.md**: Implementation details and usage
- **airsim-bridge/README.md**: AirSim bridge API documentation, JSON-RPC methods
