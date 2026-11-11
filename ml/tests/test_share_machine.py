"""Tests of the rules that keep a long run from taking the owner's machine."""

import subprocess
import sys
from pathlib import Path

from triage_v2.share_machine import GPU_BUSY_PERCENT, core_mask, gpu_too_busy

ML_DIR = Path(__file__).resolve().parents[1]


def test_a_run_waits_while_the_gpu_is_busy_with_other_work():
    assert gpu_too_busy(GPU_BUSY_PERCENT) is True
    assert gpu_too_busy(GPU_BUSY_PERCENT - 1) is False


def test_a_run_waits_when_the_gpu_cannot_be_read():
    # A run that cannot see the load must not assume the machine is idle: that
    # assumption is how a run took the whole PC from the owner's other work.
    assert gpu_too_busy(None) is True


def test_the_core_limit_names_the_last_cores_and_never_more_than_exist():
    assert core_mask(32, 4) == 0b1111 << 28
    assert core_mask(2, 4) == 0b11
    assert core_mask(8, 1) == 1 << 7


def test_a_limited_process_can_run_on_no_more_cores_than_it_was_given():
    # A thread count asked of one library is not a limit: the tokenizer, the
    # export and the scorer each bring their own thread pool, and a run capped
    # that way still filled every core. The operating system's limit binds them all.
    # Run in a child process so the test runner itself is not limited.
    code = "from triage_v2.share_machine import allowed_cores, limit_cores; limit_cores(1); print(allowed_cores())"
    result = subprocess.run([sys.executable, "-c", code], cwd=ML_DIR, capture_output=True, text=True, timeout=60, check=True)
    assert result.stdout.strip() == "1"
