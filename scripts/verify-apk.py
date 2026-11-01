"""Reject placeholder ZIPs; require compiled Android content and a valid signature."""
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path


def verify(apk):
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
    versions = [p for p in (sdk / 'build-tools').iterdir() if p.is_dir() and re.fullmatch(r'\d+\.\d+\.\d+', p.name)]
    tools = max(versions, key=lambda p: tuple(map(int, p.name.split('.'))))
    suffix = '.bat' if os.name == 'nt' else ''
    subprocess.run([str(tools / ('apksigner' + suffix)), 'verify', '--verbose', str(apk)], check=True)
    subprocess.run([str(tools / ('zipalign' + ('.exe' if os.name == 'nt' else ''))), '-c', '-P', '16', '4', str(apk)], check=True)
    badging = subprocess.check_output([str(tools / ('aapt' + ('.exe' if os.name == 'nt' else ''))), 'dump', 'badging', str(apk)], text=True)
    assert "package: name='com.parametricals.technodaw'" in badging, badging
    assert "launchable-activity: name='com.parametricals.technodaw.MainActivity'" in badging, badging
    with zipfile.ZipFile(apk) as archive:
        assert archive.testzip() is None, 'ZIP checksum failure'
        assert archive.read('AndroidManifest.xml')[:4] == b'\x03\x00\x08\x00', 'Manifest must be compiled binary XML'
        dex = archive.read('classes.dex')
        assert dex.startswith(b'dex\n') and len(dex) > 112, 'Missing compiled bytecode'
        assert b'MainActivity' in b''.join(archive.read(n) for n in archive.namelist() if re.fullmatch(r'classes\d*\.dex', n)), 'Missing launcher implementation'
        config = json.loads(archive.read('assets/capacitor.config.json'))
        assert config['appId'] == 'com.parametricals.technodaw', 'Capacitor app ID mismatch'
        assert not config.get('server', {}).get('url'), 'App must use bundled assets'
        html = archive.read('assets/public/index.html').decode()
        assets = re.findall(r'(?:src|href)="(/?assets/[^\"]+\.(?:js|css))"', html)
        assert assets and any(a.endswith('.js') for a in assets), 'Missing production web bundle'
        for asset in assets:
            assert len(archive.read('assets/public/' + asset.lstrip('/'))) > 0
        assert not any(n.endswith('.apk') for n in archive.namelist()), 'APK recursively bundled inside APK'
    print('PASS: Android signature, alignment, package, launcher, bytecode and bundled web assets')


if __name__ == '__main__':
    verify(Path(sys.argv[1]))
