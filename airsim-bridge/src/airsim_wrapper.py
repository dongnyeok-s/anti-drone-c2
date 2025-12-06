"""
AirSim API Wrapper

AirSim Python API를 사용하여 드론 제어 및 센서 시뮬레이션
"""

import airsim
import asyncio
import logging
import numpy as np
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


class AirSimWrapper:
    """AirSim Python API 래퍼"""

    def __init__(self):
        self.client: Optional[airsim.MultirotorClient] = None
        self.spawned_drones: Dict[str, str] = {}  # droneId -> vehicle_name
        self.base_position = {'x': 0, 'y': 0, 'z': 0}

    async def connect(self) -> bool:
        """AirSim 연결"""
        try:
            self.client = airsim.MultirotorClient()
            self.client.confirmConnection()
            logger.info("AirSim 연결 성공")
            return True
        except Exception as e:
            logger.error(f"AirSim 연결 실패: {e}")
            return False

    async def spawn_drone(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """드론 생성

        Args:
            params: {
                droneId: string,
                type: 'hostile' | 'interceptor',
                position: {x, y, z},
                velocity: {x, y, z},
                config: {...}
            }
        """
        drone_id = params['droneId']
        drone_type = params['type']
        position = params['position']
        velocity = params.get('velocity', {'x': 0, 'y': 0, 'z': 0})

        # AirSim vehicle name 생성
        vehicle_name = f"{drone_type}_{drone_id}"

        try:
            # 드론 스폰 (AirSim 1.8.1+에서는 동적 스폰 지원)
            # 현재는 기존 vehicle을 활성화하는 방식으로 구현
            self.spawned_drones[drone_id] = vehicle_name

            # 초기 위치 설정 (NED 좌표계로 변환)
            pose = airsim.Pose(
                airsim.Vector3r(
                    position['x'],
                    position['y'],
                    -position['z']  # AirSim은 Z축이 아래 방향
                )
            )

            # 비동기 작업을 위해 run_in_executor 사용
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.simSetVehiclePose(pose, True, vehicle_name)
            )

            # Arm and enable API control
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.enableApiControl(True, vehicle_name)
            )
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.armDisarm(True, vehicle_name)
            )

            logger.info(f"드론 생성 성공: {vehicle_name}")
            return {'success': True, 'droneId': drone_id, 'vehicleName': vehicle_name}

        except Exception as e:
            logger.error(f"드론 생성 실패 ({drone_id}): {e}")
            return {'success': False, 'error': str(e)}

    async def remove_drone(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """드론 제거"""
        drone_id = params['droneId']

        if drone_id not in self.spawned_drones:
            return {'success': False, 'error': 'Drone not found'}

        vehicle_name = self.spawned_drones[drone_id]

        try:
            # API control 비활성화
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.enableApiControl(False, vehicle_name)
            )

            del self.spawned_drones[drone_id]
            logger.info(f"드론 제거 성공: {vehicle_name}")
            return {'success': True}

        except Exception as e:
            logger.error(f"드론 제거 실패 ({drone_id}): {e}")
            return {'success': False, 'error': str(e)}

    async def update_drone(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """드론 상태 업데이트"""
        drone_id = params['droneId']
        position = params.get('position')
        velocity = params.get('velocity')

        if drone_id not in self.spawned_drones:
            return {'success': False, 'error': 'Drone not found'}

        vehicle_name = self.spawned_drones[drone_id]

        try:
            if position:
                # 위치 업데이트 (NED 좌표계)
                pose = airsim.Pose(
                    airsim.Vector3r(
                        position['x'],
                        position['y'],
                        -position['z']
                    )
                )
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: self.client.simSetVehiclePose(pose, True, vehicle_name)
                )

            if velocity:
                # 속도 업데이트
                vel = airsim.Vector3r(
                    velocity['x'],
                    velocity['y'],
                    -velocity['z']
                )
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: self.client.simSetVehicleVelocity(vel, vehicle_name)
                )

            return {'success': True}

        except Exception as e:
            logger.error(f"드론 업데이트 실패 ({drone_id}): {e}")
            return {'success': False, 'error': str(e)}

    async def get_drone_state(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """드론 상태 조회"""
        drone_id = params['droneId']

        if drone_id not in self.spawned_drones:
            return {'success': False, 'error': 'Drone not found'}

        vehicle_name = self.spawned_drones[drone_id]

        try:
            # 상태 조회
            state = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.getMultirotorState(vehicle_name)
            )

            pos = state.kinematics_estimated.position
            vel = state.kinematics_estimated.linear_velocity

            return {
                'success': True,
                'state': {
                    'position': {
                        'x': pos.x_val,
                        'y': pos.y_val,
                        'z': -pos.z_val  # NED -> ENU
                    },
                    'velocity': {
                        'x': vel.x_val,
                        'y': vel.y_val,
                        'z': -vel.z_val
                    }
                }
            }

        except Exception as e:
            logger.error(f"드론 상태 조회 실패 ({drone_id}): {e}")
            return {'success': False, 'error': str(e)}

    async def scan_radar(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """레이더 스캔 시뮬레이션

        실제 AirSim에는 레이더 센서가 없으므로,
        현재 드론 위치를 기반으로 탐지 이벤트 생성
        """
        current_time = params['currentTime']
        detections = []

        try:
            for drone_id, vehicle_name in self.spawned_drones.items():
                state = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda vn=vehicle_name: self.client.getMultirotorState(vn)
                )

                pos = state.kinematics_estimated.position

                # 기지로부터의 거리 계산
                distance = np.sqrt(pos.x_val**2 + pos.y_val**2 + pos.z_val**2)
                azimuth = np.arctan2(pos.y_val, pos.x_val) * 180 / np.pi

                # 탐지 이벤트 생성
                detections.append({
                    'timestamp': current_time,
                    'track_id': f'T{drone_id}',
                    'position': {
                        'x': pos.x_val,
                        'y': pos.y_val,
                        'z': -pos.z_val
                    },
                    'radial_distance': distance,
                    'azimuth': azimuth,
                    'sensor_type': 'radar'
                })

            return {'success': True, 'detections': detections}

        except Exception as e:
            logger.error(f"레이더 스캔 실패: {e}")
            return {'success': False, 'error': str(e)}

    async def detect_audio(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """음향 탐지 시뮬레이션"""
        current_time = params['currentTime']
        detections = []

        try:
            for drone_id, vehicle_name in self.spawned_drones.items():
                state = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda vn=vehicle_name: self.client.getMultirotorState(vn)
                )

                pos = state.kinematics_estimated.position
                distance = np.sqrt(pos.x_val**2 + pos.y_val**2 + pos.z_val**2)

                # 음향 탐지 범위 내인 경우에만 탐지
                if distance < 1000:  # 1km 내
                    detections.append({
                        'timestamp': current_time,
                        'droneId': drone_id,
                        'position': {
                            'x': pos.x_val,
                            'y': pos.y_val,
                            'z': -pos.z_val
                        },
                        'sensor_type': 'acoustic'
                    })

            return {'success': True, 'detections': detections}

        except Exception as e:
            logger.error(f"음향 탐지 실패: {e}")
            return {'success': False, 'error': str(e)}

    async def detect_eo(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """EO 카메라 탐지 시뮬레이션

        AirSim 카메라 이미지를 사용하여 객체 탐지 수행
        (실제 구현 시에는 컴퓨터 비전 모델 사용)
        """
        current_time = params['currentTime']
        detections = []

        try:
            # 카메라 이미지 획득 (기지 카메라)
            # responses = await asyncio.get_event_loop().run_in_executor(
            #     None,
            #     lambda: self.client.simGetImages([
            #         airsim.ImageRequest("0", airsim.ImageType.Scene, False, False)
            #     ])
            # )

            # 현재는 단순히 드론 위치 기반으로 탐지
            for drone_id, vehicle_name in self.spawned_drones.items():
                state = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda vn=vehicle_name: self.client.getMultirotorState(vn)
                )

                pos = state.kinematics_estimated.position
                distance = np.sqrt(pos.x_val**2 + pos.y_val**2 + pos.z_val**2)

                # EO 카메라 범위 내인 경우에만 탐지
                if distance < 500:  # 500m 내
                    detections.append({
                        'timestamp': current_time,
                        'droneId': drone_id,
                        'position': {
                            'x': pos.x_val,
                            'y': pos.y_val,
                            'z': -pos.z_val
                        },
                        'confidence': 0.9,
                        'sensor_type': 'eo',
                        'classification': 'unknown'  # 실제로는 비전 모델 결과
                    })

            return {'success': True, 'detections': detections}

        except Exception as e:
            logger.error(f"EO 탐지 실패: {e}")
            return {'success': False, 'error': str(e)}

    async def reset(self) -> Dict[str, Any]:
        """시뮬레이션 리셋"""
        try:
            # 모든 드론 제거
            for drone_id in list(self.spawned_drones.keys()):
                await self.remove_drone({'droneId': drone_id})

            # AirSim 리셋
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.reset()
            )

            logger.info("시뮬레이션 리셋 완료")
            return {'success': True}

        except Exception as e:
            logger.error(f"리셋 실패: {e}")
            return {'success': False, 'error': str(e)}
