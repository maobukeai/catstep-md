"""Inspect actual generated APKs; never start a device or install an APK."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import zipfile

evidence = Path(__file__).resolve().parent
repo = evidence.parents[4]
sdk = Path(os.environ['LOCALAPPDATA']) / 'Android' / 'Sdk'
tools = sdk / 'build-tools' / '35.0.0'
java = Path(os.environ['JAVA_HOME']) / 'bin/java.exe'
apk_root = repo / 'app/src-tauri/gen/android/app/build/outputs/apk'
apks = sorted(apk_root.rglob('*.apk'))
if not apks:
    raise SystemExit('No actual APK was generated; verification cannot pass.')


def run(command: list[str], *, log_name: str) -> str:
    process = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    (evidence / log_name).write_bytes(process.stdout)
    text = process.stdout.decode('utf-8', errors='replace')
    if process.returncode:
        raise RuntimeError(f'{command[0]} failed ({process.returncode}): {text[-2000:]}')
    return text


records = []
for index, apk in enumerate(apks):
    badging = run([str(tools / 'aapt2.exe'), 'dump', 'badging', str(apk)], log_name=f'apk-{index}-badging.txt')
    signature = run([str(java), '-jar', str(tools / 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', str(apk)],
                    log_name=f'apk-{index}-signature.txt')
    with zipfile.ZipFile(apk) as archive:
        corrupt_member = archive.testzip()
        if corrupt_member:
            raise AssertionError(f'ZIP CRC failure: {corrupt_member}')
        names = archive.namelist()
        libraries = [name for name in names if name.startswith('lib/') and name.endswith('.so')]
        native_abis = sorted({name.split('/')[1] for name in libraries})
        native_headers = []
        for name in libraries:
            with archive.open(name) as native:
                header = native.read(20)
            native_headers.append({'name': name, 'elfMagic': header[:4] == b'\x7fELF',
                                   'class': header[4], 'machine': struct.unpack('<H', header[18:20])[0]})
        dex = b''.join(archive.read(name) for name in names if name.endswith('.dex'))
        bridge = all(marker in dex for marker in
                     (b'Lapp/catstepmd/MainActivity;', b'launchFolderPicker', b'pollPicked'))
    identity = ("package: name='app.catstepmd'" in badging and "versionName='1.0.12'" in badging
                and "versionCode='1000012'" in badging)
    expected_sdk = ("minSdkVersion:'24'" in badging or "sdkVersion:'24'" in badging) and "targetSdkVersion:'36'" in badging
    records.append({'apk': str(apk), 'sizeBytes': apk.stat().st_size,
                    'sha256': hashlib.file_digest(apk.open('rb'), 'sha256').hexdigest(),
                    'identityExpected': identity, 'sdkExpected': expected_sdk,
                    'nativeAbis': native_abis, 'nativeLibraries': native_headers,
                    'zipCrcVerified': True, 'signatureVerified': 'Verified' in signature,
                    'safBridgeNamesPresentInDex': bridge,
                    'eligibleForQaX8664': identity and expected_sdk and native_abis == ['x86_64']
                    and bridge and all(item['elfMagic'] and item['class'] == 2 and item['machine'] == 62
                                       for item in native_headers)})

(evidence / 'apk-verification.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
if not any(item['eligibleForQaX8664'] and item['signatureVerified'] for item in records):
    raise SystemExit('No verified APK matches this QA AVD.')
print(json.dumps(records, ensure_ascii=False, indent=2))
