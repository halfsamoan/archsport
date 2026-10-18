import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class WorkerLockTests(unittest.TestCase):
    def test_second_live_worker_exits_before_opening_state_database(self):
        with tempfile.TemporaryDirectory() as directory:
            state_dir = Path(directory) / 'state'
            state_dir.mkdir()
            lock_path = state_dir / 'worker.lock'
            with lock_path.open('a+b') as lock:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                env = dict(os.environ, XDG_STATE_HOME=directory)
                result = subprocess.run(
                    [sys.executable, '-m', 'archsport', '--mode', 'live', '--once',
                     '--state-dir', str(state_dir)], cwd=ROOT, env=env,
                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 3)
            payload = json.loads(result.stdout)
            self.assertEqual(payload['code'], 'WORKER_ALREADY_RUNNING')
            self.assertFalse((state_dir / 'state.db').exists())


if __name__ == '__main__':
    unittest.main()
