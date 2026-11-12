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
# A memory cap does not stop a run from taking all of the GPU's time. Resting
# after each training step for as long as the step took leaves the GPU free
# about half the time.
GPU_REST_RATIO = 1.0
GPU_BUSY_PERCENT = 50
BUSY_ERROR = "E_MACHINE_BUSY"
LIMIT_ERROR = "E_LIMIT_NOT_SET"
WINDOWS_BELOW_NORMAL = 0x00004000
WINDOWS_IDLE = 0x00000040
WINDOWS_LOWERED = (WINDOWS_BELOW_NORMAL, WINDOWS_IDLE)
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


def _kernel():
    """Returns Windows' process functions with their real argument and return types."""
    # Without these types ctypes reads the process handle as a 32-bit number,
    # which is not a valid handle, and every call below fails without an error.
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    kernel.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel.GetPriorityClass.argtypes = [ctypes.c_void_p]
    kernel.GetPriorityClass.restype = ctypes.c_uint32
    kernel.SetProcessAffinityMask.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    kernel.GetProcessAffinityMask.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t)]
    return kernel


def _ask_for_lower_priority():
    """Asks the operating system to serve every other program before this one."""
    if sys.platform == "win32":
        kernel = _kernel()
        kernel.SetPriorityClass(kernel.GetCurrentProcess(), WINDOWS_BELOW_NORMAL)
    else:
        os.nice(UNIX_NICE_STEP)


def priority_is_lowered():
    """Returns whether the operating system now serves other programs before this one."""
    if sys.platform == "win32":
        kernel = _kernel()
        return kernel.GetPriorityClass(kernel.GetCurrentProcess()) in WINDOWS_LOWERED
    return os.nice(0) >= UNIX_NICE_STEP


def lower_priority():
    """
    Lowers this process's priority and proves that it took.

    Raises:
        SystemExit: The priority read back is not a lowered one (E_LIMIT_NOT_SET).
            A run that only believes it is limited is how the owner was told
            "below normal" about runs at normal priority.
    """
    _ask_for_lower_priority()
    if not priority_is_lowered():
        raise SystemExit(LIMIT_ERROR)


def core_mask(total_cores, wanted):
    """
    Returns the bit mask of the cores a limited process may run on.

    The last cores are chosen, never more than the machine has, so the first
    cores, which programs reach for by default, stay free.

    Args:
        total_cores: How many logical cores the machine has.
        wanted: How many the process may use.

    Returns:
        An integer with one bit set per allowed core.
    """
    count = min(wanted, total_cores)
    return ((1 << count) - 1) << (total_cores - count)


def _ask_for_cores(mask, total):
    """Asks the operating system to keep this process on the cores in the mask."""
    if sys.platform == "win32":
        kernel = _kernel()
        kernel.SetProcessAffinityMask(kernel.GetCurrentProcess(), mask)
    else:
        os.sched_setaffinity(0, {core for core in range(total) if mask >> core & 1})


def allowed_cores():
    """Returns how many logical cores this process may run on."""
    if sys.platform == "win32":
        kernel = _kernel()
        process_mask, system_mask = ctypes.c_size_t(), ctypes.c_size_t()
        kernel.GetProcessAffinityMask(kernel.GetCurrentProcess(), ctypes.byref(process_mask), ctypes.byref(system_mask))
        return bin(process_mask.value).count("1")
    return len(os.sched_getaffinity(0))


def limit_cores(wanted=CPU_THREADS):
    """
    Binds this whole process, every library and thread pool in it, to a few cores.

    Args:
        wanted: How many logical cores the process may use.

    Raises:
        SystemExit: The process may still run on more cores than asked (E_LIMIT_NOT_SET).
    """
    total = os.cpu_count() or 1
    _ask_for_cores(core_mask(total, wanted), total)
    if not 0 < allowed_cores() <= min(wanted, total):
        raise SystemExit(LIMIT_ERROR)


def limit_cpu():
    """Lowers the priority and binds the cores; for a run that uses no GPU."""
    lower_priority()
    limit_cores()


def share_the_machine(force=False):
    """
    Caps this process before a long run, or stops it when the GPU is busy.

    It lowers the process priority, binds the process to a few CPU cores, limits
    PyTorch to part of the GPU's memory, and returns the CPU thread cap.

    Args:
        force: The owner's override; start even when the GPU is busy.

    Returns:
        The number of CPU threads the caller may use.

    Raises:
        SystemExit: The GPU is busy and `force` is not set (E_MACHINE_BUSY), or
            a limit did not take (E_LIMIT_NOT_SET).
    """
    used = read_gpu_percent()
    if gpu_too_busy(used) and not force:
        print(f"    GPU in use: {used}% (limit {GPU_BUSY_PERCENT}%). Not starting; pass --force only on the owner's word.")
        raise SystemExit(BUSY_ERROR)
    limit_cpu()
    import torch

    torch.set_num_threads(CPU_THREADS)
    if torch.cuda.is_available():
        torch.cuda.set_per_process_memory_fraction(GPU_MEMORY_SHARE)
    return CPU_THREADS
