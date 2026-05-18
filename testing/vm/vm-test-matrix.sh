#!/bin/bash
# Run extension tests across all VMs in the test matrix and generate
# an HTML comparison report with screenshots.
#
# Usage: vm-test-matrix.sh [OPTIONS]
#
# Options:
#   --label LABEL      Label for this test run (default: git branch or "test")
#   --baseline LABEL   Compare against this previous label's screenshots
#   --create           Create missing VMs before testing
#   --no-restore       Skip snapshot restore (faster, uses current VM state)
#   --vm NAME          Test only this VM (can be repeated)
#   --presets           After deploy, screenshot each config preset
#   --preset NAME       Add a specific preset (can be repeated; implies --presets)
#
# Output:
#   testing/vm/results/<label>/           Per-VM screenshots and logs
#   testing/vm/results/<label>/report.html  HTML comparison report

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/lib/vm-common.sh"

# --- Argument parsing ---
LABEL=""
BASELINE=""
CREATE=false
NO_RESTORE=false
SELECTED_VMS=()
USE_PRESETS=false
SELECTED_PRESETS=()
CONFIGS_DIR="$SCRIPT_DIR/configs"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --label) LABEL="$2"; shift 2 ;;
        --baseline) BASELINE="$2"; shift 2 ;;
        --create) CREATE=true; shift ;;
        --no-restore) NO_RESTORE=true; shift ;;
        --vm) SELECTED_VMS+=("$2"); shift 2 ;;
        --presets) USE_PRESETS=true; shift ;;
        --preset) USE_PRESETS=true; SELECTED_PRESETS+=("$2"); shift 2 ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Run tests across all VMs and generate HTML comparison report."
            echo ""
            echo "Options:"
            echo "  --label LABEL      Label for this run (default: git branch)"
            echo "  --baseline LABEL   Compare against this label's screenshots"
            echo "  --create           Create missing VMs"
            echo "  --no-restore       Skip snapshot restore"
            echo "  --vm NAME          Test only specific VM (repeatable)"
            echo "  --presets          Screenshot each config preset per VM"
            echo "  --preset NAME      Add a specific preset (repeatable; implies --presets)"
            echo ""
            echo "Examples:"
            echo "  $0 --label master-baseline"
            echo "  $0 --label pr138 --baseline master-baseline"
            echo "  $0 --label pr138 --baseline master-baseline --vm gssmn-fedora42"
            echo "  $0 --label visual --presets"
            echo "  $0 --label visual --preset all-visible --preset digit-only"
            exit 0
            ;;
        *) log_error "Unknown option: $1"; exit 2 ;;
    esac
done

# Default label from git branch
if [[ -z "$LABEL" ]]; then
    LABEL=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "test")
    LABEL=$(echo "$LABEL" | tr '/' '-')
fi

# Determine which VMs to test
if [[ ${#SELECTED_VMS[@]} -gt 0 ]]; then
    VM_NAMES=("${SELECTED_VMS[@]}")
else
    readarray -t VM_NAMES < <(vm_list_names)
fi

# Determine which presets to use
PRESET_NAMES=()
if $USE_PRESETS; then
    if [[ ${#SELECTED_PRESETS[@]} -gt 0 ]]; then
        PRESET_NAMES=("${SELECTED_PRESETS[@]}")
    else
        for f in "$CONFIGS_DIR"/*.json; do
            [[ -f "$f" ]] && PRESET_NAMES+=("$(basename "$f" .json)")
        done
    fi
fi

# Create output directory for this run
RUN_DIR="$RESULTS_DIR/$LABEL"
mkdir -p "$RUN_DIR"

echo ""
log_info "============================================"
log_info "Test Matrix Run: $LABEL"
log_info "VMs: ${VM_NAMES[*]}"
if [[ ${#PRESET_NAMES[@]} -gt 0 ]]; then
    log_info "Presets: ${PRESET_NAMES[*]}"
fi
if [[ -n "$BASELINE" ]]; then
    log_info "Comparing against: $BASELINE"
fi
log_info "============================================"

# --- Run tests ---
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
declare -A RESULTS  # vm_name -> PASS|FAIL|SKIP
declare -A SCREENSHOTS  # vm_name -> screenshot path
declare -A LOGFILES  # vm_name -> log path
declare -A GNOME_VERSIONS  # vm_name -> gnome version
declare -A DURATIONS  # vm_name -> duration

for vm_name in "${VM_NAMES[@]}"; do
    vm_parse_config "$vm_name"
    GNOME_VERSIONS[$vm_name]="$VM_GNOME_VERSION"

    echo ""
    log_info "------------------------------------------"
    log_info "Testing: $vm_name (GNOME $VM_GNOME_VERSION)"
    log_info "------------------------------------------"

    # Check if VM exists
    if ! vm_exists "$vm_name"; then
        if $CREATE; then
            log_info "Creating VM '$vm_name'..."
            "$SCRIPT_DIR/vm-create.sh" --vm "$vm_name"
        else
            log_warn "VM '$vm_name' does not exist, skipping (use --create)"
            RESULTS[$vm_name]="SKIP"
            SKIP_COUNT=$((SKIP_COUNT + 1))
            continue
        fi
    fi

    # Build test args
    TEST_ARGS=(--vm "$vm_name" --label "$LABEL")
    if $NO_RESTORE; then
        TEST_ARGS+=(--no-restore)
    fi

    # Run the test
    START_TIME=$(date +%s)
    if "$SCRIPT_DIR/vm-test.sh" "${TEST_ARGS[@]}" 2>&1 | tee "$RUN_DIR/${vm_name}.output"; then
        RESULTS[$vm_name]="PASS"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        RESULTS[$vm_name]="FAIL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
    END_TIME=$(date +%s)
    DURATIONS[$vm_name]=$((END_TIME - START_TIME))

    # Find the screenshot and log from this run
    SCREENSHOTS[$vm_name]=$(ls -t "$RESULTS_DIR"/${vm_name}_${LABEL}_*.png 2>/dev/null | head -1 || echo "")
    LOGFILES[$vm_name]=$(ls -t "$RESULTS_DIR"/${vm_name}_${LABEL}_*.log 2>/dev/null | head -1 || echo "")

    # Copy screenshot into the run directory for easy access
    if [[ -n "${SCREENSHOTS[$vm_name]}" && -f "${SCREENSHOTS[$vm_name]}" ]]; then
        cp "${SCREENSHOTS[$vm_name]}" "$RUN_DIR/${vm_name}.png"
    fi
    if [[ -n "${LOGFILES[$vm_name]}" && -f "${LOGFILES[$vm_name]}" ]]; then
        cp "${LOGFILES[$vm_name]}" "$RUN_DIR/${vm_name}.log"
    fi

    # Run preset configs if requested
    if [[ ${#PRESET_NAMES[@]} -gt 0 && "${RESULTS[$vm_name]}" == "PASS" ]]; then
        source "$SCRIPT_DIR/lib/vm-screenshot.sh"
        for preset in "${PRESET_NAMES[@]}"; do
            log_info "  Preset: $preset"
            "$SCRIPT_DIR/vm-config.sh" --vm "$vm_name" --preset "$preset" 2>&1 | sed 's/^/    /'
            sleep 3
            local_screenshot=$(take_screenshot "$vm_name" "${LABEL}-${preset}")
            if [[ -n "$local_screenshot" && -f "$local_screenshot" ]]; then
                cp "$local_screenshot" "$RUN_DIR/${vm_name}_${preset}.png"
            fi
        done
    fi
done

# --- Generate HTML report ---
REPORT="$RUN_DIR/report.html"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
GIT_REF=$(git -C "$PROJECT_ROOT" log --oneline -1 2>/dev/null || echo "unknown")

cat > "$REPORT" << 'HTMLHEAD'
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>VM Test Matrix Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; background: #f5f5f5; }
  h1 { color: #333; }
  .meta { color: #666; margin-bottom: 20px; }
  .summary { display: flex; gap: 20px; margin-bottom: 30px; }
  .summary-card { padding: 15px 25px; border-radius: 8px; color: white; font-size: 1.2em; }
  .pass { background: #2ea043; }
  .fail { background: #cf222e; }
  .skip { background: #888; }
  .vm-card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .vm-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
  .vm-title { font-size: 1.3em; font-weight: bold; }
  .badge { padding: 4px 12px; border-radius: 12px; color: white; font-size: 0.85em; }
  .screenshots { display: flex; gap: 20px; flex-wrap: wrap; }
  .screenshot-box { flex: 1; min-width: 300px; }
  .screenshot-box img { width: 100%; border: 1px solid #ddd; border-radius: 4px; }
  .screenshot-box .caption { text-align: center; color: #666; margin-top: 5px; font-size: 0.9em; }
  .log-preview { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 0.85em; max-height: 200px; overflow-y: auto; white-space: pre-wrap; margin-top: 10px; }
  .duration { color: #888; font-size: 0.9em; }
</style>
</head>
<body>
HTMLHEAD

cat >> "$REPORT" << EOF
<h1>VM Test Matrix Report</h1>
<div class="meta">
  <strong>Label:</strong> $LABEL<br>
  <strong>Git:</strong> $GIT_REF<br>
  <strong>Date:</strong> $TIMESTAMP<br>
EOF

if [[ -n "$BASELINE" ]]; then
    echo "  <strong>Baseline:</strong> $BASELINE<br>" >> "$REPORT"
fi

cat >> "$REPORT" << EOF
</div>

<div class="summary">
  <div class="summary-card pass">$PASS_COUNT PASS</div>
  <div class="summary-card fail">$FAIL_COUNT FAIL</div>
  <div class="summary-card skip">$SKIP_COUNT SKIP</div>
</div>
EOF

# Per-VM cards
for vm_name in "${VM_NAMES[@]}"; do
    result="${RESULTS[$vm_name]:-SKIP}"
    gnome_ver="${GNOME_VERSIONS[$vm_name]:-?}"
    duration="${DURATIONS[$vm_name]:-0}"

    badge_class="skip"
    [[ "$result" == "PASS" ]] && badge_class="pass"
    [[ "$result" == "FAIL" ]] && badge_class="fail"

    cat >> "$REPORT" << EOF
<div class="vm-card">
  <div class="vm-header">
    <span class="vm-title">$vm_name <span style="color:#888; font-weight:normal;">(GNOME $gnome_ver)</span></span>
    <span>
      <span class="badge $badge_class">$result</span>
      <span class="duration">${duration}s</span>
    </span>
  </div>
  <div class="screenshots">
EOF

    # Baseline screenshot (if available)
    if [[ -n "$BASELINE" ]]; then
        baseline_png="$RESULTS_DIR/$BASELINE/${vm_name}.png"
        if [[ -f "$baseline_png" ]]; then
            # Use relative path from report location
            cat >> "$REPORT" << EOF
    <div class="screenshot-box">
      <img src="../$BASELINE/${vm_name}.png" alt="Baseline">
      <div class="caption">Baseline ($BASELINE)</div>
    </div>
EOF
        else
            cat >> "$REPORT" << EOF
    <div class="screenshot-box">
      <div style="padding:40px;text-align:center;color:#999;border:1px dashed #ddd;border-radius:4px;">No baseline screenshot</div>
      <div class="caption">Baseline ($BASELINE)</div>
    </div>
EOF
        fi
    fi

    # Current screenshot
    current_png="$RUN_DIR/${vm_name}.png"
    if [[ -f "$current_png" ]]; then
        cat >> "$REPORT" << EOF
    <div class="screenshot-box">
      <img src="${vm_name}.png" alt="Current">
      <div class="caption">Current ($LABEL)</div>
    </div>
EOF
    else
        cat >> "$REPORT" << EOF
    <div class="screenshot-box">
      <div style="padding:40px;text-align:center;color:#999;border:1px dashed #ddd;border-radius:4px;">No screenshot</div>
      <div class="caption">Current ($LABEL)</div>
    </div>
EOF
    fi

    # Preset screenshots
    if [[ ${#PRESET_NAMES[@]} -gt 0 ]]; then
        for preset in "${PRESET_NAMES[@]}"; do
            preset_png="$RUN_DIR/${vm_name}_${preset}.png"
            if [[ -f "$preset_png" ]]; then
                cat >> "$REPORT" << EOF
    <div class="screenshot-box">
      <img src="${vm_name}_${preset}.png" alt="$preset">
      <div class="caption">$preset</div>
    </div>
EOF
            fi
        done
    fi

    echo "  </div>" >> "$REPORT"

    # Log preview
    log_file="$RUN_DIR/${vm_name}.log"
    if [[ -f "$log_file" ]]; then
        log_content=$(head -30 "$log_file" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
        cat >> "$REPORT" << EOF
  <div class="log-preview">$log_content</div>
EOF
    fi

    echo "</div>" >> "$REPORT"
done

cat >> "$REPORT" << 'HTMLFOOT'
</body>
</html>
HTMLFOOT

log_ok "Report saved: $REPORT"

# --- Summary ---
echo ""
echo "============================================"
echo "Test Matrix Results: $LABEL"
echo "============================================"
for vm_name in "${VM_NAMES[@]}"; do
    result="${RESULTS[$vm_name]:-SKIP}"
    gnome_ver="${GNOME_VERSIONS[$vm_name]:-?}"
    duration="${DURATIONS[$vm_name]:-0}"
    printf "  %-20s GNOME %-3s %s (%ss)\n" "$vm_name" "$gnome_ver" "$result" "$duration"
done
echo ""
echo "Pass: $PASS_COUNT  Fail: $FAIL_COUNT  Skip: $SKIP_COUNT"
echo "Report: $REPORT"
echo ""

# Exit with failure if any tests failed
[[ $FAIL_COUNT -eq 0 ]]
