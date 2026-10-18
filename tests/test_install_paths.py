import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / 'tools/install_extension.py'
SPEC = importlib.util.spec_from_file_location('archsport_install_extension', MODULE_PATH)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class InstallPathTests(unittest.TestCase):
    def test_updates_supported_requires_gsettings_and_manager(self):
        with tempfile.TemporaryDirectory() as temp:
            manager = Path(temp) / 'org.gnome.Extensions.desktop'
            manager.touch()
            cases = (
                ('true', [manager], True),
                ('false', [manager], False),
                ('true', [manager.with_name('missing.desktop')], False),
                ('false', [manager.with_name('missing.desktop')], False),
            )
            for output, paths, expected in cases:
                with self.subTest(gsettings=output, manager=paths[0].exists()):
                    self.assertEqual(installer.updates_supported(output, paths), expected)

    def test_upgrade_destination_respects_support_and_direct_override(self):
        self.assertEqual(installer.choose_install_path(False), 'initial')
        self.assertEqual(installer.choose_install_path(True, upgrade=True, supported=True), 'staged')
        self.assertEqual(installer.choose_install_path(True, upgrade=True, supported=False), 'direct')
        self.assertEqual(installer.choose_install_path(True, upgrade=True, direct=True, supported=True), 'direct')
        self.assertEqual(installer.choose_install_path(True), 'refuse')

    @patch.object(installer.subprocess, 'run')
    def test_running_version_reads_cached_shell_version_and_state(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = 'archsport@local\n  Version: 7\n  State: ACTIVE\n'
        self.assertEqual(installer.running_version(command='gnome-extensions'), (7, 'ACTIVE'))

    @patch.object(installer.subprocess, 'run')
    def test_enable_extension_reports_command_success(self, run):
        run.return_value.returncode = 0
        self.assertTrue(installer.enable_extension(command='gnome-extensions'))
        run.assert_called_once()

    @patch.object(installer.subprocess, 'run')
    def test_enable_extension_reports_command_failure(self, run):
        run.return_value.returncode = 1
        self.assertFalse(installer.enable_extension(command='gnome-extensions'))

    @patch.object(installer, 'enable_extension', return_value=True)
    @patch.object(installer.subprocess, 'run')
    def test_direct_replacement_restores_old_files_and_active_state_on_failure(self, run, enable):
        run.return_value.returncode = 0
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / 'installed'
            target.mkdir()
            (target / 'old.txt').write_text('old', encoding='utf-8')
            staging = root / 'staging'
            staging.mkdir()
            (staging / 'new.txt').write_text('new', encoding='utf-8')
            parked = root / 'parked'
            rename = Path.rename

            def fail_staging(source, destination):
                if source == staging:
                    raise OSError('simulated replacement failure')
                return rename(source, destination)

            with patch.object(Path, 'rename', fail_staging):
                with self.assertRaises(OSError):
                    installer._replace_direct(staging, target, parked, True)
            self.assertEqual((target / 'old.txt').read_text(encoding='utf-8'), 'old')
            enable.assert_called_once()

    @patch.object(installer, 'enable_extension', return_value=True)
    @patch.object(installer.subprocess, 'run')
    def test_direct_replacement_aborts_if_extension_cannot_be_disabled(self, run, enable):
        run.return_value.returncode = 1
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / 'installed'
            target.mkdir()
            (target / 'old.txt').write_text('old', encoding='utf-8')
            staging = root / 'staging'
            staging.mkdir()
            with self.assertRaises(SystemExit):
                installer._replace_direct(staging, target, root / 'parked', True)
            self.assertEqual((target / 'old.txt').read_text(encoding='utf-8'), 'old')
            self.assertFalse((target / 'new.txt').exists())
            enable.assert_called_once()


if __name__ == '__main__':
    unittest.main()
