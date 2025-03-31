#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  COVERAGE_REPORT_PATH=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --coverage-report-path)     COVERAGE_REPORT_PATH="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  if [ "$COVERAGE_REPORT_PATH" = "" ]; then
    echo "Parameter 'coverage-report-path' is empty"; exit 1
  fi
  readonly COVERAGE_REPORT_PATH
  export COVERAGE_REPORT_PATH
}

main() {
  parse_args "$@"

  result=$(awk -F, 'NR>1 {
      total_missed_lines += $8;
      total_covered_lines += $9;

      total_missed_complexity += $10;
      total_covered_complexity += $11;
  }
  END {
      printf "\nTotal missed lines: %d\n", total_missed_lines;
      printf "\nTotal covered lines: %d\n", total_covered_lines;
      printf "\nTotal missed complexity: %d\n", total_missed_complexity;
      printf "\nTotal covered complexity: %d\n", total_covered_complexity;

      total_lines = total_missed_lines + total_covered_lines;
      printf "\nTotal lines: %d\n", total_lines;

      total_line_coverage = total_covered_lines/total_lines

      total_complexity = total_missed_complexity + total_covered_complexity;
      printf "\nTotal complexity: %d\n", total_complexity;
      total_complexity_coverage = total_covered_complexity/total_complexity

      total_coverage = ((total_covered_lines + total_covered_complexity) / (total_lines + total_complexity)) * 100;

      printf "%.2f", total_coverage;
      printf "\nTotal line coverage: %d\n", total_line_coverage;
      printf "\nTotal complexity coverage: %d\n", total_complexity_coverage;
}' "$COVERAGE_REPORT_PATH" | tee /dev/tty | tail -n 1)

  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "total_coverage=$result" >> "$GITHUB_OUTPUT"
  else
    echo "$result"
  fi
}

main "$@"
