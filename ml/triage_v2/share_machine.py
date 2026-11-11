"""Keeping a training or scoring run from taking the whole computer.

The owner's PC runs other work beside this project. A run that takes every CPU core and
all of the GPU starves that work, and has crashed the machine. Every long run calls
`share_the_machine` first, and refuses to start while the GPU is already busy.
"""

import ctypes
import os
import subprocess
import sys

CPU_THREADS = 4
GPU_MEMORY_SHARE = 0.4
GPU_BUSY_PERCENT = 50
BUSY_ERROR = "E_MACHINE_BUSY"
WINDOWS_BELOW_NORMAL = 0x00004000
UNIX_NICE_STEP = 10


def gpu_too_busy(used_percent, limit=GPU_BUSY_PERCENT):
    """
    Says whether the GPU is already doing enough other work that a run must wait.

    Args:
        used_percent: The GPU's current use in percent, or None when it could not be read.
        limit: The use at or above which a run waits.

    Returns:
        True when the run must not start. An unreadable GPU counts as busy: a run
        that cannot see the machine's load does not get to assume it is idle.
    """
    return used_percent is None or used_percent >= limit


def read_gpu_percent():
    """Returns the GPU's current use in percent, or None when nvidia-smi cannot say."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=15, check=True,
        )
        return int(result.stdout.strip().splitlines()[0])
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def lower_priority():
    """Tells the operating system to serve every other program before this one."""
    if sys.platform == "win32":
        kernel = ctypes.windll.kernel32
        kernel.SetPriorityClass(kernel.GetCurrentProcess(), WINDOWS_BELOW_NORMAL)
    else:
        os.nice(UNIX_NICE_STEP)


def share_the_machine(force=False):
    """
    Caps this process before a long run, or stops it when the GPU is busy.

    It lowers the process priority, limits PyTorch to a few CPU threads and to
    part of the GPU's memory, and returns the CPU thread cap for the scorer.

    Args:
        force: The owner's override; start even when the GPU is busy.

    Returns:
        The number of CPU threads the caller may use.

    Raises:
        SystemExit: The GPU is busy and `force` is not set (E_MACHINE_BUSY).
    """
    used = read_gpu_percent()
    if gpu_too_busy(used) and not force:
        print(f"    GPU in use: {used}% (limit {GPU_BUSY_PERCENT}%). Not starting; pass --force only on the owner's word.")
        raise SystemExit(BUSY_ERROR)
    lower_priority()
    import torch

    torch.set_num_threads(CPU_THREADS)
    if torch.cuda.is_available():
        torch.cuda.set_per_process_memory_fraction(GPU_MEMORY_SHARE)
    return CPU_THREADS
