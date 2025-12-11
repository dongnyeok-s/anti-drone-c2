#!/bin/bash
# Full Evaluation + 논문용 Figures 자동 생성 스크립트

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "============================================================"
echo "  Full Evaluation + 논문용 Figures 자동 생성"
echo "============================================================"
echo ""

# 1. runtime_params.json 준비
echo "[1/5] runtime_params.json 준비 중..."
if [ ! -f "simulator/config/runtime_params.json" ]; then
    if [ -f "analysis/results/auto_tune_best_config.json" ]; then
        python3 -c "
import json
with open('analysis/results/auto_tune_best_config.json', 'r') as f:
    config = json.load(f)
with open('simulator/config/runtime_params.json', 'w') as f:
    json.dump(config['best_params'], f, indent=2)
"
        echo "  ✓ runtime_params.json 생성 완료"
    else
        echo "  ⚠ best_config.json이 없습니다. 기본값으로 진행합니다."
    fi
else
    echo "  ✓ runtime_params.json 이미 존재"
fi

# 2. Full Evaluation 실행
echo ""
echo "[2/5] Full Evaluation 실행 중..."
echo "  (예상 소요 시간: 1-2시간)"
cd analysis
python3 scripts/run_evaluation.py --profile full

# 3. 리포트 생성
echo ""
echo "[3/5] 논문용 리포트 및 Figure 생성 중..."
python3 scripts/generate_report.py --full

# 4. 완료 메시지
echo ""
echo "============================================================"
echo "  모든 작업 완료!"
echo "============================================================"
echo ""
echo "📁 생성된 파일:"
echo "  - 리포트: analysis/results/full_evaluation_summary.md"
echo "  - Metrics CSV: analysis/results/metrics_table.csv"
echo "  - 비교 CSV: analysis/results/fusion_vs_baseline_table.csv"
echo "  - Figures: analysis/figures/latest/"
echo ""

