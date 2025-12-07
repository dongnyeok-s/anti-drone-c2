#!/usr/bin/env python3
"""
PX4 SITL Bridge - Main Entry Point

Connects PX4 SITL drones to C2 server via WebSocket.
Compatible with existing AirSim bridge message format.

Usage:
    python main.py [--config config.yaml]
"""

import asyncio
import logging
import argparse
import yaml
import time
from pathlib import Path
from typing import Dict, List
import colorlog

from px4_adapter import PX4Adapter, DroneState
from websocket_client import C2WebSocketClient
from message_mapper import MessageMapper, BasePosition


# Configure colored logging
def setup_logging(level: str = "INFO"):
    """Setup colored console logging"""
    handler = colorlog.StreamHandler()
    handler.setFormatter(colorlog.ColoredFormatter(
        '%(log_color)s[%(asctime)s] %(levelname)-8s%(reset)s %(blue)s%(name)s%(reset)s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
        log_colors={
            'DEBUG': 'cyan',
            'INFO': 'green',
            'WARNING': 'yellow',
            'ERROR': 'red',
            'CRITICAL': 'red,bg_white',
        }
    ))

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level))
    root_logger.addHandler(handler)


logger = logging.getLogger(__name__)


class PX4Bridge:
    """
    Main bridge between PX4 SITL and C2 server.

    Manages multiple drones and handles bidirectional communication.
    """

    def __init__(self, config: Dict):
        self.config = config

        # C2 WebSocket client
        self.c2_client = C2WebSocketClient(
            url=config['c2_server']['url'],
            reconnect_interval=config['c2_server']['reconnect_interval']
        )
        self.c2_client.on_command = self.handle_c2_command

        # PX4 adapters (one per drone)
        self.drones: Dict[str, PX4Adapter] = {}
        self.drone_roles: Dict[str, str] = {}

        # Message mapper
        base_pos = config['base_position']
        self.mapper = MessageMapper(
            BasePosition(
                lat=base_pos['lat'],
                lon=base_pos['lon'],
                alt=base_pos['alt']
            )
        )

        # Update rates
        self.telemetry_rate = config['update_rates']['telemetry']  # Hz
        self.command_check_rate = config['update_rates']['command_check']  # Hz

        # Sensor config
        self.sensor_config = config['sensors']

        # Running flag
        self.running = False

    async def initialize(self):
        """Initialize all PX4 connections"""
        logger.info("Initializing PX4 connections...")

        # Connect to each drone
        for drone_cfg in self.config['px4_connections']:
            drone_id = drone_cfg['id']
            connection_string = drone_cfg['connection_string']
            role = drone_cfg['role']
            auto_arm = drone_cfg.get('auto_arm', False)

            # Create adapter
            adapter = PX4Adapter(drone_id, connection_string, role)

            # Connect
            success = await adapter.connect()
            if not success:
                logger.error(f"Failed to connect to {drone_id}")
                continue

            self.drones[drone_id] = adapter
            self.drone_roles[drone_id] = role

            logger.info(f"✓ Connected to {drone_id} ({role})")

            # Auto-arm if configured
            if auto_arm:
                await asyncio.sleep(1.0)  # Wait for system ready
                await adapter.arm()
                await adapter.takeoff(altitude=10.0)

        logger.info(f"Initialized {len(self.drones)} drones")

    async def handle_c2_command(self, command: Dict):
        """Handle command from C2 server"""
        cmd_type = command.get('type')
        drone_id = command.get('drone_id')

        logger.info(f"C2 command: {cmd_type} for {drone_id}")

        if drone_id not in self.drones:
            logger.warning(f"Unknown drone: {drone_id}")
            return

        drone = self.drones[drone_id]

        # Convert C2 command to PX4 action
        px4_action = self.mapper.c2_command_to_px4(command)
        action = px4_action.get('action')

        # Execute action
        if action == 'goto':
            await drone.goto_position(
                lat=px4_action['lat'],
                lon=px4_action['lon'],
                alt=px4_action['alt']
            )

        elif action == 'set_velocity':
            await drone.set_velocity_ned(
                vx=px4_action['vx'],
                vy=px4_action['vy'],
                vz=px4_action['vz']
            )

        elif action == 'rtl':
            await drone.return_to_launch()

        elif action == 'arm':
            await drone.arm()

        elif action == 'takeoff':
            altitude = px4_action.get('altitude', 10.0)
            await drone.arm()
            await asyncio.sleep(1.0)
            await drone.takeoff(altitude)

        elif action == 'land':
            await drone.land()

        elif action == 'pursue':
            # Interceptor pursuit logic
            target_id = px4_action.get('target_id')
            logger.info(f"Interceptor {drone_id} pursuing {target_id}")
            # TODO: Implement pursuit guidance

        else:
            logger.warning(f"Unknown action: {action}")

    async def telemetry_loop(self):
        """Send telemetry to C2 server periodically"""
        interval = 1.0 / self.telemetry_rate

        while self.running:
            for drone_id, drone in self.drones.items():
                state = drone.get_state()
                if not state:
                    continue

                role = self.drone_roles[drone_id]

                # Send drone state
                state_msg = self.mapper.drone_state_to_c2_message(state, role)
                state_msg['timestamp'] = time.time()
                await self.c2_client.send_telemetry(state_msg)

                # Simulate radar detection (if enabled)
                if self.sensor_config['radar']['enabled']:
                    radar_msg = self.mapper.simulate_radar_detection(
                        state,
                        role,
                        noise_sigma=self.sensor_config['radar']['noise_sigma']
                    )
                    if radar_msg:
                        radar_msg['timestamp'] = time.time()
                        await self.c2_client.send_event('radar_detection', radar_msg)

            await asyncio.sleep(interval)

    async def run(self):
        """Run the bridge"""
        self.running = True

        try:
            # Initialize PX4 connections
            await self.initialize()

            # Start C2 client
            asyncio.create_task(self.c2_client.run_with_reconnect())

            # Wait for C2 connection
            while not self.c2_client.connected:
                logger.info("Waiting for C2 connection...")
                await asyncio.sleep(1.0)

            logger.info("✓ All systems connected. Bridge running.")

            # Start telemetry loop
            await self.telemetry_loop()

        except KeyboardInterrupt:
            logger.info("Shutting down...")
        finally:
            await self.shutdown()

    async def shutdown(self):
        """Shutdown all connections"""
        self.running = False

        # Disconnect drones
        for drone_id, drone in self.drones.items():
            logger.info(f"Disconnecting {drone_id}")
            await drone.disconnect()

        # Disconnect C2 client
        await self.c2_client.stop()

        logger.info("Bridge stopped")


async def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="PX4 SITL Bridge")
    parser.add_argument('--config', default='config.yaml', help='Config file path')
    args = parser.parse_args()

    # Load config
    config_path = Path(args.config)
    if not config_path.exists():
        logger.error(f"Config file not found: {args.config}")
        return

    with open(config_path) as f:
        config = yaml.safe_load(f)

    # Setup logging
    setup_logging(config.get('logging', {}).get('level', 'INFO'))

    # Run bridge
    bridge = PX4Bridge(config)
    await bridge.run()


if __name__ == '__main__':
    asyncio.run(main())
