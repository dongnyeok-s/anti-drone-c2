"""
WebSocket Client - Connect to C2 server

Maintains connection to Node.js C2 server and handles message exchange.
"""

import asyncio
import json
import logging
import websockets
from typing import Callable, Dict, Any, Optional

logger = logging.getLogger(__name__)


class C2WebSocketClient:
    """
    WebSocket client for C2 server communication.

    Sends telemetry and receives commands from C2 server.
    """

    def __init__(self, url: str, reconnect_interval: float = 5.0):
        self.url = url
        self.reconnect_interval = reconnect_interval

        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.connected = False
        self.running = False

        # Callback for incoming commands
        self.on_command: Optional[Callable[[Dict[str, Any]], None]] = None

    async def connect(self) -> bool:
        """Connect to C2 server"""
        try:
            logger.info(f"Connecting to C2 server: {self.url}")
            self.ws = await websockets.connect(self.url)
            self.connected = True
            logger.info("Connected to C2 server")

            # Start receiving loop
            asyncio.create_task(self._receive_loop())

            return True

        except Exception as e:
            logger.error(f"Connection failed: {e}")
            self.connected = False
            return False

    async def _receive_loop(self):
        """Receive messages from C2 server"""
        try:
            async for message in self.ws:
                try:
                    data = json.loads(message)
                    await self._handle_message(data)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON: {e}")
                except Exception as e:
                    logger.error(f"Message handling error: {e}")

        except websockets.exceptions.ConnectionClosed:
            logger.warning("Connection closed by C2 server")
            self.connected = False
        except Exception as e:
            logger.error(f"Receive loop error: {e}")
            self.connected = False

    async def _handle_message(self, data: Dict[str, Any]):
        """Handle incoming message from C2 server"""
        msg_type = data.get('type')

        logger.debug(f"Received from C2: {msg_type}")

        # Call registered callback
        if self.on_command:
            await self.on_command(data)

    async def send_telemetry(self, message: Dict[str, Any]):
        """Send telemetry message to C2 server"""
        if not self.connected or not self.ws:
            logger.warning("Not connected, cannot send telemetry")
            return

        try:
            await self.ws.send(json.dumps(message))
        except Exception as e:
            logger.error(f"Send failed: {e}")
            self.connected = False

    async def send_event(self, event_type: str, data: Dict[str, Any]):
        """Send event to C2 server"""
        message = {'type': event_type, **data}
        await self.send_telemetry(message)

    async def run_with_reconnect(self):
        """Run client with auto-reconnect"""
        self.running = True

        while self.running:
            if not self.connected:
                success = await self.connect()
                if not success:
                    logger.info(f"Reconnecting in {self.reconnect_interval}s...")
                    await asyncio.sleep(self.reconnect_interval)
                    continue

            # Wait a bit before checking again
            await asyncio.sleep(1.0)

    async def stop(self):
        """Stop client and close connection"""
        self.running = False
        self.connected = False

        if self.ws:
            await self.ws.close()
            logger.info("Disconnected from C2 server")
