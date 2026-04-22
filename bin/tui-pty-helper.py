#!/usr/bin/env python3
"""Launch DuckHive TUI with proper PTY on macOS."""
import os, sys, select, pty, fcntl, termios

# Ensure ALL output is unbuffered and goes to stderr
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)  # line buffered
os.environ['PYTHONUNBUFFERED'] = '1'

def is_tty(fd):
    try:
        fcntl.ioctl(fd, termios.TIOCGWINSZ)
        return True
    except OSError:
        return False

def launch():
    tui = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tui', 'duckhive-tui')
    args = sys.argv[1:] if len(sys.argv) > 1 else []

    stdin_fd = sys.stdin.fileno() if hasattr(sys.stdin, 'fileno') else -1

    if stdin_fd >= 0 and not is_tty(stdin_fd):
        # Not a real TTY — just exec directly
        os.execvp(tui, [tui] + args)
        return

    pid, master = pty.fork()
    if pid == 0:
        # Child: stdin/stdout/slave are connected via PTY
        slave = os.ttyname(master)
        os.environ['TTY'] = slave
        os.close(master)
        os.execvp(tui, [tui] + args)
        return

    # Parent: relay stdin ↔ PTY master
    try:
        while True:
            r, _, _ = select.select([master, sys.stdin], [], [], 0.1)
            if master in r:
                try:
                    d = os.read(master, 4096)
                    if d:
                        os.write(sys.stdout.fileno(), d)
                        os.fsync(sys.stdout.fileno())
                    else:
                        break
                except OSError:
                    break
            if sys.stdin in r:
                try:
                    d = os.read(sys.stdin.fileno(), 4096)
                    if d:
                        os.write(master, d)
                        os.fsync(master)
                except OSError:
                    break
            res = os.waitpid(pid, os.WNOHANG)
            if res[0] != 0:
                break
    finally:
        try: os.close(master)
        except: pass
        os.waitpid(pid, 0)

if __name__ == '__main__':
    try: launch()
    except KeyboardInterrupt: sys.exit(130)
    except Exception as e:
        sys.stderr.write(f'tui-pty-helper: {e}\n')
        sys.exit(1)
