#!/usr/bin/env python3
"""Launch DuckHive TUI with proper PTY on macOS."""
import os, sys, select, signal, time

HELP_FLAGS = {'--help', '-h', '-help', '-?'}
QUICK_FLAGS = {'--version', '-v', '-V', '--version'}

# If just help/version, spawn TUI directly (no PTY needed)
if set(sys.argv[1:]) & HELP_FLAGS:
    tui = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tui', 'duckhive-tui')
    os.execvp(sys.executable, [sys.executable, tui] + sys.argv[1:])

def is_tty(fd):
    try:
        import fcntl, termios
        fcntl.ioctl(fd, termios.TIOCGWINSZ)
        return True
    except (OSError, AttributeError, ImportError):
        return False

def launch():
    tui = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tui', 'duckhive-tui')
    args = sys.argv[1:] if len(sys.argv) > 1 else []

    if not is_tty(sys.stdin.fileno() if hasattr(sys.stdin, 'fileno') and sys.stdin.fileno() >= 0 else -1):
        # Fallback: spawn without PTY relay (non-interactive env)
        os.execvp(tui, [tui] + args)
        return

    # Use PTY
    import pty
    pid, master = pty.fork()
    if pid == 0:
        os.execvp(tui, [tui] + args)
        return

    def write_all(fd, data):
        try: os.write(fd, data)
        except OSError: pass

    def read_all(fd, n=4096):
        try: return os.read(fd, n)
        except OSError: return b''

    while True:
        r, _, _ = select.select([master, sys.stdin], [], [], 0.1)
        if master in r:
            d = read_all(master)
            if d: sys.stdout.buffer.write(d)
            else: break
        if sys.stdin in r:
            try: d = os.read(sys.stdin.fileno(), 4096); write_all(master, d)
            except OSError: break
        # Check if child exited
        res = os.waitpid(pid, os.WNOHANG)
        if res[0] != 0: break

    # drain
    try:
        while True:
            r, _, _ = select.select([master], [], [], 0.5)
            if not r: break
            d = read_all(master)
            if not d: break
            sys.stdout.buffer.write(d)
    except: pass

    try: os.close(master)
    except: pass

    try: os.waitpid(pid, 0)
    except: pass

if __name__ == '__main__':
    launch()
