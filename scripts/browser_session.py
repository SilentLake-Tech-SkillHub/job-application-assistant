"""User-local persistent Chromium session, independent of the filling process.

Launch an existing browser binary with a dedicated profile, then attach over CDP.
Stopping Playwright disconnects the client; the browser and unsaved pages survive.
Only an explicit user action (or the owning synthetic test) closes the browser.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener
from urllib.parse import urlsplit


def profile_endpoint(profile):
    """Discover this profile's live browser, rejecting stale/reused debug ports."""
    try:
        lines = (Path(profile) / 'DevToolsActivePort').read_text(encoding='utf-8').splitlines()
        port = int(lines[0])
        if not 0 < port < 65536 or not lines[1].startswith('/devtools/browser/'):
            return None
        endpoint = 'http://127.0.0.1:%d' % port
        # Loopback discovery must not be redirected via the user's HTTP proxy.
        with build_opener(ProxyHandler({})).open(endpoint + '/json/version', timeout=1) as response:
            actual = json.load(response).get('webSocketDebuggerUrl', '')
        return endpoint if urlsplit(actual).path == lines[1] else None
    except (OSError, ValueError, IndexError, KeyError):
        return None


def executable(pw, channel=None, executable_path=None):
    if executable_path:
        candidates = [Path(executable_path)]
    elif not channel:
        candidates = [Path(pw.chromium.executable_path)]
    else:
        names = ('google-chrome', 'google-chrome-stable', 'chrome') if channel == 'chrome' else ('microsoft-edge', 'msedge')
        candidates = [Path(p) for n in names if (p := shutil.which(n))]
        relative = 'Google/Chrome/Application/chrome.exe' if channel == 'chrome' else 'Microsoft/Edge/Application/msedge.exe'
        candidates += [Path(p) / relative for key in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA') if (p := os.environ.get(key))]
        if sys.platform == 'darwin':
            app = 'Google Chrome.app/Contents/MacOS/Google Chrome' if channel == 'chrome' else 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
            candidates.append(Path('/Applications') / app)
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate.resolve())
    raise FileNotFoundError('找不到既有 Chromium/Chrome/Edge；请用户配置 CHROME_EXECUTABLE 或安装浏览器，Agent 不安装依赖')


def connect(pw, profile, headless=False, channel=None, executable_path=None, timeout=15):
    profile = Path(profile).resolve()
    profile.mkdir(parents=True, exist_ok=True)
    endpoint = profile_endpoint(profile)
    if endpoint is None:
        command = [executable(pw, channel, executable_path), '--user-data-dir=' + str(profile),
                   '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
                   '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
                   '--disable-dev-shm-usage', 'about:blank']
        if headless:
            command.insert(1, '--headless=new')
        # GitHub's Linux synthetic-browser tests cannot use Chromium's user-namespace
        # sandbox. Match the previous Playwright test launcher only on explicit CI
        # opt-in; normal user sessions keep their default sandbox configuration.
        if (headless and sys.platform.startswith('linux') and os.environ.get('GITHUB_ACTIONS') == 'true'
                and os.environ.get('JOB_APPLICATION_TEST_NO_SANDBOX') == '1'):
            command.insert(1, '--no-sandbox')
        options = {'stdin': subprocess.DEVNULL, 'stdout': subprocess.DEVNULL,
                   'stderr': subprocess.DEVNULL, 'close_fds': True}
        if os.name == 'nt':
            options['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        else:
            options['start_new_session'] = True
        process = subprocess.Popen(command, **options)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            endpoint = profile_endpoint(profile)
            if endpoint:
                break
            if process.poll() is not None:
                raise RuntimeError('专用浏览器启动失败或配置被占用；保留页面，改用已知 --cdp 会话')
            time.sleep(0.1)
        if not endpoint:
            raise TimeoutError('专用浏览器调试连接未就绪；页面保持原状，请检查浏览器并重试')
    browser = pw.chromium.connect_over_cdp(endpoint)
    if not browser.contexts:
        raise RuntimeError('CDP 会话没有持久化上下文，请检查专用浏览器')
    return browser, browser.contexts[0], endpoint
