"""
자동 파라미터 튜닝용 검색 공간 정의

최적화할 파라미터의 범위를 정의하고, 랜덤 샘플링 함수를 제공합니다.
"""

import random
from typing import Dict, Any, Tuple
from dataclasses import dataclass, field

# ============================================
# 파라미터 범위 정의
# ============================================

@dataclass
class ParamSpace:
    """파라미터 검색 공간"""
    
    # Threat 관련
    threat_engage_threshold: Tuple[float, float] = (55.0, 85.0)  # 연속형
    threat_abort_threshold: Tuple[float, float] = (30.0, 50.0)   # 연속형
    
    # 분류 관련
    civil_conf_threshold: Tuple[float, float] = (0.5, 0.9)      # 연속형
    
    # PN 유도 관련
    pn_nav_constant: Tuple[float, float] = (2.0, 4.5)            # 연속형 (PN_K)
    pn_max_turn_rate: Tuple[float, float] = (2.0, 5.0)          # 연속형 (rad/s)
    pn_min_closing_speed: Tuple[float, float] = (5.0, 15.0)     # 연속형 (m/s)
    
    # Interceptor 관련
    interceptor_turn_rate_multiplier: Tuple[float, float] = (0.8, 1.3)  # 기본값 대비 배율
    
    # 센서 융합 가중치
    sensor_radar_weight: Tuple[float, float] = (0.4, 0.7)
    sensor_audio_weight: Tuple[float, float] = (0.1, 0.3)
    sensor_eo_weight: Tuple[float, float] = (0.7, 1.0)
    
    # Threat 점수 가중치 (합이 1이 되도록 정규화 필요)
    threat_weight_existence: Tuple[float, float] = (0.1, 0.2)
    threat_weight_classification: Tuple[float, float] = (0.2, 0.3)
    threat_weight_distance: Tuple[float, float] = (0.15, 0.25)
    threat_weight_velocity: Tuple[float, float] = (0.1, 0.15)
    threat_weight_behavior: Tuple[float, float] = (0.05, 0.1)
    threat_weight_armed: Tuple[float, float] = (0.08, 0.12)
    threat_weight_heading: Tuple[float, float] = (0.08, 0.12)


# ============================================
# 랜덤 샘플링 함수
# ============================================

def sample_params(space: ParamSpace, rng: random.Random = None) -> Dict[str, Any]:
    """
    파라미터 검색 공간에서 무작위로 하나의 파라미터 세트를 샘플링
    
    Returns:
        파라미터 딕셔너리
    """
    if rng is None:
        rng = random.Random()
    
    def uniform(min_val: float, max_val: float) -> float:
        """연속형 파라미터 샘플링"""
        return rng.uniform(min_val, max_val)
    
    # Threat 관련
    threat_engage_threshold = uniform(*space.threat_engage_threshold)
    threat_abort_threshold = uniform(*space.threat_abort_threshold)
    
    # 분류 관련
    civil_conf_threshold = uniform(*space.civil_conf_threshold)
    
    # PN 유도 관련
    pn_nav_constant = uniform(*space.pn_nav_constant)
    pn_max_turn_rate = uniform(*space.pn_max_turn_rate)
    pn_min_closing_speed = uniform(*space.pn_min_closing_speed)
    
    # Interceptor 관련
    interceptor_turn_rate_multiplier = uniform(*space.interceptor_turn_rate_multiplier)
    
    # 센서 융합 가중치
    sensor_radar_weight = uniform(*space.sensor_radar_weight)
    sensor_audio_weight = uniform(*space.sensor_audio_weight)
    sensor_eo_weight = uniform(*space.sensor_eo_weight)
    
    # Threat 점수 가중치 (정규화 필요)
    threat_weights_raw = {
        'existence': uniform(*space.threat_weight_existence),
        'classification': uniform(*space.threat_weight_classification),
        'distance': uniform(*space.threat_weight_distance),
        'velocity': uniform(*space.threat_weight_velocity),
        'behavior': uniform(*space.threat_weight_behavior),
        'armed': uniform(*space.threat_weight_armed),
        'heading': uniform(*space.threat_weight_heading),
    }
    
    # 가중치 정규화 (합이 1이 되도록)
    total = sum(threat_weights_raw.values())
    threat_weights = {k: v / total for k, v in threat_weights_raw.items()}
    
    return {
        # Threat 관련
        'threat_engage_threshold': round(threat_engage_threshold, 2),
        'threat_abort_threshold': round(threat_abort_threshold, 2),
        
        # 분류 관련
        'civil_conf_threshold': round(civil_conf_threshold, 3),
        
        # PN 유도 관련
        'pn_nav_constant': round(pn_nav_constant, 2),
        'pn_max_turn_rate': round(pn_max_turn_rate, 2),
        'pn_min_closing_speed': round(pn_min_closing_speed, 1),
        
        # Interceptor 관련
        'interceptor_turn_rate_multiplier': round(interceptor_turn_rate_multiplier, 2),
        
        # 센서 융합 가중치
        'sensor_radar_weight': round(sensor_radar_weight, 3),
        'sensor_audio_weight': round(sensor_audio_weight, 3),
        'sensor_eo_weight': round(sensor_eo_weight, 3),
        
        # Threat 점수 가중치
        'threat_weights': threat_weights,
    }


# ============================================
# 기본 검색 공간 인스턴스
# ============================================

DEFAULT_PARAM_SPACE = ParamSpace()

