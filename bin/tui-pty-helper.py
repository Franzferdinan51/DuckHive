#!/usr/bin/env python3
"""Launch DuckHive TUI with proper PTY on macOS.
Sets $TTY so Go's os.Open("/dev/tty") finds the PTY slave."""
import os, sys, select, pty

def launch():
    tui = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tui', 'duckhive-tui')
    args = sys.argv[1:] if len(sys.argv) > 1 else []

    pid, master = pty.fork()
    if pid == 0:
        # In the child, stdio now points at the PTY slave.
        slave_name = os.ttyname(0)
        os.environ['TTY'] = slave_name
        os.execvp(tui, [tui] + args)
        return

    # Parent relays stdin ↔ PTY master
    def relay():
        while True:
            r, _, _ = select.select([master, sys.stdin], [], [], 0.1)
            if master in r:
                d = os.read(master, 4096)
                if d:
                    sys.stdout.buffer.write(d)
                else:
                    break
            if sys.stdin in r:
                try:
                    d = os.read(sys.stdin.fileno(), 4096)
                    if d: os.write(master, d)
                except OSError:
                    break
            # Check child
            res = os.waitpid(pid, os.WNOHANG)
            if res[0] != 0: break

        # drain
        try:
            while True:
                r, _, _ = select.select([master], [], [], 0.5)
                if not r: break
                d = os.read(master, 4096)
                if not d: break
                sys.stdout.buffer.write(d)
        except: pass

        try: os.close(master)
        except: pass
        os.waitpid(pid, 0)

    relay()

if __name__ == '__main__':
    try: launch()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:
        sys.stderr.write(f'tui-pty-helper: {e}\n')
        sys.exit(1)
