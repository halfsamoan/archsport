import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class UiVersionTests(unittest.TestCase):
    def run_demo(self, version):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, XDG_STATE_HOME=directory)
            result = subprocess.run(
                [sys.executable, '-m', 'archsport', '--demo', '--once', '--ui-version', str(version)],
                cwd=ROOT, env=env, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_mismatched_extension_version_is_reported_without_stopping_worker(self):
        payload = self.run_demo(999)
        package = json.loads((ROOT / 'extension/metadata.json').read_text(encoding='utf-8'))['version']
        self.assertEqual(payload['ui_version_mismatch'], {'ui': 999, 'package': package})
        self.assertIn('확장 버전 불일치', payload['message'])

    def test_matching_extension_version_is_not_reported(self):
        package = json.loads((ROOT / 'extension/metadata.json').read_text(encoding='utf-8'))['version']
        payload = self.run_demo(package)
        self.assertNotIn('ui_version_mismatch', payload)


if __name__ == '__main__':
    unittest.main()
