"""
실험 결과 요약 및 보고서 생성 모듈

최종 요약 결과를 생성하고 보고서를 출력합니다.
"""

import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional

from lib.loader import load_all_experiments, ExperimentData
from lib.metrics import calculate_all_metrics, ExperimentMetrics
from lib.summarize import generate_summary, generate_improvement_points


def main():
    """메인 함수"""
    import argparse
    
    parser = argparse.ArgumentParser(description='실험 결과 요약 생성')
    parser.add_argument('log_dir', type=str, help='로그 디렉토리 경로')
    parser.add_argument('--output', '-o', type=str, default='summary.json', help='출력 파일 경로')
    
    args = parser.parse_args()
    
    # 실험 데이터 로드
    experiments = load_all_experiments(args.log_dir)
    
    if not experiments:
        print(f"❌ {args.log_dir}에서 실험 데이터를 찾을 수 없습니다.")
        return
    
    # 요약 생성
    summary = generate_summary(experiments)
    
    # JSON 저장
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 요약 생성 완료: {args.output}")
    print(f"   실험 수: {len(experiments)}")
    print(f"   요격 성공률: {summary['metrics']['interception']['success_rate']:.1f}%")
    
    # 개선 포인트 출력
    if summary['improvement_points']:
        print("\n📋 개선 포인트:")
        for point in summary['improvement_points']:
            print(f"   {point}")


if __name__ == '__main__':
    main()
