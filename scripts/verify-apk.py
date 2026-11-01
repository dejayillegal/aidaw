#!/usr/bin/env python3
"""Fail-closed artifact verification. This does not certify installation or device playback."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile


def sdk_tool(name):
    direct = shutil.which(name)
    if direct:
        return direct
    root = os.environ.get('ANDROID_SDK_ROOT') or os.environ.get('ANDROID_HOME')
    if root:
        for folder in sorted((Path(root) / 'build-tools').glob('*'), reverse=True):
            candidate = folder / name
            if candidate.is_file():
                return str(candidate)
    raise ValueError(f'Official Android SDK tool required: {name}')


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f'{Path(args[0]).name} failed: {result.stderr or result.stdout}')
    return result.stdout


def parse_signer_certificate(signature):
    # New SDKs annotate signer SDK ranges and may repeat one certificate across
    # schemes. Count identities, not output lines; source-stamp certs are excluded.
    count = re.search(r'Number of signers:\s*(\d+)', signature)
    if count and int(count.group(1)) != 1:
        raise ValueError('Expected exactly one APK signer')
    fingerprints = set()
    for line in signature.splitlines():
        if not line.strip().startswith(('Signer ', 'V1 Signer:', 'V2 Signer:', 'V3 Signer:', 'V3.0 Signer:', 'V3.1 Signer:', 'V4 Signer:')):
            continue
        match = re.search(r'certificate SHA-256 digest:\s*([0-9a-fA-F]{64})(?:\s|$)', line)
        if match:
            fingerprints.add(match.group(1).lower())
    if len(fingerprints) != 1:
        raise ValueError('Expected one signer certificate; SDK output: ' + signature)
    return fingerprints.pop()


def validate_sdk_versions(badging, metadata):
    versions = dict(re.findall(r"(?m)^\s*(sdkVersion|minSdkVersion|targetSdkVersion):'([^']+)'", badging))
    if 'minSdkVersion' in versions and 'sdkVersion' in versions and versions['minSdkVersion'] != versions['sdkVersion']:
        raise ValueError('Conflicting minimum SDK labels')
    minimum = versions.get('minSdkVersion', versions.get('sdkVersion'))
    target = versions.get('targetSdkVersion')
    if minimum != str(metadata['minSdk']):
        raise ValueError(f"Manifest minSdk {minimum!r} differs from metadata {metadata['minSdk']}")
    if target != str(metadata['targetSdk']):
        raise ValueError(f"Manifest targetSdk {target!r} differs from metadata {metadata['targetSdk']}")


def verify_apk(apk_path, metadata_path, certificate=None):
    path = Path(apk_path)
    metadata = json.loads(Path(metadata_path).read_text())
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.testzip() is not None:
            raise ValueError('Corrupt ZIP or duplicate entries')
        for entry in ['AndroidManifest.xml', 'resources.arsc', 'classes.dex', 'assets/public/index.html']:
            if entry not in names:
                raise ValueError(f'Missing {entry}')
        if not archive.read('AndroidManifest.xml').startswith(b'\x03\x00\x08\x00'):
            raise ValueError('Manifest is not compiled binary Android XML')
        if not re.match(rb'dex\n0[3-4][0-9]\x00', archive.read('classes.dex')[:8]):
            raise ValueError('Invalid DEX header')
        if not any(n.startswith('assets/public/assets/') and n.endswith('.js') for n in names):
            raise ValueError('Offline JavaScript bundle missing')
        if any(n.endswith('.apk') for n in names):
            raise ValueError('Nested stale APK packaged inside application')
    signature = run([sdk_tool('apksigner'), 'verify', '--verbose', '--print-certs', '--min-sdk-version', str(metadata['minSdk']), str(path)])
    actual_certificate = parse_signer_certificate(signature)
    if certificate and certificate.replace(':', '').lower() != actual_certificate:
        raise ValueError('Signing certificate differs from trusted baseline')
    run([sdk_tool('zipalign'), '-c', '-P', '16', '4', str(path)])
    badging = run([sdk_tool('aapt2'), 'dump', 'badging', str(path)])
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    if not package or package.groups() != (metadata['applicationId'], str(metadata['versionCode']), metadata['versionName']):
        raise ValueError('Manifest identity differs from release metadata')
    validate_sdk_versions(badging, metadata)
    return {'status': 'artifact-verified', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'sizeBytes': path.stat().st_size, 'certificateSha256': actual_certificate,
            'certificatePinned': bool(certificate), 'installLaunchVerified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('apk', nargs='?', default='android/app/build/outputs/apk/debug/app-debug.apk')
    parser.add_argument('--metadata', default='public/apk-metadata.json')
    parser.add_argument('--certificate-sha256', default=os.environ.get('ANDROID_DEBUG_CERT_SHA256'))
    args = parser.parse_args()
    try:
        print(json.dumps(verify_apk(args.apk, args.metadata, args.certificate_sha256)))
    except Exception as error:
        print(f'APK_VERIFICATION_FAILED: {error}', file=sys.stderr)
        sys.exit(1)
