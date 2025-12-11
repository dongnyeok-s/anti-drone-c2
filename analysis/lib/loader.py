"""
JSONL 로그 파일 로더

실험 로그 파일을 파싱하고 이벤트 객체로 변환합니다.
"""

import json
import os
import glob
from pathlib import Path
from typing import List, Dict, Any, Optional, Generator
from dataclasses import dataclass, field


@dataclass
class ExperimentData:
    """실험 데이터 컨테이너"""
    filepath: str
    experiment_id: str
    scenario_id: str
    events: List[Dict[str, Any]]
    
    # 메타데이터
    seed: Optional[int] = None
    duration: float = 0
    drone_count: int = 0
    interceptor_count: int = 0
    audio_model_enabled: bool = False
    hostile_ratio: float = 1.0
    radar_config: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def event_count(self) -> int:
        return len(self.events)


def parse_jsonl_file(filepath: str) -> List[Dict[str, Any]]:
    """
    JSONL 파일을 파싱하여 이벤트 리스트 반환
    
    Args:
        filepath: JSONL 파일 경로
        
    Returns:
        이벤트 딕셔너리 리스트
    """
    events = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                events.append(event)
            except json.JSONDecodeError as e:
                print(f"⚠️ JSON 파싱 에러 ({filepath}:{line_num}): {e}")
    return events


def load_experiment(filepath: str) -> Optional[ExperimentData]:
    """
    단일 실험 파일 로드
    
    Args:
        filepath: JSONL 파일 경로
        
    Returns:
        ExperimentData 객체 또는 None
    """
    if not os.path.exists(filepath):
        print(f"⚠️ 파일 없음: {filepath}")
        return None
    
    events = parse_jsonl_file(filepath)
    if not events:
        return None
    
    # 메타데이터 추출
    experiment_id = "unknown"
    scenario_id = "unknown"
    seed = None
    duration = 0
    drone_count = 0
    interceptor_count = 0
    audio_model_enabled = False
    hostile_ratio = 1.0
    radar_config = {}
    
    for event in events:
        event_type = event.get('event', '')
        
        if event_type == 'scenario_start':
            experiment_id = str(event.get('scenario_id', 'unknown'))
            scenario_id = str(event.get('scenario_id', 'unknown'))
            seed = event.get('seed')
            config = event.get('config', {})
            drone_count = config.get('drone_count', 0)
            interceptor_count = config.get('interceptor_count', 0)
            audio_model_enabled = config.get('audio_model_enabled', False)
            hostile_ratio = config.get('hostile_ratio', 1.0)
            radar_config = config.get('radar_config', {})
            
        elif event_type == 'scenario_end':
            duration = event.get('duration', event.get('timestamp', 0))
    
    return ExperimentData(
        filepath=filepath,
        experiment_id=experiment_id,
        scenario_id=scenario_id,
        events=events,
        seed=seed,
        duration=duration,
        drone_count=drone_count,
        interceptor_count=interceptor_count,
        audio_model_enabled=audio_model_enabled,
        hostile_ratio=hostile_ratio,
        radar_config=radar_config,
    )


def load_all_experiments(log_dir: str = '../simulator/logs') -> List[ExperimentData]:
    """
    디렉토리의 모든 실험 파일 로드
    
    Args:
        log_dir: 로그 디렉토리 경로
        
    Returns:
        ExperimentData 리스트
    """
    pattern = os.path.join(log_dir, '*.jsonl')
    files = sorted(glob.glob(pattern))
    
    if not files:
        print(f"⚠️ 로그 파일을 찾을 수 없습니다: {pattern}")
        return []
    
    experiments = []
    for filepath in files:
        exp = load_experiment(filepath)
        if exp:
            experiments.append(exp)
    
    print(f"📂 {len(experiments)}개 실험 로드 완료")
    return experiments


def filter_events(events: List[Dict[str, Any]], event_type: str) -> List[Dict[str, Any]]:
    """특정 타입의 이벤트만 필터링"""
    return [e for e in events if e.get('event') == event_type]


def get_events_by_drone(events: List[Dict[str, Any]], drone_id: str) -> List[Dict[str, Any]]:
    """특정 드론의 이벤트만 필터링"""
    return [e for e in events if e.get('drone_id') == drone_id]


def iter_events(experiments: List[ExperimentData], event_type: Optional[str] = None) -> Generator:
    """
    모든 실험의 이벤트를 순회하는 제너레이터
    
    Args:
        experiments: 실험 데이터 리스트
        event_type: 필터링할 이벤트 타입 (None이면 전체)
        
    Yields:
        (experiment, event) 튜플
    """
    for exp in experiments:
        for event in exp.events:
            if event_type is None or event.get('event') == event_type:
                yield (exp, event)


def count_events_by_type(events: List[Dict[str, Any]]) -> Dict[str, int]:
    """이벤트 타입별 개수 집계"""
    counts = {}
    for event in events:
        event_type = event.get('event', 'unknown')
        counts[event_type] = counts.get(event_type, 0) + 1
    return counts


def load_summary_json(filepath: str) -> Optional[Dict[str, Any]]:
    """요약 JSON 파일 로드"""
    if not os.path.exists(filepath):
        return None
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


# 편의 함수
def find_latest_summary(log_dir: str = '../simulator/logs') -> Optional[str]:
    """가장 최근 요약 파일 경로 반환"""
    pattern = os.path.join(log_dir, 'summary_*.json')
    files = sorted(glob.glob(pattern), reverse=True)
    return files[0] if files else None

