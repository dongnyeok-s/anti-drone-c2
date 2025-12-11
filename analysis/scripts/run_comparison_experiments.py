"""
Baseline / Fusion_Old / Fusion_Tuned 비교 실험 스크립트

각 모드별로 평가 실험을 실행하고 결과를 비교합니다.
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List

PROJECT_ROOT = Path(__file__).parent.parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
RESULTS_DIR = ANALYSIS_DIR / 'results'

def run_evaluation_for_mode(mode: str, has_runtime_params: bool = False):
    """특정 모드로 평가 실험 실행"""
    print(f"\n{'='*60}")
    print(f"  [{mode}] 평가 실험 실행")
    print(f"{'='*60}\n")
    
    # runtime_params.json 처리
    runtime_params_file = SIMULATOR_DIR / 'config' / 'runtime_params.json'
    
    if mode == 'baseline':
        # baseline: runtime_params 없음 (기본값 사용)
        if runtime_params_file.exists():
            runtime_params_file.rename(runtime_params_file.with_suffix('.json.bak'))
    elif mode == 'fusion_old':
        # fusion_old: runtime_params 없음 (기본 fusion)
        if runtime_params_file.exists():
            runtime_params_file.rename(runtime_params_file.with_suffix('.json.bak'))
    elif mode == 'fusion_tuned':
        # fusion_tuned: best_config를 runtime_params로 사용
        best_config_file = RESULTS_DIR / 'auto_tune_best_config.json'
        if best_config_file.exists():
            with open(best_config_file, 'r') as f:
                best_config = json.load(f)
            with open(runtime_params_file, 'w') as f:
                json.dump(best_config.get('best_params', {}), f, indent=2)
        else:
            print(f"  Warning: {best_config_file}를 찾을 수 없습니다.")
    
    # 평가 실험 실행
    try:
        result = subprocess.run(
            ['npm', 'run', 'eval'],
            cwd=str(SIMULATOR_DIR),
            capture_output=True,
            text=True,
            timeout=3600
        )
        
        if result.returncode != 0:
            print(f"  ✗ 평가 실험 실패: {result.stderr}")
            return False
        
        print(f"  ✓ 평가 실험 완료")
        return True
    except subprocess.TimeoutExpired:
        print(f"  ✗ 평가 실험 타임아웃")
        return False
    except Exception as e:
        print(f"  ✗ 평가 실험 오류: {e}")
        return False
    finally:
        # 로그 파일 이동
        move_logs_to_comparison_dir(mode)
        
        # runtime_params 정리
        if mode != 'fusion_tuned' and runtime_params_file.exists():
            runtime_params_file.unlink()
        if (runtime_params_file.with_suffix('.json.bak')).exists():
            (runtime_params_file.with_suffix('.json.bak')).rename(runtime_params_file)


def move_logs_to_comparison_dir(mode: str):
    """로그 파일을 comparison 디렉토리로 이동"""
    eval_logs_dir = SIMULATOR_DIR / 'logs' / 'eval'
    comparison_logs_dir = SIMULATOR_DIR / 'logs' / 'eval_comparison' / mode
    
    if not eval_logs_dir.exists():
        return
    
    comparison_logs_dir.mkdir(parents=True, exist_ok=True)
    
    # 모든 실험 디렉토리를 찾아서 이동
    for exp_dir in eval_logs_dir.iterdir():
        if exp_dir.is_dir():
            # 시나리오 추출
            exp_name = exp_dir.name
            if 'all_hostile' in exp_name:
                scenario = 'all_hostile'
            elif 'mixed_civil' in exp_name:
                scenario = 'mixed_civil'
            elif 'civil_only' in exp_name:
                scenario = 'civil_only'
            else:
                continue
            
            # 모드 디렉토리 찾기
            for mode_dir in exp_dir.iterdir():
                if mode_dir.is_dir():
                    target_dir = comparison_logs_dir / scenario
                    target_dir.mkdir(parents=True, exist_ok=True)
                    
                    # 로그 파일 복사
                    for log_file in mode_dir.glob('*.jsonl'):
                        target_file = target_dir / log_file.name
                        import shutil
                        shutil.copy2(log_file, target_file)
    
    print(f"  로그 파일 이동 완료: {comparison_logs_dir}")


def main():
    """메인 함수"""
    print("="*60)
    print("  Baseline / Fusion_Old / Fusion_Tuned 비교 실험")
    print("="*60)
    
    # best_config 확인
    best_config_file = RESULTS_DIR / 'auto_tune_best_config.json'
    if not best_config_file.exists():
        print(f"\nError: {best_config_file}를 찾을 수 없습니다.")
        print("먼저 auto_tune.py를 실행하여 best_config를 생성하세요.")
        sys.exit(1)
    
    # 각 모드별 실행
    modes = ['baseline', 'fusion_old', 'fusion_tuned']
    
    for mode in modes:
        if not run_evaluation_for_mode(mode, mode == 'fusion_tuned'):
            print(f"\n{mode} 모드 실험 실패. 계속 진행합니다...")
    
    print("\n" + "="*60)
    print("  모든 비교 실험 완료!")
    print("="*60)


if __name__ == '__main__':
    main()

