"""
AirSim Bridge WebSocket Server

Node.js 시뮬레이터와 AirSim(Unreal Engine) 간의 브리지 서버
JSON-RPC 2.0 프로토콜을 사용하여 WebSocket 통신
"""

import asyncio
import json
import logging
import websockets
from typing import Dict, Any, Optional
from airsim_wrapper import AirSimWrapper

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class AirSimBridgeServer:
    """AirSim 브리지 WebSocket 서버"""

    def __init__(self, host: str = 'localhost', port: int = 9000):
        self.host = host
        self.port = port
        self.airsim = AirSimWrapper()
        self.connected_clients = set()

    async def start(self):
        """서버 시작"""
        logger.info(f"AirSim 브리지 서버 시작 중... {self.host}:{self.port}")

        # AirSim 연결
        if not await self.airsim.connect():
            logger.error("AirSim 연결 실패 - Unreal Engine이 실행 중인지 확인하세요")
            return

        logger.info("AirSim 연결 성공")

        # WebSocket 서버 시작
        async with websockets.serve(self.handle_client, self.host, self.port):
            logger.info(f"WebSocket 서버 시작 완료: ws://{self.host}:{self.port}")
            await asyncio.Future()  # Run forever

    async def handle_client(self, websocket, path):
        """클라이언트 연결 핸들러"""
        client_id = id(websocket)
        self.connected_clients.add(websocket)
        logger.info(f"클라이언트 연결: {client_id}")

        try:
            async for message in websocket:
                response = await self.process_message(message)
                await websocket.send(json.dumps(response))
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"클라이언트 연결 종료: {client_id}")
        except Exception as e:
            logger.error(f"클라이언트 핸들러 오류: {e}", exc_info=True)
        finally:
            self.connected_clients.discard(websocket)

    async def process_message(self, message: str) -> Dict[str, Any]:
        """JSON-RPC 2.0 메시지 처리"""
        try:
            data = json.loads(message)

            # JSON-RPC 2.0 검증
            if 'jsonrpc' not in data or data['jsonrpc'] != '2.0':
                return self.error_response(None, -32600, "Invalid Request")

            if 'method' not in data:
                return self.error_response(data.get('id'), -32600, "Method required")

            method = data['method']
            params = data.get('params', {})
            request_id = data.get('id')

            # 메서드 라우팅
            if method == 'spawnDrone':
                result = await self.airsim.spawn_drone(params)
            elif method == 'removeDrone':
                result = await self.airsim.remove_drone(params)
            elif method == 'updateDrone':
                result = await self.airsim.update_drone(params)
            elif method == 'getDroneState':
                result = await self.airsim.get_drone_state(params)
            elif method == 'scanRadar':
                result = await self.airsim.scan_radar(params)
            elif method == 'detectAudio':
                result = await self.airsim.detect_audio(params)
            elif method == 'detectEO':
                result = await self.airsim.detect_eo(params)
            elif method == 'reset':
                result = await self.airsim.reset()
            elif method == 'ping':
                result = {'pong': True, 'timestamp': params.get('timestamp')}
            else:
                return self.error_response(request_id, -32601, f"Method not found: {method}")

            return self.success_response(request_id, result)

        except json.JSONDecodeError:
            return self.error_response(None, -32700, "Parse error")
        except Exception as e:
            logger.error(f"메시지 처리 오류: {e}", exc_info=True)
            return self.error_response(
                data.get('id') if 'data' in locals() else None,
                -32603,
                f"Internal error: {str(e)}"
            )

    def success_response(self, request_id: Optional[Any], result: Any) -> Dict[str, Any]:
        """성공 응답 생성"""
        return {
            'jsonrpc': '2.0',
            'result': result,
            'id': request_id
        }

    def error_response(self, request_id: Optional[Any], code: int, message: str) -> Dict[str, Any]:
        """에러 응답 생성"""
        return {
            'jsonrpc': '2.0',
            'error': {
                'code': code,
                'message': message
            },
            'id': request_id
        }


async def main():
    """메인 엔트리포인트"""
    server = AirSimBridgeServer(host='0.0.0.0', port=9000)
    await server.start()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("서버 종료")
