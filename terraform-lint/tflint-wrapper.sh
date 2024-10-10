#!/usr/bin/env bash

###########################
# WIP WIP WIP WIP WIP WIP #
###########################

# Runs tflint for directories matching specific environment names
# If no environment is specified, the script runs on all environments.

# Default parameters


# this should be used to install tflint
tflint_version="v0.53.0"
min_depth=1
max_depth=3
base_dir="$(pwd)"
supported_envs="development|nonproduction|production|shared"
lint_failed=false
env=""

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
    --tflint-version)
        tflint_version="$2"
        shift # past argument
        shift # past value
        ;;
    --min-depth)
        min_depth="$2"
        shift
        shift
        ;;
    --max-depth)
        max_depth="$2"
        shift
        shift
        ;;
    --base-dir)
        base_dir="$2"
        shift
        shift
        ;;
    --environments)
        supported_envs="$2"
        supported_envs_regex="^(${supported_envs})$"
        shift
        shift
        ;;
    --help)
        echo "Usage: $0 [environment] [options]"
        echo "Options:"
        echo "  --tf-version <version>       (string) Unused for now."
        echo "  --min-depth <depth>          (optional, default 1) Mapped to find command."
        echo "  --max-depth <depth>          (optional, default 3) Mapped to find command."
        echo "  --base-dir <directory>       (optional, default current directory) Mapped to find command."
        echo "  --environments <envs>        (optional, default \"development|nonproduction|production|shared\")"
        exit 0
        ;;
    --*)
        echo "Unknown option: $1"
        exit 1
        ;;
    *)
        # Positional argument (environment)
        if [[ -z "$env" ]]; then
            env="$1"
            shift
        else
            echo "Unknown argument: $1"
            exit 1
        fi
        ;;
    esac
done

echo "tflint version: $tflint_version"

# Generate the regex from supported environments
supported_envs_regex="^(${supported_envs})$"

# Check if an environment is specified or run on all by default
if [[ -z "$env" ]]; then
    run_all=true
elif [[ "$env" =~ $supported_envs_regex ]]; then
    run_all=false
else
    echo "Invalid environment specified: $env"
    echo "Supported environments: $supported_envs"
    exit 1
fi

# Function to determine if a directory should be linted
should_lint() {
    local leaf
    leaf="$(basename "$1")"
    if [[ "$run_all" == true ]]; then
        [[ "$leaf" =~ $supported_envs_regex ]]
    else
        [[ "$leaf" == "$env" ]] || { [[ "$leaf" == "shared" ]] && [[ "$env" == "production" ]]; }
    fi
}

# Function to run tflint for a single environment
lint() {
    local path="$1"
    local tf_env="${path#"$base_dir"/}"
    echo "*************** TFLINT *****************"
    echo "      Environment: ${tf_env}"
    echo "****************************************"
    if [[ -d "$path" ]]; then
        echo "LINTING: ${path}"
        if ! tflint --chdir "$path"; then
            echo "ERROR: Linting failed for ${path}"
            lint_failed=true
        fi
    else
        echo "ERROR: ${path} does not exist"
        lint_failed=true
    fi
}

# Find directories to lint at the specified depth and lint them
find "$base_dir" \
    -path "$base_dir/modules" -prune -o \
    -path "$base_dir/.git" -prune -o \
    -path "$base_dir/.terraform" -prune -o \
    -mindepth "$min_depth" -maxdepth "$max_depth" -type d -print0 |
    while IFS= read -r -d '' dir; do
        if should_lint "$dir"; then
            lint "$dir"
        fi
    done

# Check if any linting failed and exit with appropriate status
if [[ "$lint_failed" == true ]]; then
    echo "One or more environments failed linting."
    exit 1
fi
