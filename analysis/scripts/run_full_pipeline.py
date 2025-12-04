"""
2차 성능 향상 전체 파이프라인 자동 실행 스크립트

1. Auto-tuning 실행
2. Best config 적용
3. 비교 실험 수행
4. 리포트 생성
5. 결과 요약
"""

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Optional

PROJECT_ROOT = Path(__file__).parent.parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
RESULTS_DIR = ANALYSIS_DIR / 'results'
CONFIG_DIR = SIMULATOR_DIR / 'config'

def print_section(title: str):
    """섹션 헤더 출력"""
    print("\n" + "="*60)
    print(f"  {title}")
    print("="*60 + "\n")


def step1_auto_tune(trials: int = 50, seed: Optional[int] = None, profile: str = 'fast'):
    """1단계: Auto-tuning 실행"""
    print_section("1. 자동 파라미터 튜닝 실행")
    
    cmd = ['python', 'auto_tune.py', '--trials', str(trials), '--profile', profile]
    if seed:
        cmd.extend(['--seed', str(seed)])
    
    print(f"명령: {' '.join(cmd)}")
    print(f"이 작업은 시간이 오래 걸릴 수 있습니다 ({trials} trials)...\n")
    
    try:
        result = subprocess.run(
            cmd,
            cwd=str(ANALYSIS_DIR),
            timeout=7200  # 2시간 타임아웃
        )
        
        if result.returncode != 0:
            print("✗ Auto-tuning 실패")
            return False
        
        # 결과 확인
        best_config_file = RESULTS_DIR / 'auto_tune_best_config.json'
        history_file = RESULTS_DIR / 'auto_tune_history.json'
        
        if not best_config_file.exists():
            print("✗ best_config.json이 생성되지 않았습니다.")
            return False
        
        print("✓ Auto-tuning 완료")
        return True
    except subprocess.TimeoutExpired:
        print("✗ Auto-tuning 타임아웃")
        return False
    except Exception as e:
        print(f"✗ Auto-tuning 오류: {e}")
        return False


def step2_apply_best_config():
    """2단계: Best config를 runtime_params.json으로 저장"""
    print_section("2. Best Config 적용")
    
    best_config_file = RESULTS_DIR / 'auto_tune_best_config.json'
    
    if not best_config_file.exists():
        print("✗ best_config.json을 찾을 수 없습니다.")
        return False
    
    with open(best_config_file, 'r') as f:
        best_config = json.load(f)
    
    best_params = best_config.get('best_params', {})
    
    if not best_params:
        print("✗ best_params가 없습니다.")
        return False
    
    # runtime_params.json 저장
    CONFIG_DIR.mkdir(exist_ok=True)
    runtime_params_file = CONFIG_DIR / 'runtime_params.json'
    
    with open(runtime_params_file, 'w') as f:
        json.dump(best_params, f, indent=2)
    
    print(f"✓ Best config 적용 완료: {runtime_params_file}")
    print("\n주요 파라미터:")
    print(f"  - threat_engage_threshold: {best_params.get('threat_engage_threshold', 'N/A')}")
    print(f"  - civil_conf_threshold: {best_params.get('civil_conf_threshold', 'N/A')}")
    print(f"  - pn_nav_constant: {best_params.get('pn_nav_constant', 'N/A')}")
    print(f"  - sensor_radar_weight: {best_params.get('sensor_radar_weight', 'N/A')}")
    
    return True


def step3_comparison_experiments():
    """3단계: 비교 실험 수행"""
    print_section("3. 비교 실험 수행")
    
    print("Baseline / Fusion_Old / Fusion_Tuned 비교 실험을 실행합니다...\n")
    
    try:
        result = subprocess.run(
            ['python', 'scripts/run_comparison_experiments.py'],
            cwd=str(ANALYSIS_DIR),
            timeout=10800  # 3시간 타임아웃
        )
        
        if result.returncode != 0:
            print("✗ 비교 실험 실패")
            return False
        
        print("✓ 비교 실험 완료")
        return True
    except subprocess.TimeoutExpired:
        print("✗ 비교 실험 타임아웃")
        return False
    except Exception as e:
        print(f"✗ 비교 실험 오류: {e}")
        return False


def step4_generate_report():
    """4단계: 비교 리포트 생성"""
    print_section("4. 비교 리포트 생성")
    
    try:
        result = subprocess.run(
            ['python', 'scripts/generate_report.py', '--full'],
            cwd=str(ANALYSIS_DIR),
            timeout=300  # 5분 타임아웃
        )
        
        if result.returncode != 0:
            print("✗ 리포트 생성 실패")
            return False
        
        print("✓ 리포트 생성 완료")
        return True
    except Exception as e:
        print(f"✗ 리포트 생성 오류: {e}")
        return False


def step5_summary():
    """5단계: 결과 요약 출력"""
    print_section("5. 결과 요약")
    
    # Best config 로드
    best_config_file = RESULTS_DIR / 'auto_tune_best_config.json'
    if best_config_file.exists():
        with open(best_config_file, 'r') as f:
            best_config = json.load(f)
        
        print("🎯 최적 파라미터:")
        best_params = best_config.get('best_params', {})
        for key, value in best_params.items():
            if isinstance(value, dict):
                print(f"  {key}:")
                for k, v in value.items():
                    print(f"    {k}: {v:.4f}")
            else:
                print(f"  {key}: {value}")
        
        print(f"\n최고 점수: {best_config.get('best_score', 0):.4f}")
    
    # 비교 리포트 요약
    comparison_file = RESULTS_DIR / 'comparison_summary.md'
    if comparison_file.exists():
        print("\n📊 성능 비교 리포트:")
        print(f"  {comparison_file}")
        
        # 리포트에서 핵심 지표 추출 (간단한 파싱)
        with open(comparison_file, 'r') as f:
            content = f.read()
            # 표 부분만 출력
            lines = content.split('\n')
            in_table = False
            for line in lines:
                if '| 모드 |' in line:
                    in_table = True
                if in_table:
                    print(f"  {line}")
                    if line.strip() == '' and '|' not in line:
                        break
    
    print("\n" + "="*60)
    print("  2차 성능 향상 자동 튜닝 완료!")
    print("="*60)


def main():
    """메인 함수"""
    import argparse
    
    parser = argparse.ArgumentParser(description='2차 성능 향상 전체 파이프라인')
    parser.add_argument('--trials', type=int, default=50, help='Auto-tuning trials')
    parser.add_argument('--seed', type=int, default=None, help='Random seed')
    parser.add_argument('--skip-tuning', action='store_true', help='Auto-tuning 스킵')
    parser.add_argument('--skip-comparison', action='store_true', help='비교 실험 스킵')
    parser.add_argument('--profile', type=str, default='fast', choices=['fast', 'full'],
                       help='평가 프로파일: fast (기본값) 또는 full')
    
    args = parser.parse_args()
    
    print("="*60)
    print("  2차 성능 향상 자동 수행 루틴")
    print("="*60)
    
    # 1. Auto-tuning
    if not args.skip_tuning:
        if not step1_auto_tune(args.trials, args.seed, args.profile):
            print("\n⚠️  Auto-tuning 실패. 계속 진행합니다...")
    else:
        print("\n⏭️  Auto-tuning 스킵")
    
    # 2. Best config 적용
    if not step2_apply_best_config():
        print("\n⚠️  Best config 적용 실패. 계속 진행합니다...")
    
    # 3. 비교 실험
    if not args.skip_comparison:
        if not step3_comparison_experiments():
            print("\n⚠️  비교 실험 실패. 계속 진행합니다...")
    else:
        print("\n⏭️  비교 실험 스킵")
    
    # 4. 리포트 생성
    if not step4_generate_report():
        print("\n⚠️  리포트 생성 실패. 계속 진행합니다...")
    
    # 5. 요약
    step5_summary()


if __name__ == '__main__':
    main()

