"""
요약 생성 모듈

실험 결과 요약 및 개선 포인트 생성
"""

from datetime import datetime
from typing import List, Dict, Any

from .loader import ExperimentData
from .metrics import calculate_all_metrics


def generate_summary(experiments: List[ExperimentData]) -> Dict[str, Any]:
    """
    전체 실험 요약 생성
    
    Args:
        experiments: ExperimentData 리스트
        
    Returns:
        요약 딕셔너리
    """
    individual_metrics, aggregated = calculate_all_metrics(experiments)
    
    # 개선 포인트 자동 생성
    improvement_points = generate_improvement_points(aggregated)
    
    return {
        'generated_at': datetime.now().isoformat(),
        'metrics': aggregated,
        'individual_experiments': [
            {
                'id': m.experiment_id,
                'scenario_id': m.scenario_id,
                'duration': m.duration,
                'drone_count': m.total_drones,
                'radar_detections': m.radar_detections,
                'intercept_success_rate': m.intercept_success_rate,
            }
            for m in individual_metrics
        ],
        'improvement_points': improvement_points,
    }


def generate_improvement_points(metrics: Dict[str, Any]) -> List[str]:
    """
    분석 결과 기반 개선 포인트 자동 생성
    
    Args:
        metrics: 집계된 지표 딕셔너리
        
    Returns:
        개선 포인트 문자열 리스트
    """
    points = []
    
    # 요격 성공률 분석
    success_rate = metrics['interception']['success_rate']
    if success_rate < 50:
        points.append(f"⚠️ 요격 성공률({success_rate}%)이 낮음 - 요격 알고리즘 개선 필요")
    elif success_rate < 75:
        points.append(f"📊 요격 성공률({success_rate}%) 개선 여지 있음")
    else:
        points.append(f"✅ 요격 성공률({success_rate}%) 양호")
    
    # 오탐률 분석
    false_alarm_rate = metrics['detection']['false_alarm_rate']
    if false_alarm_rate > 5:
        points.append(f"⚠️ 오탐률({false_alarm_rate}%)이 높음 - 탐지 필터링 개선 필요")
    elif false_alarm_rate > 2:
        points.append(f"📊 오탐률({false_alarm_rate}%) 모니터링 권장")
    else:
        points.append(f"✅ 오탐률({false_alarm_rate}%) 양호")
    
    # 탐지 지연 분석
    detection_delay = metrics['detection']['detection_delay'].get('mean', 0)
    if detection_delay > 3:
        points.append(f"⚠️ 평균 탐지 지연({detection_delay:.2f}초)이 길음 - 센서 감도 조정 필요")
    elif detection_delay > 1.5:
        points.append(f"📊 탐지 지연({detection_delay:.2f}초) 개선 가능")
    else:
        points.append(f"✅ 탐지 지연({detection_delay:.2f}초) 양호")
    
    # 교전 비율 분석
    engaged_ratio = metrics['engagement']['engaged_ratio']
    if engaged_ratio < 30:
        points.append(f"⚠️ 교전 비율({engaged_ratio}%)이 낮음 - 교전 판단 기준 완화 검토")
    
    # 요격 실패 원인 분석
    top_failures = metrics['interception'].get('top_failure_reasons', [])
    if top_failures:
        top_reason, top_count = top_failures[0]
        reason_map = {
            'evaded': '타겟 회피',
            'distance_exceeded': '거리 초과',
            'timeout': '시간 초과',
            'low_speed': '속도 부족',
            'sensor_error': '센서 오류',
            'target_lost': '타겟 손실',
        }
        reason_name = reason_map.get(top_reason, top_reason)
        points.append(f"📈 주요 요격 실패 원인: {reason_name} ({top_count}회)")
    
    # 무력화율 분석
    neutralization_rate = metrics['interception']['neutralization_rate']
    if neutralization_rate < 20:
        points.append(f"⚠️ 무력화율({neutralization_rate}%)이 낮음 - 전체적인 대응 능력 검토 필요")
    
    # 음향 탐지 상태
    if not metrics['detection']['audio_model_active']:
        points.append("ℹ️ 음향 탐지 모델이 비활성화 상태임")
    elif metrics['detection']['total_audio'] == 0:
        points.append("📊 음향 탐지가 활성화되었으나 탐지 기록 없음 - 모델 점검 필요")
    
    return points
