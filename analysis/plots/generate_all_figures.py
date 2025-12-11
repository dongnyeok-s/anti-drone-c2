"""
모든 논문용 Figure 자동 생성 스크립트
"""

import sys
from pathlib import Path
from datetime import datetime
import subprocess

PROJECT_ROOT = Path(__file__).parent.parent.parent
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
PLOTS_DIR = ANALYSIS_DIR / 'plots'
FIGURES_DIR = ANALYSIS_DIR / 'figures'

def run_script(script_name: str):
    """개별 플롯 스크립트 실행"""
    script_path = PLOTS_DIR / script_name
    if not script_path.exists():
        print(f"  ⚠ 스크립트 없음: {script_name}")
        return False
    
    print(f"\n  실행 중: {script_name}")
    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(ANALYSIS_DIR),
            capture_output=True,
            text=True,
            timeout=600
        )
        
        if result.returncode != 0:
            print(f"    ✗ 실패: {result.stderr[:200]}")
            return False
        
        print(f"    ✓ 완료")
        return True
    except Exception as e:
        print(f"    ✗ 오류: {e}")
        return False

def main():
    """메인 함수"""
    print("="*60)
    print("  논문용 Figure 자동 생성")
    print("="*60)
    
    # 타임스탬프 생성
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir = FIGURES_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # latest 심볼릭 링크 생성
    latest_link = FIGURES_DIR / 'latest'
    if latest_link.exists():
        latest_link.unlink()
    latest_link.symlink_to(timestamp)
    
    print(f"\n출력 디렉토리: {output_dir}")
    
    # 플롯 스크립트 목록
    scripts = [
        'plot_confusion_matrix.py',
        'plot_roc_pr_curve.py',
        'plot_pr_curve.py',
        'plot_fp_distribution.py',
        'plot_threat_dynamics.py',
        'plot_sensor_contribution.py',
    ]
    
    success_count = 0
    for script in scripts:
        if run_script(script):
            success_count += 1
    
    print(f"\n{'='*60}")
    print(f"  Figure 생성 완료: {success_count}/{len(scripts)}")
    print(f"{'='*60}")
    print(f"\n저장 위치: {output_dir}")
    print(f"심볼릭 링크: {latest_link}")

if __name__ == '__main__':
    main()

