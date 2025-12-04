"""
자동 파라미터 튜닝 스크립트

랜덤 서치 기반으로 파라미터 조합을 시도하고,
각 조합에 대해 평가 파이프라인을 실행하여
최적의 파라미터 세트를 찾습니다.

사용법:
    python auto_tune.py --trials 50
    python auto_tune.py --trials 50 --seed 12345
"""

import json
import sys
import argparse
import subprocess
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from collections import defaultdict
import random

# 프로젝트 루트 경로
PROJECT_ROOT = Path(__file__).parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
CONFIG_DIR = SIMULATOR_DIR / 'config'

# 검색 공간 임포트
sys.path.insert(0, str(ANALYSIS_DIR))
from auto_tuning_config import DEFAULT_PARAM_SPACE, sample_params

# ============================================
# 설정
# ============================================

RUNTIME_PARAMS_FILE = CONFIG_DIR / 'runtime_params.json'
EVAL_LOGS_DIR = SIMULATOR_DIR / 'logs' / 'eval'
RESULTS_DIR = ANALYSIS_DIR / 'results'
TUNING_HISTORY_FILE = RESULTS_DIR / 'auto_tune_history.json'
BEST_CONFIG_FILE = RESULTS_DIR / 'auto_tune_best_config.json'

# ============================================
# Objective 함수
# ============================================

def compute_objective_score(metrics_dict: Dict[Tuple[str, str], Dict]) -> float:
    """
    성능 지표를 하나의 스칼라 score로 계산
    
    Objective 수식:
    score = F1_hostile_all_hostile
          + F1_hostile_mixed_civil
          - 2.0 * civil_fp_rate_mixed_civil
          + 0.3 * accuracy_all_hostile
    
    목표:
    - HOSTILE F1 점수를 높이기 (all_hostile, mixed_civil 시나리오)
    - CIVIL False Positive를 강하게 패널티 (민간기를 적으로 오분류하는 것 방지)
    - 전체 정확도도 어느 정도 반영
    
    Args:
        metrics_dict: {
            ('all_hostile', 'FUSION'): { accuracy, HOSTILE_f1, civil_fp_rate, ... },
            ('mixed_civil', 'FUSION'): { accuracy, HOSTILE_f1, civil_fp_rate, ... },
            ...
        }
    
    Returns:
        objective score (높을수록 좋음, 음수 가능)
    """
    score = 0.0
    
    # 기준 시나리오: all_hostile, mixed_civil (FUSION 모드)
    key_all_hostile = ('all_hostile', 'FUSION')
    key_mixed_civil = ('mixed_civil', 'FUSION')
    
    # 1. HOSTILE F1 점수 (all_hostile)
    if key_all_hostile in metrics_dict:
        metrics = metrics_dict[key_all_hostile]
        f1_hostile = metrics.get('HOSTILE_f1', 0.0)
        score += f1_hostile * 1.0  # 가중치 1.0
        
        # 전체 정확도 보너스
        accuracy = metrics.get('accuracy', 0.0)
        score += accuracy * 0.3  # 가중치 0.3
    
    # 2. HOSTILE F1 점수 (mixed_civil)
    if key_mixed_civil in metrics_dict:
        metrics = metrics_dict[key_mixed_civil]
        f1_hostile = metrics.get('HOSTILE_f1', 0.0)
        score += f1_hostile * 1.0  # 가중치 1.0
        
        # 3. CIVIL False Positive 패널티 (mixed_civil에서 CIVIL을 HOSTILE로 오분류)
        # civil_fp_rate: true_label == CIVIL인데 pred_label == HOSTILE인 비율
        civil_fp_rate = metrics.get('civil_fp_rate', 0.0)
        score -= civil_fp_rate * 2.0  # 강한 패널티 (가중치 -2.0)
    
    return score


# ============================================
# 파라미터 주입
# ============================================

def save_runtime_params(params: Dict[str, Any]) -> None:
    """파라미터를 runtime_params.json 파일로 저장"""
    CONFIG_DIR.mkdir(exist_ok=True)
    
    with open(RUNTIME_PARAMS_FILE, 'w', encoding='utf-8') as f:
        json.dump(params, f, indent=2)
    
    print(f"  파라미터 저장: {RUNTIME_PARAMS_FILE}")


def clear_runtime_params() -> None:
    """runtime_params.json 파일 삭제 (기본값 사용)"""
    if RUNTIME_PARAMS_FILE.exists():
        RUNTIME_PARAMS_FILE.unlink()


# ============================================
# 평가 파이프라인 실행
# ============================================

def run_evaluation(profile: str = 'fast') -> bool:
    """eval runner 실행"""
    print(f"  [1/2] 평가 실험 실행 중... (프로파일: {profile})")
    try:
        # 프로파일에 따라 다른 명령 실행
        if profile == 'fast':
            cmd = ['npm', 'run', 'eval:fast']
        else:
            cmd = ['npm', 'run', 'eval:full']
        
        result = subprocess.run(
            cmd,
            cwd=str(SIMULATOR_DIR),
            capture_output=True,
            text=True,
            timeout=7200 if profile == 'full' else 3600  # full은 더 긴 타임아웃
        )
        
        if result.returncode != 0:
            print(f"  ✗ 평가 실험 실패: {result.stderr}")
            return False
        
        print("  ✓ 평가 실험 완료")
        return True
    except subprocess.TimeoutExpired:
        print("  ✗ 평가 실험 타임아웃")
        return False
    except Exception as e:
        print(f"  ✗ 평가 실험 오류: {e}")
        return False


def run_analysis() -> Dict[Tuple[str, str], Dict]:
    """분석 스크립트 실행 및 결과 읽기"""
    print("  [2/2] 성능 분석 실행 중...")
    try:
        result = subprocess.run(
            ['python', 'scripts/eval_classification_report.py',
             '--logs-dir', '../simulator/logs/eval',
             '--output-dir', 'results'],
            cwd=str(ANALYSIS_DIR),
            capture_output=True,
            text=True,
            timeout=300  # 5분 타임아웃
        )
        
        if result.returncode != 0:
            print(f"  ✗ 분석 실패: {result.stderr}")
            return {}
        
        print("  ✓ 분석 완료")
        
        # metrics를 읽어서 반환
        # 실제로는 eval_classification_report.py가 JSON을 생성하도록 수정 필요
        # 일단 classification_summary.md를 파싱하거나, 별도 JSON 생성 필요
        
        return parse_metrics_from_report()
    except subprocess.TimeoutExpired:
        print("  ✗ 분석 타임아웃")
        return {}
    except Exception as e:
        print(f"  ✗ 분석 오류: {e}")
        return {}


def parse_metrics_from_report() -> Dict[Tuple[str, str], Dict]:
    """
    metrics.json에서 metrics 파싱
    
    Returns:
        {
            ('all_hostile', 'FUSION'): { accuracy, HOSTILE_f1, ... },
            ('mixed_civil', 'FUSION'): { accuracy, HOSTILE_f1, ... },
            ...
        }
    """
    # 여러 가능한 경로 확인
    possible_paths = [
        RESULTS_DIR / 'metrics.json',
        ANALYSIS_DIR / 'results' / 'metrics.json',
        Path('results') / 'metrics.json',  # 상대 경로
    ]
    
    metrics_json_path = None
    for path in possible_paths:
        if path.exists():
            metrics_json_path = path
            break
    
    if not metrics_json_path:
        print(f"  ✗ Metrics JSON 파일을 찾을 수 없습니다.")
        print(f"    확인한 경로:")
        for path in possible_paths:
            print(f"      - {path} (존재: {path.exists()})")
        return {}
    
    try:
        with open(metrics_json_path, 'r', encoding='utf-8') as f:
            metrics_dict = json.load(f)
        
        # 키를 튜플로 변환
        result = {}
        for key_str, metrics in metrics_dict.items():
            # 키 형식: "all_hostile_FUSION", "mixed_civil_FUSION", "civil_only_FUSION"
            # 또는: "all_hostile_BASELINE" 등
            
            # 언더스코어로 split하되, 마지막 부분이 모드(BASELINE/FUSION)인지 확인
            parts = key_str.split('_')
            
            if len(parts) >= 2:
                # 마지막 부분이 모드인지 확인
                last_part = parts[-1]
                if last_part in ['BASELINE', 'FUSION']:
                    # 시나리오는 나머지 부분을 합침
                    scenario = '_'.join(parts[:-1])
                    mode = last_part
                    result[(scenario, mode)] = metrics
                else:
                    # 모드가 없는 경우, 시나리오 이름에서 추출
                    if 'all_hostile' in key_str:
                        result[('all_hostile', 'FUSION')] = metrics
                    elif 'mixed_civil' in key_str:
                        result[('mixed_civil', 'FUSION')] = metrics
                    elif 'civil_only' in key_str:
                        result[('civil_only', 'FUSION')] = metrics
        
        return result
    except Exception as e:
        print(f"  ✗ Metrics JSON 파싱 오류: {e}")
        return {}


# ============================================
# 메인 튜닝 루프
# ============================================

def run_auto_tune(trials: int, seed: Optional[int] = None, profile: str = 'fast') -> None:
    """자동 파라미터 튜닝 실행"""
    
    # 시드 설정
    if seed is None:
        seed = random.randint(1, 1000000)
    rng = random.Random(seed)
    
    print('=' * 60)
    print('  자동 파라미터 튜닝 시작')
    print('=' * 60)
    print(f'시드: {seed}')
    print(f'시행 횟수: {trials}')
    print(f'결과 저장 위치: {RESULTS_DIR}')
    print()
    
    # 결과 저장용
    history: List[Dict[str, Any]] = []
    best_score = float('-inf')  # 음수도 허용하므로 -inf로 초기화
    best_params: Optional[Dict[str, Any]] = None
    best_metrics: Optional[Dict[str, Dict]] = None
    
    # 결과 디렉토리 생성
    RESULTS_DIR.mkdir(exist_ok=True)
    
    for trial in range(trials):
        print(f'\n[Trial {trial + 1}/{trials}]')
        print('-' * 60)
        
        # 1. 파라미터 샘플링
        params = sample_params(DEFAULT_PARAM_SPACE, rng)
        print(f"  파라미터:")
        print(f"    - threat_engage_threshold: {params['threat_engage_threshold']}")
        print(f"    - civil_conf_threshold: {params['civil_conf_threshold']}")
        print(f"    - pn_nav_constant: {params['pn_nav_constant']}")
        print(f"    - sensor_radar_weight: {params['sensor_radar_weight']}")
        
        # 2. 파라미터 저장
        save_runtime_params(params)
        
        # 3. 평가 실험 실행
        if not run_evaluation(profile):
            print(f"  ✗ Trial {trial + 1} 실패 (평가 실험 오류)")
            clear_runtime_params()
            continue
        
        # 4. 분석 실행
        metrics = run_analysis()
        
        if not metrics:
            print(f"  ✗ Trial {trial + 1} 실패 (분석 오류)")
            clear_runtime_params()
            continue
        
        # 5. Objective score 계산
        score = compute_objective_score(metrics)
        print(f"  Objective Score: {score:.4f}")
        
        # 6. Best 업데이트
        if score > best_score:
            best_score = score
            best_params = params.copy()
            best_metrics = metrics.copy()
            print(f"  🎯 NEW BEST! (이전: {best_score:.4f})")
        
        # 7. 히스토리 기록
        history.append({
            'trial': trial + 1,
            'params': params,
            'score': score,
            'metrics': metrics,
        })
        
        # 8. 중간 저장 (매 10회마다)
        if (trial + 1) % 10 == 0:
            save_history(history, best_params, best_score, best_metrics)
            print(f"\n  중간 저장 완료 (Trial {trial + 1})")
        
        # 9. 파라미터 파일 정리
        clear_runtime_params()
    
    # 최종 저장
    save_history(history, best_params, best_score, best_metrics)
    
    # 결과 출력
    print('\n' + '=' * 60)
    print('  튜닝 완료!')
    print('=' * 60)
    print(f'\n최고 점수: {best_score:.4f}')
    print(f'\n최적 파라미터:')
    if best_params:
        for key, value in best_params.items():
            if isinstance(value, dict):
                print(f"  {key}:")
                for k, v in value.items():
                    print(f"    {k}: {v:.4f}")
            else:
                print(f"  {key}: {value}")
    
    print(f'\n결과 파일:')
    print(f"  - {TUNING_HISTORY_FILE}")
    print(f"  - {BEST_CONFIG_FILE}")


def save_history(
    history: List[Dict],
    best_params: Optional[Dict],
    best_score: float,
    best_metrics: Optional[Dict]
) -> None:
    """히스토리 및 최적 설정 저장"""
    
    # 히스토리 저장 (튜플 키를 문자열로 변환)
    history_serializable = []
    for entry in history:
        entry_copy = entry.copy()
        if 'metrics' in entry_copy and isinstance(entry_copy['metrics'], dict):
            # 튜플 키를 문자열로 변환
            metrics_str = {}
            for key, value in entry_copy['metrics'].items():
                if isinstance(key, tuple):
                    key_str = f"{key[0]}_{key[1]}"
                else:
                    key_str = str(key)
                metrics_str[key_str] = value
            entry_copy['metrics'] = metrics_str
        history_serializable.append(entry_copy)
    
    with open(TUNING_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'total_trials': len(history),
            'best_score': best_score,
            'history': history_serializable,
        }, f, indent=2)
    
    # 최적 설정 저장 (튜플 키를 문자열로 변환)
    if best_params:
        best_metrics_serializable = None
        if best_metrics:
            best_metrics_serializable = {}
            for key, value in best_metrics.items():
                if isinstance(key, tuple):
                    key_str = f"{key[0]}_{key[1]}"
                else:
                    key_str = str(key)
                best_metrics_serializable[key_str] = value
        
        with open(BEST_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump({
                'best_score': best_score,
                'best_params': best_params,
                'best_metrics': best_metrics_serializable,
            }, f, indent=2)


# ============================================
# 메인 함수
# ============================================

def main():
    parser = argparse.ArgumentParser(description='자동 파라미터 튜닝')
    parser.add_argument(
        '--trials',
        type=int,
        default=20,
        help='시행 횟수 (기본값: 20, fast 모드 권장)'
    )
    parser.add_argument(
        '--seed',
        type=int,
        default=None,
        help='랜덤 시드 (기본값: 자동 생성)'
    )
    parser.add_argument(
        '--profile',
        type=str,
        default='fast',
        choices=['fast', 'full'],
        help='평가 프로파일: fast (빠른 탐색, 기본값) 또는 full (최종 평가)'
    )
    
    args = parser.parse_args()
    
    run_auto_tune(args.trials, args.seed, args.profile)


if __name__ == '__main__':
    main()

