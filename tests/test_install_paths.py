import importlib.util
from pathlib import Path
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / 'tools/install_extension.py'
SPEC = importlib.util.spec_from_file_location('archsport_install_extension', MODULE_PATH)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class InstallPathTests(unittest.TestCase):
    def test_schema_compile_failure_removes_staging_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source'
            parent = root / 'extensions'
            parent.mkdir()
            (source / 'extension/schemas').mkdir(parents=True)
            (source / 'extension/metadata.json').write_text(
                json.dumps({'uuid': installer.UUID}), encoding='utf-8')
            (source / 'archsport').mkdir()
            (source / 'web/assets/logos').mkdir(parents=True)
            (source / 'data').mkdir()
            with patch.object(installer.subprocess, 'run',
                              side_effect=subprocess.CalledProcessError(1, 'glib-compile-schemas')):
                with self.assertRaises(subprocess.CalledProcessError):
                    installer.prepare_staging(source, parent, 'glib-compile-schemas')
            self.assertEqual(list(parent.glob('.archsport-stage-*')), [])

    def test_pruning_sixth_backup_removes_oldest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for index in range(6):
                (root / f'extension-{index:02d}').mkdir()
            installer.prune_backups(root)
            self.assertFalse((root / 'extension-00').exists())
            self.assertEqual(len(list(root.glob('extension-*'))), 5)

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
    @patch.object(installer, 'running_version')
    def test_direct_replacement_restores_old_files_on_failure_without_toggling(self, running, run):
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
                    installer._replace_direct(staging, target, parked)
            self.assertEqual((target / 'old.txt').read_text(encoding='utf-8'), 'old')
            run.assert_not_called()
            running.assert_not_called()

    @patch.object(installer.subprocess, 'run')
    def test_direct_replacement_does_not_toggle_extension(self, run):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / 'installed'
            target.mkdir()
            (target / 'old.txt').write_text('old', encoding='utf-8')
            staging = root / 'staging'
            staging.mkdir()
            (staging / 'new.txt').write_text('new', encoding='utf-8')
            installer._replace_direct(staging, target, root / 'parked')
            self.assertEqual((target / 'new.txt').read_text(encoding='utf-8'), 'new')
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
