"""CI launcher compatibility must not weaken ordinary user browser sessions."""
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import browser_session


class LaunchPolicy(unittest.TestCase):
    def test_no_sandbox_requires_linux_headless_and_explicit_github_test_opt_in(self):
        cases = [('linux', True, 'true', '1', True), ('linux', False, 'true', '1', False),
                 ('linux', True, 'false', '1', False), ('linux', True, 'true', '0', False),
                 ('win32', True, 'true', '1', False)]
        for platform, headless, ci, opt_in, expected in cases:
            with self.subTest(platform=platform, headless=headless, ci=ci, opt_in=opt_in), tempfile.TemporaryDirectory() as directory:
                context = object()
                browser = SimpleNamespace(contexts=[context])
                pw = SimpleNamespace(chromium=SimpleNamespace(connect_over_cdp=lambda endpoint: browser))
                with patch.object(browser_session.sys, 'platform', platform), \
                     patch.dict(os.environ, {'GITHUB_ACTIONS': ci, 'JOB_APPLICATION_TEST_NO_SANDBOX': opt_in}), \
                     patch.object(browser_session, 'profile_endpoint', side_effect=[None, 'http://127.0.0.1:1234']), \
                     patch.object(browser_session, 'executable', return_value='owned-test-chromium'), \
                     patch.object(browser_session.subprocess, 'Popen') as launch:
                    got = browser_session.connect(pw, Path(directory), headless=headless)
                    self.assertIs(got[1], context)
                    self.assertEqual('--no-sandbox' in launch.call_args.args[0], expected)


if __name__ == '__main__':
    unittest.main()
