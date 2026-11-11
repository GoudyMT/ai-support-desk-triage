"""Tests of the rule that keeps a long run from starting on a busy machine."""

from triage_v2.share_machine import GPU_BUSY_PERCENT, gpu_too_busy


def test_a_run_waits_while_the_gpu_is_busy_with_other_work():
    assert gpu_too_busy(GPU_BUSY_PERCENT) is True
    assert gpu_too_busy(GPU_BUSY_PERCENT - 1) is False


def test_a_run_waits_when_the_gpu_cannot_be_read():
    # A run that cannot see the load must not assume the machine is idle: that
    # assumption is how a run took the whole PC from the owner's other work.
    assert gpu_too_busy(None) is True
