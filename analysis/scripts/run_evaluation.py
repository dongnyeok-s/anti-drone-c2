"""
평가 실행 스크립트 (통합 버전)

baseline, fusion_default, fusion_tuned 모드를 실행하고 결과를 정리합니다.
프로파일(fast/full)을 선택할 수 있습니다.

사용법:
    python run_evaluation.py [--profile fast|full] [--modes baseline fusion_default fusion_tuned]
"""

import subprocess
import sys
import json
import shutil
from pathlib import Path
import time
import argparse

PROJECT_ROOT = Path(__file__).parent.parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
CONFIG_DIR = SIMULATOR_DIR / 'config'
LOGS_DIR = SIMULATOR_DIR / 'logs' / 'eval'
RESULTS_DIR = ANALYSIS_DIR / 'results'

def setup_mode_config(mode: str) -> bool:
    """
    모드별 runtime_params.json 설정
    
    Args:
        mode: 'baseline', 'fusion_default', 'fusion_tuned'
    
    Returns:
        성공 여부
    """
    runtime_params_file = CONFIG_DIR / 'runtime_params.json'
    backup_file = CONFIG_DIR / 'runtime_params.json.backup'
    
    if mode == 'baseline':
        # baseline: runtime_params 제거 (BASELINE 모드는 fusion 비활성화)
        if runtime_params_file.exists():
            shutil.copy2(runtime_params_file, backup_file)
            runtime_params_file.unlink()
            print("  ✓ runtime_params.json 백업 및 제거 (BASELINE 모드)")
    elif mode == 'fusion_default':
        # fusion_default: runtime_params 제거 (기본 FUSION 설정)
        if runtime_params_file.exists():
            shutil.copy2(runtime_params_file, backup_file)
            runtime_params_file.unlink()
            print("  ✓ runtime_params.json 백업 및 제거 (기본 FUSION 설정)")
    elif mode == 'fusion_tuned':
        # fusion_tuned: runtime_params 복원 또는 생성
        if backup_file.exists():
            shutil.copy2(backup_file, runtime_params_file)
            backup_file.unlink()
            print("  ✓ runtime_params.json 복원 (튜닝된 FUSION 설정)")
        elif not runtime_params_file.exists():
            # best_config에서 runtime_params 생성
            best_config_file = RESULTS_DIR / 'auto_tune_best_config.json'
            if best_config_file.exists():
                with open(best_config_file, 'r') as f:
                    config = json.load(f)
                with open(runtime_params_file, 'w') as f:
                    json.dump(config.get('best_params', {}), f, indent=2)
                print("  ✓ runtime_params.json 생성 완료 (best_config에서)")
            else:
                print("  ⚠ runtime_params.json이 없고 best_config도 없습니다.")
                return False
    
    return True

def restore_config():
    """설정 복원"""
    runtime_params_file = CONFIG_DIR / 'runtime_params.json'
    backup_file = CONFIG_DIR / 'runtime_params.json.backup'
    
    if backup_file.exists() and not runtime_params_file.exists():
        shutil.copy2(backup_file, runtime_params_file)
        backup_file.unlink()
        print("  ✓ runtime_params.json 복원")

def run_evaluation_mode(mode: str, profile: str = 'full') -> bool:
    """
    특정 모드로 평가 실행
    
    Args:
        mode: 'baseline', 'fusion_default', 'fusion_tuned'
        profile: 'fast' or 'full'
    
    Returns:
        성공 여부
    """
    print(f"\n{'='*60}")
    print(f"  {mode.upper()} 모드 평가 실행 (profile: {profile})")
    print(f"{'='*60}")
    
    # 모드별 설정
    if not setup_mode_config(mode):
        print(f"  ✗ {mode} 모드 설정 실패")
        return False
    
    # 평가 실행
    print(f"\n  평가 실행 중... (시간이 오래 걸릴 수 있습니다)")
    start_time = time.time()
    
    # 모드에 따라 --mode 옵션 설정
    target_mode = 'BASELINE' if mode == 'baseline' else 'FUSION'
    
    try:
        # ts-node로 직접 실행하여 --mode 옵션 전달
        result = subprocess.run(
            ['npx', 'ts-node', 'src/scripts/run_evaluation_experiments.ts', 
             '--profile', profile, '--mode', target_mode],
            cwd=str(SIMULATOR_DIR),
            capture_output=True,
            text=True,
            timeout=7200  # 2시간 타임아웃
        )
        
        elapsed = time.time() - start_time
        
        if result.returncode != 0:
            print(f"  ✗ 평가 실패 (소요 시간: {elapsed/60:.1f}분)")
            print(f"  오류: {result.stderr[:500]}")
            return False
        
        print(f"  ✓ 평가 완료 (소요 시간: {elapsed/60:.1f}분)")
        
        # 로그를 모드별로 정리
        mode_logs_dir = LOGS_DIR.parent / 'eval_full' / mode
        mode_logs_dir.mkdir(parents=True, exist_ok=True)
        
        # eval 디렉토리의 로그를 모드별로 복사
        if LOGS_DIR.exists():
            for exp_dir in LOGS_DIR.iterdir():
                if not exp_dir.is_dir():
                    continue
                
                # 모드 확인
                mode_dir = exp_dir / target_mode
                if not mode_dir.exists():
                    continue
                
                # 복사
                dest_dir = mode_logs_dir / exp_dir.name
                if dest_dir.exists():
                    shutil.rmtree(dest_dir)
                shutil.copytree(mode_dir, dest_dir)
            
            print(f"  ✓ 로그 저장: {mode_logs_dir}")
        
        return True
        
    except subprocess.TimeoutExpired:
        print(f"  ✗ 평가 타임아웃 (2시간 초과)")
        return False
    except Exception as e:
        print(f"  ✗ 평가 오류: {e}")
        return False
    finally:
        # 설정 복원
        restore_config()

def main():
    """메인 함수"""
    parser = argparse.ArgumentParser(description='평가 실행 스크립트')
    parser.add_argument('--profile', type=str, default='full', choices=['fast', 'full'],
                       help='평가 프로파일: fast (빠른 평가) 또는 full (정식 평가)')
    parser.add_argument('--modes', nargs='+', 
                       choices=['baseline', 'fusion_default', 'fusion_tuned'],
                       default=['baseline', 'fusion_default', 'fusion_tuned'],
                       help='실행할 모드 (기본값: 모두 실행)')
    
    args = parser.parse_args()
    
    print("="*60)
    print("  평가 실행")
    print("="*60)
    print(f"\n프로파일: {args.profile}")
    print(f"실행 모드: {', '.join(args.modes)}")
    print(f"\n각 모드는 {args.profile} 프로파일로 실행됩니다.")
    if args.profile == 'full':
        print("(예상 소요 시간: 모드당 30분~1시간)")
    else:
        print("(예상 소요 시간: 모드당 10~20분)")
    
    success_count = 0
    for i, mode in enumerate(args.modes, 1):
        print(f"\n[{i}/{len(args.modes)}] {mode.upper()} 모드 실행 중...")
        if run_evaluation_mode(mode, args.profile):
            success_count += 1
        else:
            print(f"\n⚠ {mode} 모드 평가 실패. 다음 모드로 진행합니다.")
    
    print("\n" + "="*60)
    print(f"  평가 완료! ({success_count}/{len(args.modes)} 성공)")
    print("="*60)
    print("\n로그 위치:")
    for mode in args.modes:
        log_path = LOGS_DIR.parent / 'eval_full' / mode
        print(f"  - {mode}: {log_path}")

if __name__ == '__main__':
    main()

