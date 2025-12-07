"""
Message Mapper - Convert between PX4 telemetry and C2 WebSocket messages

Maintains compatibility with existing AirSim bridge message format.
"""

import logging
from typing import Dict, Any, Optional
from dataclasses import dataclass
import math

logger = logging.getLogger(__name__)


@dataclass
class BasePosition:
    """Base station reference position"""
    lat: float
    lon: float
    alt: float


class MessageMapper:
    """
    Converts PX4 telemetry to C2 WebSocket messages and vice versa.

    Maintains compatibility with existing AirSim bridge format:
    - Uses ENU coordinate system (C2 server expects this)
    - Position relative to base station
    - Velocity in m/s
    """

    def __init__(self, base_position: BasePosition):
        self.base = base_position

        # Earth radius for coordinate conversion
        self.EARTH_RADIUS = 6371000  # meters

    def gps_to_local(self, lat: float, lon: float, alt: float) -> Dict[str, float]:
        """
        Convert GPS coordinates to local ENU coordinates relative to base

        Args:
            lat, lon, alt: GPS position

        Returns:
            {x, y, z} in meters (ENU frame)
        """
        # Simple flat-earth approximation (good for < 10km)
        dlat = math.radians(lat - self.base.lat)
        dlon = math.radians(lon - self.base.lon)

        # ENU coordinates
        x = self.EARTH_RADIUS * dlon * math.cos(math.radians(self.base.lat))  # East
        y = self.EARTH_RADIUS * dlat  # North
        z = alt - self.base.alt  # Up

        return {'x': x, 'y': y, 'z': z}

    def local_to_gps(self, x: float, y: float, z: float) -> Dict[str, float]:
        """
        Convert local ENU coordinates to GPS

        Args:
            x, y, z: Local position in meters (ENU frame)

        Returns:
            {lat, lon, alt} in degrees/meters
        """
        # Reverse flat-earth conversion
        dlat = y / self.EARTH_RADIUS
        dlon = x / (self.EARTH_RADIUS * math.cos(math.radians(self.base.lat)))

        lat = self.base.lat + math.degrees(dlat)
        lon = self.base.lon + math.degrees(dlon)
        alt = self.base.alt + z

        return {'lat': lat, 'lon': lon, 'alt': alt}

    def ned_to_enu_velocity(self, vx_ned: float, vy_ned: float, vz_ned: float) -> Dict[str, float]:
        """
        Convert NED velocity to ENU velocity

        NED: North-East-Down (PX4 uses this)
        ENU: East-North-Up (C2 server expects this)
        """
        return {
            'vx': vy_ned,      # East = NED East
            'vy': vx_ned,      # North = NED North
            'vz': -vz_ned      # Up = -Down
        }

    def drone_state_to_c2_message(self, drone_state, role: str) -> Dict[str, Any]:
        """
        Convert PX4 drone state to C2 WebSocket message

        Message format (compatible with AirSim bridge):
        {
            type: "drone_state_update",
            drone_id: "...",
            position: {x, y, z},  // ENU coordinates
            velocity: {vx, vy, vz},  // ENU velocities
            armed: bool,
            in_air: bool,
            battery: float,
            role: "hostile" | "interceptor"
        }
        """
        # Convert GPS to local ENU
        local_pos = self.gps_to_local(
            drone_state.position['lat'],
            drone_state.position['lon'],
            drone_state.position['alt']
        )

        # Convert NED velocity to ENU
        enu_vel = self.ned_to_enu_velocity(
            drone_state.velocity['vx'],
            drone_state.velocity['vy'],
            drone_state.velocity['vz']
        )

        return {
            'type': 'drone_state_update',
            'drone_id': drone_state.drone_id,
            'position': local_pos,
            'velocity': enu_vel,
            'armed': drone_state.armed,
            'in_air': drone_state.in_air,
            'battery': drone_state.battery,
            'role': role,
            'timestamp': None  # Will be set by bridge
        }

    def simulate_radar_detection(self, drone_state, role: str, noise_sigma: float = 10.0) -> Optional[Dict[str, Any]]:
        """
        Simulate radar detection from GPS position

        Returns radar_detection event or None if out of range
        """
        local_pos = self.gps_to_local(
            drone_state.position['lat'],
            drone_state.position['lon'],
            drone_state.position['alt']
        )

        # Calculate range and bearing
        range_m = math.sqrt(local_pos['x']**2 + local_pos['y']**2)
        bearing_deg = math.degrees(math.atan2(local_pos['y'], local_pos['x']))

        # Add noise (simple Gaussian)
        import random
        range_noisy = range_m + random.gauss(0, noise_sigma)
        bearing_noisy = bearing_deg + random.gauss(0, 2.0)  # 2 degree noise

        return {
            'type': 'radar_detection',
            'drone_id': drone_state.drone_id,
            'range': range_noisy,
            'bearing': bearing_noisy,
            'altitude': local_pos['z'],
            'confidence': 0.85,
            'sensor_type': 'radar',
            'timestamp': None  # Will be set by bridge
        }

    def c2_command_to_px4(self, command: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert C2 command to PX4 action

        C2 commands:
        - engage_command: {type, drone_id, target_id, method}
        - move_command: {type, drone_id, position, velocity}
        - rtl_command: {type, drone_id}

        Returns:
        {
            action: "goto" | "set_velocity" | "rtl" | "arm" | "takeoff" | "land",
            params: {...}
        }
        """
        cmd_type = command.get('type')

        if cmd_type == 'engage_command':
            # For interceptor: pursue target
            return {
                'action': 'pursue',
                'target_id': command.get('target_id'),
                'method': command.get('method', 'ram')
            }

        elif cmd_type == 'move_command':
            # Move to position or set velocity
            if 'position' in command:
                # Convert ENU to GPS
                pos = command['position']
                gps = self.local_to_gps(pos['x'], pos['y'], pos['z'])
                return {
                    'action': 'goto',
                    'lat': gps['lat'],
                    'lon': gps['lon'],
                    'alt': gps['alt']
                }
            elif 'velocity' in command:
                # Convert ENU velocity to NED
                vel = command['velocity']
                return {
                    'action': 'set_velocity',
                    'vx': vel['vy'],  # North = ENU y
                    'vy': vel['vx'],  # East = ENU x
                    'vz': -vel['vz']  # Down = -ENU z
                }

        elif cmd_type == 'rtl_command':
            return {'action': 'rtl'}

        elif cmd_type == 'arm_command':
            return {'action': 'arm'}

        elif cmd_type == 'takeoff_command':
            return {
                'action': 'takeoff',
                'altitude': command.get('altitude', 10.0)
            }

        elif cmd_type == 'land_command':
            return {'action': 'land'}

        else:
            logger.warning(f"Unknown C2 command type: {cmd_type}")
            return {'action': 'unknown'}
