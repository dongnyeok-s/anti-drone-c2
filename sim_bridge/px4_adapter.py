"""
PX4 Adapter - MAVSDK wrapper for drone control

Provides a clean interface to PX4 autopilot via MAVSDK-Python.
Designed to be easily swappable between SITL and real drones.
"""

import asyncio
import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
from mavsdk import System
from mavsdk.offboard import OffboardError, PositionNedYaw, VelocityNedYaw
from mavsdk.telemetry import Position, FixedwingMetrics

logger = logging.getLogger(__name__)


@dataclass
class DroneState:
    """Unified drone state representation"""
    drone_id: str
    position: Dict[str, float]  # {lat, lon, alt}
    velocity: Dict[str, float]  # {vx, vy, vz} NED frame
    armed: bool
    in_air: bool
    battery: float  # percentage
    connection_state: str


class PX4Adapter:
    """
    Adapter for PX4 autopilot communication.

    Supports both SITL (udp://:14540) and real drones (serial:///dev/ttyUSB0:57600).
    """

    def __init__(self, drone_id: str, connection_string: str, role: str = "hostile"):
        self.drone_id = drone_id
        self.connection_string = connection_string
        self.role = role  # "hostile" or "interceptor"

        self.system = System()
        self.connected = False
        self.state: Optional[DroneState] = None

        # Telemetry data
        self._position: Optional[Position] = None
        self._velocity: Optional[Dict[str, float]] = None
        self._armed: bool = False
        self._in_air: bool = False
        self._battery: float = 100.0

    async def connect(self) -> bool:
        """Connect to PX4 autopilot"""
        try:
            logger.info(f"[{self.drone_id}] Connecting to {self.connection_string}")
            await self.system.connect(system_address=self.connection_string)

            # Wait for drone to be discovered
            logger.info(f"[{self.drone_id}] Waiting for drone...")
            async for state in self.system.core.connection_state():
                if state.is_connected:
                    logger.info(f"[{self.drone_id}] Drone connected!")
                    self.connected = True
                    break

            # Start telemetry subscriptions
            asyncio.create_task(self._subscribe_telemetry())

            return True

        except Exception as e:
            logger.error(f"[{self.drone_id}] Connection failed: {e}")
            return False

    async def _subscribe_telemetry(self):
        """Subscribe to telemetry streams"""
        try:
            # Position and velocity
            async for position in self.system.telemetry.position():
                self._position = position

            # Flight mode and armed state
            async for flight_mode in self.system.telemetry.flight_mode():
                pass  # Store if needed

            async for armed in self.system.telemetry.armed():
                self._armed = armed

            async for in_air in self.system.telemetry.in_air():
                self._in_air = in_air

            async for battery in self.system.telemetry.battery():
                self._battery = battery.remaining_percent

            async for velocity in self.system.telemetry.velocity_ned():
                self._velocity = {
                    'vx': velocity.north_m_s,
                    'vy': velocity.east_m_s,
                    'vz': velocity.down_m_s
                }

        except Exception as e:
            logger.error(f"[{self.drone_id}] Telemetry error: {e}")

    def get_state(self) -> Optional[DroneState]:
        """Get current drone state"""
        if not self._position:
            return None

        return DroneState(
            drone_id=self.drone_id,
            position={
                'lat': self._position.latitude_deg,
                'lon': self._position.longitude_deg,
                'alt': self._position.absolute_altitude_m
            },
            velocity=self._velocity or {'vx': 0, 'vy': 0, 'vz': 0},
            armed=self._armed,
            in_air=self._in_air,
            battery=self._battery,
            connection_state="connected" if self.connected else "disconnected"
        )

    async def arm(self) -> bool:
        """Arm the drone"""
        try:
            logger.info(f"[{self.drone_id}] Arming...")
            await self.system.action.arm()
            return True
        except Exception as e:
            logger.error(f"[{self.drone_id}] Arm failed: {e}")
            return False

    async def disarm(self) -> bool:
        """Disarm the drone"""
        try:
            logger.info(f"[{self.drone_id}] Disarming...")
            await self.system.action.disarm()
            return True
        except Exception as e:
            logger.error(f"[{self.drone_id}] Disarm failed: {e}")
            return False

    async def takeoff(self, altitude: float = 10.0) -> bool:
        """Takeoff to specified altitude (meters)"""
        try:
            logger.info(f"[{self.drone_id}] Taking off to {altitude}m")
            await self.system.action.set_takeoff_altitude(altitude)
            await self.system.action.takeoff()
            return True
        except Exception as e:
            logger.error(f"[{self.drone_id}] Takeoff failed: {e}")
            return False

    async def land(self) -> bool:
        """Land the drone"""
        try:
            logger.info(f"[{self.drone_id}] Landing...")
            await self.system.action.land()
            return True
        except Exception as e:
            logger.error(f"[{self.drone_id}] Land failed: {e}")
            return False

    async def goto_position(self, lat: float, lon: float, alt: float, yaw: float = 0.0) -> bool:
        """
        Fly to specified GPS position

        Args:
            lat: Latitude (degrees)
            lon: Longitude (degrees)
            alt: Altitude MSL (meters)
            yaw: Yaw angle (degrees, 0=North)
        """
        try:
            logger.info(f"[{self.drone_id}] Going to ({lat}, {lon}, {alt})")
            await self.system.action.goto_location(lat, lon, alt, yaw)
            return True
        except Exception as e:
            logger.error(f"[{self.drone_id}] Goto failed: {e}")
            return False

    async def set_velocity_ned(self, vx: float, vy: float, vz: float, yaw: float = 0.0) -> bool:
        """
        Set velocity in NED frame

        Args:
            vx: North velocity (m/s)
            vy: East velocity (m/s)
            vz: Down velocity (m/s)
            yaw: Yaw angle (degrees)
        """
        try:
            # Enable offboard mode if not already
            if not self._in_offboard_mode:
                await self.system.offboard.set_velocity_ned(
                    VelocityNedYaw(vx, vy, vz, yaw)
                )
                await self.system.offboard.start()
                self._in_offboard_mode = True
            else:
                await self.system.offboard.set_velocity_ned(
                    VelocityNedYaw(vx, vy, vz, yaw)
                )
            return True
        except OffboardError as e:
            logger.error(f"[{self.drone_id}] Offboard control failed: {e}")
            return False

    async def return_to_launch(self) -> bool:
        """Return to launch position"""
        try:
            logger.info(f"[{self.drone_id}] Returning to launch")
            await self.system.action.return_to_launch()
            return True
        except Exception as e:
            logger.error(f"[{self.drone_id}] RTL failed: {e}")
            return False

    async def hold_position(self) -> bool:
        """Hold current position"""
        try:
            logger.info(f"[{self.drone_id}] Holding position")
            await self.system.action.hold()
            return True
        except Exception as e:
            logger.error(f"[{self.drone_id}] Hold failed: {e}")
            return False

    async def disconnect(self):
        """Disconnect from PX4"""
        logger.info(f"[{self.drone_id}] Disconnecting...")
        self.connected = False
        # MAVSDK doesn't have explicit disconnect, connection will close automatically
