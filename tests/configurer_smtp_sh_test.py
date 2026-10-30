"""Simulations locales : aucun service, réseau ni secret réel."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('smtp_sh', Path(__file__).resolve().parents[1] / 'scripts/configurer-smtp-sh.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SMTPTest(unittest.TestCase):
    def test_atomic_metadata_and_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / '.env'
            config.write_bytes(b'original')
            for mode in (0o640, 0o600, 0o644):
                os.chmod(config, mode)
                before = config.stat()
                with patch.object(m, 'CONFIG', config):
                    for data in (b'new', b'original'):
                        m.write_atomic(data, before)
                        after = config.stat()
                        self.assertEqual(config.read_bytes(), data)
                        self.assertEqual((after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode)),
                                         (before.st_uid, before.st_gid, mode))
                self.assertEqual(list(Path(tmp).iterdir()), [config])

    def simulate(self, group='', fail_restart=False, override=None):
        with tempfile.TemporaryDirectory() as tmp, contextlib.ExitStack() as stack:
            root = Path(tmp)
            config = root / '.env'
            original = b'ARRIMO_ENV=sh\nHOST=127.0.0.1\nPORT=3012\nSH_PUBLIC_URL=https://sh.arrimo.senseafri.com\n'
            config.write_bytes(original)
            os.chmod(config, 0o640)
            before = config.stat()
            props = dict(LoadState='loaded', ActiveState='active', User='arrimo-sh', Group=group,
                         WorkingDirectory=str(root / 'current'), ExecStart='node src/sh/server.js',
                         EnvironmentFiles=str(config) + ' (ignore_errors=no)', Environment='')
            props.update(override or {})
            calls = []
            def systemctl(*args):
                calls.append(args)
                if args[0] == 'show':
                    return '\n'.join(k + '=' + v for k, v in props.items())
                if fail_restart and sum(c[0] == 'restart' for c in calls) == 1:
                    raise RuntimeError('sensitive exception must stay masked')
                return ''
            for name, value in [('ROOT', root), ('CONFIG', config), ('systemctl', systemctl)]:
                stack.enter_context(patch.object(m, name, value))
            stack.enter_context(patch.object(m.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_gid=12345)))
            stack.enter_context(patch.object(m.grp, 'getgrnam', return_value=types.SimpleNamespace(gr_gid=12345)))
            health = stack.enter_context(patch.object(m, 'health'))
            stack.enter_context(patch.object(m, 'wait_health'))
            password = stack.enter_context(patch.object(m.getpass, 'getpass', return_value='abcdefghijklmnop'))
            stack.enter_context(patch.object(m.smtplib, 'SMTP_SSL'))
            stack.enter_context(patch.object(m.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)))
            stack.enter_context(patch.object(m.tempfile, 'mkdtemp', return_value=str(root / 'backup')))
            (root / 'backup').mkdir()
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            if override or fail_restart:
                with self.assertRaises(m.Refus):
                    m.configure()
            else:
                m.configure()
            self.assertNotIn('abcdefghijklmnop', output.getvalue())
            after = config.stat()
            self.assertEqual((after.st_uid, after.st_gid, after.st_mode), (before.st_uid, before.st_gid, before.st_mode))
            if fail_restart or override:
                self.assertEqual(config.read_bytes(), original)
            if override:
                password.assert_not_called()
                self.assertFalse(any(c[0] == 'restart' for c in calls))
            else:
                self.assertTrue(all(c == ('restart', 'arrimo-sh.service') for c in calls if c[0] == 'restart'))

    def test_root_arrimo_metadata_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / '.env'
            metadata = types.SimpleNamespace(st_uid=0, st_gid=12345, st_mode=0o100640)
            with patch.object(m, 'CONFIG', config), patch.object(m.os, 'fchown') as chown:
                m.write_atomic(b'synthetic', metadata)
                chown.assert_called_once()
                self.assertEqual(chown.call_args.args[1:], (0, 12345))
                self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o640)

    def test_implicit_group(self):
        self.simulate()

    def test_explicit_group(self):
        self.simulate(group='arrimo-sh')

    def test_rollback(self):
        self.simulate(fail_restart=True)

    def test_preflight_rejections(self):
        for override in ({'User': 'root'}, {'ActiveState': 'inactive'},
                         {'EnvironmentFiles': '/other/.env (ignore_errors=no)'},
                         {'Environment': 'PORT=3010'}, {'ExecStart': 'node src/server.js'}):
            with self.subTest(override=override):
                self.simulate(override=override)


if __name__ == '__main__':
    unittest.main()
