"""Tests of the rules that keep a long run from taking the owner's machine."""

import subprocess
import sys
from pathlib import Path

import pytest

from triage_v2 import share_machine
from triage_v2.share_machine import BUSY_ERROR, GPU_BUSY_PERCENT, LIMIT_ERROR, core_mask, gpu_too_busy

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


def run_child(code):
    """Runs share_machine code in a child process, so the test runner keeps its own limits."""
    return subprocess.run([sys.executable, "-c", code], cwd=ML_DIR, capture_output=True, text=True, timeout=60)


def test_a_lowered_process_reads_back_as_lowered():
    # The first version called the Windows priority function with a broken
    # handle and never looked at the answer: runs were reported as below normal
    # while they ran at normal priority. The priority is now read back.
    before = run_child("from triage_v2.share_machine import priority_is_lowered; print(priority_is_lowered())")
    after = run_child("from triage_v2.share_machine import lower_priority, priority_is_lowered; lower_priority(); print(priority_is_lowered())")
    assert before.stdout.strip() == "False"
    assert after.stdout.strip() == "True"


def test_a_run_stops_when_the_priority_did_not_change(monkeypatch):
    monkeypatch.setattr(share_machine, "priority_is_lowered", lambda: False)
    monkeypatch.setattr(share_machine, "_ask_for_lower_priority", lambda: None)
    with pytest.raises(SystemExit) as stop:
        share_machine.lower_priority()
    assert stop.value.code == LIMIT_ERROR


def test_a_run_stops_when_the_core_limit_did_not_take(monkeypatch):
    monkeypatch.setattr(share_machine, "_ask_for_cores", lambda mask, total: None)
    monkeypatch.setattr(share_machine, "allowed_cores", lambda: 32)
    with pytest.raises(SystemExit) as stop:
        share_machine.limit_cores(4)
    assert stop.value.code == LIMIT_ERROR


def test_a_busy_gpu_stops_the_run_before_any_limit_is_set(monkeypatch):
    touched = []
    monkeypatch.setattr(share_machine, "read_gpu_percent", lambda: GPU_BUSY_PERCENT)
    monkeypatch.setattr(share_machine, "limit_cpu", lambda: touched.append("cpu"))
    with pytest.raises(SystemExit) as stop:
        share_machine.share_the_machine()
    assert stop.value.code == BUSY_ERROR
    assert touched == []


def test_one_spike_does_not_stop_a_run_but_a_busy_middle_sample_does():
    # A single reading caught the GPU mid-spike or mid-pause; the middle of three does not.
    assert share_machine.machine_too_busy([10, 20, 95], [5, 5, 5]) is False
    assert share_machine.machine_too_busy([10, GPU_BUSY_PERCENT, 95], [5, 5, 5]) is True


def test_a_busy_cpu_stops_a_run_too():
    # The PC crashed when a run took every core while the GPU had room; the CPU counts as well.
    limit = share_machine.CPU_BUSY_PERCENT
    assert share_machine.machine_too_busy([5, 5, 5], [limit - 1, limit, limit + 3]) is True
    assert share_machine.machine_too_busy([5, 5, 5], [limit - 1, limit - 1, limit + 3]) is False


def test_an_unreadable_sample_stops_a_run():
    assert share_machine.machine_too_busy([5, None, 5], [5, 5, 5]) is True
    assert share_machine.machine_too_busy([5, 5, 5], [5, 5, None]) is True


def test_the_check_reads_the_machine_three_times(monkeypatch):
    reads = []
    monkeypatch.setattr(share_machine, "read_gpu_percent", lambda: reads.append("gpu") or 90)
    monkeypatch.setattr(share_machine, "read_cpu_percent", lambda: reads.append("cpu") or 5)
    with pytest.raises(SystemExit) as stop:
        share_machine.share_the_machine()
    assert stop.value.code == BUSY_ERROR
    assert reads.count("gpu") == 3 and reads.count("cpu") == 3


def test_the_cpu_load_reads_as_a_share_of_the_machine():
    used = share_machine.read_cpu_percent()
    assert used is not None and 0 <= used <= 100


def test_a_gpu_tool_that_fails_reads_as_unknown_not_as_idle(monkeypatch):
    def missing(*args, **kwargs):
        raise OSError("no such tool")

    monkeypatch.setattr(share_machine.subprocess, "run", missing)
    assert share_machine.read_gpu_percent() is None
