"""
자동 보고서 생성 모듈

실험 결과를 PDF/HTML 형식의 보고서로 자동 생성합니다.
"""

import os
import json
from datetime import datetime
from typing import Dict, Any, Optional

from .loader import load_all_experiments
from .metrics import calculate_all_metrics
from .summarize import generate_summary, generate_improvement_points

try:
    from .plots import (
        create_full_report_figure, 
        create_summary_card,
        HAS_MATPLOTLIB
    )
except ImportError:
    HAS_MATPLOTLIB = False


def generate_html_report(summary: Dict[str, Any], output_path: str = 'report.html'):
    """
    HTML 보고서 생성
    
    Args:
        summary: 요약 딕셔너리
        output_path: 출력 경로
    """
    metrics = summary['metrics']
    
    html_content = f"""
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>대드론 C2 시뮬레이션 실험 보고서</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ 
            font-family: 'Apple SD Gothic Neo', sans-serif; 
            line-height: 1.6; 
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }}
        .report-container {{ background: white; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        h1 {{ color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; margin-bottom: 20px; }}
        h2 {{ color: #34495e; margin: 25px 0 15px; padding-left: 10px; border-left: 4px solid #3498db; }}
        .meta {{ color: #7f8c8d; font-size: 0.9em; margin-bottom: 30px; }}
        .stats-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }}
        .stat-card {{ 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }}
        .stat-card.success {{ background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }}
        .stat-card.warning {{ background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }}
        .stat-card.info {{ background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }}
        .stat-value {{ font-size: 2.5em; font-weight: bold; }}
        .stat-label {{ font-size: 0.9em; opacity: 0.9; }}
        table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
        th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }}
        th {{ background: #2c3e50; color: white; }}
        tr:hover {{ background: #f8f9fa; }}
        .improvement {{ 
            background: #fff3cd; 
            border-left: 4px solid #ffc107; 
            padding: 10px 15px; 
            margin: 10px 0;
            border-radius: 0 5px 5px 0;
        }}
        .improvement.success {{ background: #d4edda; border-color: #28a745; }}
        .improvement.danger {{ background: #f8d7da; border-color: #dc3545; }}
        .chart-container {{ text-align: center; margin: 30px 0; }}
        .chart-container img {{ max-width: 100%; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        .footer {{ text-align: center; color: #7f8c8d; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }}
    </style>
</head>
<body>
    <div class="report-container">
        <h1>🛡️ 대드론 C2 시뮬레이션 실험 보고서</h1>
        <div class="meta">
            <p>📅 생성 시간: {summary['generated_at']}</p>
            <p>📊 분석 실험 수: {metrics['experiment_count']}회</p>
        </div>
        
        <h2>1. 실험 개요</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">{metrics['experiment_count']}</div>
                <div class="stat-label">총 실험 횟수</div>
            </div>
            <div class="stat-card info">
                <div class="stat-value">{metrics['drones']['total']}</div>
                <div class="stat-label">총 드론 수</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{metrics['drones']['hostile']}</div>
                <div class="stat-label">적대적 드론</div>
            </div>
            <div class="stat-card info">
                <div class="stat-value">{metrics['drones']['avg_per_experiment']}</div>
                <div class="stat-label">평균 드론/실험</div>
            </div>
        </div>
        
        <h2>2. 탐지 성능</h2>
        <div class="stats-grid">
            <div class="stat-card info">
                <div class="stat-value">{metrics['detection']['total_radar']:,}</div>
                <div class="stat-label">레이더 탐지</div>
            </div>
            <div class="stat-card {'info' if metrics['detection']['audio_model_active'] else 'warning'}">
                <div class="stat-value">{metrics['detection']['total_audio']}</div>
                <div class="stat-label">음향 탐지 {'(활성)' if metrics['detection']['audio_model_active'] else '(비활성)'}</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-value">{metrics['detection']['false_alarm_rate']}%</div>
                <div class="stat-label">오탐률</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{metrics['detection']['detection_delay'].get('mean', 0):.2f}s</div>
                <div class="stat-label">평균 탐지 지연</div>
            </div>
        </div>
        
        <h3>오탐 유형 분류</h3>
        <table>
            <tr><th>유형</th><th>횟수</th><th>설명</th></tr>
            <tr><td>객체 없음</td><td>{metrics['detection']['false_alarm_breakdown']['no_object']}</td><td>실제 드론이 없는데 탐지됨</td></tr>
            <tr><td>오분류</td><td>{metrics['detection']['false_alarm_breakdown']['misclassification']}</td><td>아군/중립을 적으로 분류</td></tr>
            <tr><td>추적 오류</td><td>{metrics['detection']['false_alarm_breakdown']['tracking_error']}</td><td>위치 오차 임계값 초과</td></tr>
        </table>
        
        <h3>탐지 지연 상세 통계</h3>
        <table>
            <tr><th>지표</th><th>탐지 지연</th><th>교전 지연</th></tr>
            <tr><td>평균</td><td>{metrics['detection']['detection_delay'].get('mean', 0):.3f}초</td><td>{metrics['engagement']['engagement_delay'].get('mean', 0):.3f}초</td></tr>
            <tr><td>중앙값</td><td>{metrics['detection']['detection_delay'].get('median', 0):.3f}초</td><td>{metrics['engagement']['engagement_delay'].get('median', 0):.3f}초</td></tr>
            <tr><td>표준편차</td><td>{metrics['detection']['detection_delay'].get('std', 0):.3f}초</td><td>{metrics['engagement']['engagement_delay'].get('std', 0):.3f}초</td></tr>
            <tr><td>최소</td><td>{metrics['detection']['detection_delay'].get('min_val', 0):.3f}초</td><td>{metrics['engagement']['engagement_delay'].get('min_val', 0):.3f}초</td></tr>
            <tr><td>최대</td><td>{metrics['detection']['detection_delay'].get('max_val', 0):.3f}초</td><td>{metrics['engagement']['engagement_delay'].get('max_val', 0):.3f}초</td></tr>
        </table>
        
        <h2>3. 교전 효율</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">{metrics['engagement']['total_commands']}</div>
                <div class="stat-label">교전 명령</div>
            </div>
            <div class="stat-card info">
                <div class="stat-value">{metrics['engagement']['engaged_ratio']}%</div>
                <div class="stat-label">교전 비율</div>
            </div>
        </div>
        
        <h2>4. 요격 성능</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">{metrics['interception']['total_attempts']}</div>
                <div class="stat-label">요격 시도</div>
            </div>
            <div class="stat-card success">
                <div class="stat-value">{metrics['interception']['successes']}</div>
                <div class="stat-label">요격 성공</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-value">{metrics['interception']['failures']}</div>
                <div class="stat-label">요격 실패</div>
            </div>
            <div class="stat-card {'success' if metrics['interception']['success_rate'] >= 50 else 'warning'}">
                <div class="stat-value">{metrics['interception']['success_rate']}%</div>
                <div class="stat-label">성공률</div>
            </div>
        </div>
        
        <h3>요격 실패 원인 분석</h3>
        <table>
            <tr><th>원인</th><th>횟수</th></tr>
            {''.join(f'<tr><td>{k}</td><td>{v}</td></tr>' for k, v in metrics['interception']['failure_reasons'].items() if v > 0)}
        </table>
        
        <h2>5. 드론 상태 요약</h2>
        <div class="stats-grid">
            <div class="stat-card info">
                <div class="stat-value">{metrics['drones']['detected']}</div>
                <div class="stat-label">탐지됨</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{metrics['drones']['engaged']}</div>
                <div class="stat-label">교전됨</div>
            </div>
            <div class="stat-card success">
                <div class="stat-value">{metrics['drones']['neutralized']}</div>
                <div class="stat-label">무력화</div>
            </div>
            <div class="stat-card success">
                <div class="stat-value">{metrics['interception']['neutralization_rate']}%</div>
                <div class="stat-label">무력화율</div>
            </div>
        </div>
        
        <h2>6. 이벤트 총계</h2>
        <table>
            <tr><th>이벤트 유형</th><th>발생 횟수</th></tr>
            {''.join(f'<tr><td>{k}</td><td>{v:,}</td></tr>' for k, v in sorted(metrics['event_totals'].items(), key=lambda x: x[1], reverse=True)[:10])}
        </table>
        
        <h2>7. 개선 포인트</h2>
        {''.join(f'<div class="improvement {"success" if "✅" in p else "danger" if "⚠️" in p else ""}">{p}</div>' for p in summary['improvement_points'])}
        
        <div class="chart-container">
            <h2>8. 시각화</h2>
            <img src="experiment_analysis.png" alt="분석 그래프" onerror="this.style.display='none'">
        </div>
        
        <div class="footer">
            <p>🛡️ 대드론 C2 시뮬레이터 자동 분석 보고서</p>
            <p>Generated by Counter-Drone C2 Simulator Analysis System</p>
        </div>
    </div>
</body>
</html>
"""
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"📄 HTML 보고서 저장: {output_path}")


def generate_full_report(log_dir: str = '../simulator/logs', output_dir: str = './reports'):
    """
    전체 보고서 생성 (그래프 + HTML)
    
    Args:
        log_dir: 로그 디렉토리
        output_dir: 출력 디렉토리
    """
    print("\n📋 보고서 생성 시작...\n")
    
    # 출력 디렉토리 생성
    os.makedirs(output_dir, exist_ok=True)
    
    # 데이터 로드 및 분석
    experiments = load_all_experiments(log_dir)
    if not experiments:
        print("⚠️ 분석할 데이터가 없습니다.")
        return
    
    summary = generate_summary(experiments)
    
    # 타임스탬프
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    # 그래프 생성
    if HAS_MATPLOTLIB:
        from plots import create_full_report_figure
        graph_path = os.path.join(output_dir, f'experiment_analysis.png')
        create_full_report_figure(summary['metrics'], graph_path)
    
    # HTML 보고서 생성
    html_path = os.path.join(output_dir, f'report_{timestamp}.html')
    generate_html_report(summary, html_path)
    
    # JSON 요약 저장
    json_path = os.path.join(output_dir, f'summary_{timestamp}.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"💾 JSON 요약 저장: {json_path}")
    
    print(f"\n✅ 보고서 생성 완료!")
    print(f"   📁 출력 폴더: {output_dir}")
    
    return summary


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='대드론 C2 실험 보고서 생성')
    parser.add_argument('--log-dir', '-l', default='../simulator/logs', help='로그 디렉토리')
    parser.add_argument('--output-dir', '-o', default='./reports', help='출력 디렉토리')
    args = parser.parse_args()
    
    generate_full_report(args.log_dir, args.output_dir)

