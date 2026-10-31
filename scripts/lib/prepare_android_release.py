"""Validate Android release outputs before preparing any public asset names.

This module is offline: it never invokes a publisher, signer, device or emulator.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import tempfile
import zipfile

DEFAULT_ABIS = ('arm64-v8a', 'armeabi-v7a', 'x86_64')
ELF_ABIS = {'arm64-v8a': (2, 183), 'armeabi-v7a': (1, 40),
            'x86_64': (2, 62), 'x86': (1, 3)}


class InvalidArtifacts(ValueError):
    pass


@dataclass(frozen=True)
class Artifact:
    source: Path
    name: str
    kind: str
    abis: tuple[str, ...]


def sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def contained_file(root: Path, parent: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or name in ('.', '..') or '/' in name or '\\' in name or ':' in name:
        raise InvalidArtifacts(f'Unsafe outputFile in metadata: {name!r}')
    path = (parent / name).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise InvalidArtifacts(f'Output is missing or escapes outputs directory: {path}')
    return path


def native_abis(path: Path, *, bundle: bool = False) -> tuple[str, ...]:
    prefix = 'base/lib/' if bundle else 'lib/'
    try:
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None:
                raise InvalidArtifacts(f'ZIP CRC failure: {path}')
            if bundle and 'base/manifest/AndroidManifest.xml' not in archive.namelist():
                raise InvalidArtifacts(f'AAB manifest is missing: {path}')
            libraries = [item for item in archive.infolist()
                         if item.filename.startswith(prefix) and item.filename.endswith('/libapp_lib.so')]
            found = set()
            for item in libraries:
                parts = item.filename[len(prefix):].split('/')
                if len(parts) != 2 or parts[0] not in ELF_ABIS or parts[0] in found:
                    raise InvalidArtifacts(f'Duplicate or unsupported native ABI entry: {path}: {item.filename}')
                abi = parts[0]
                with archive.open(item) as stream:
                    header = stream.read(20)
                expected_class, expected_machine = ELF_ABIS[abi]
                if (len(header) < 20 or header[:4] != b'\x7fELF' or header[4] != expected_class
                        or header[5] != 1 or struct.unpack('<H', header[16:18])[0] != 3
                        or struct.unpack('<H', header[18:20])[0] != expected_machine):
                    raise InvalidArtifacts(f'ELF ABI mismatch: {path}: {abi}')
                found.add(abi)
            if not found:
                raise InvalidArtifacts(f'No libapp_lib.so native library in {path}')
            return tuple(sorted(found))
    except (zipfile.BadZipFile, OSError, RuntimeError) as error:
        raise InvalidArtifacts(f'Cannot inspect {path}: {error}') from error


def collect_artifacts(outputs: Path, version: str, application_id: str,
                      expected_abis: tuple[str, ...] = DEFAULT_ABIS) -> list[Artifact]:
    outputs = outputs.resolve()
    required = set(expected_abis)
    if not re.fullmatch(r'[0-9][0-9A-Za-z.+_-]*', version):
        raise InvalidArtifacts('Version must be safe for public asset filenames')
    if not required or not required.issubset(ELF_ABIS) or len(required) != len(expected_abis):
        raise InvalidArtifacts('Expected ABIs must be unique supported architectures')
    artifacts = []
    names = set()
    sources = set()
    version_codes = set()
    seen_apk_abis = set()

    def add(artifact: Artifact) -> None:
        if artifact.name.casefold() in names or artifact.source in sources:
            raise InvalidArtifacts(f'Duplicate source or public target: {artifact.name}')
        names.add(artifact.name.casefold())
        sources.add(artifact.source)
        artifacts.append(artifact)

    for metadata_path in sorted((outputs / 'apk').rglob('output-metadata.json')):
        metadata_path = metadata_path.resolve()
        if not metadata_path.is_relative_to(outputs):
            raise InvalidArtifacts('Metadata escapes outputs directory')
        try:
            metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise InvalidArtifacts(f'Invalid metadata: {metadata_path}') from error
        if not isinstance(metadata, dict):
            raise InvalidArtifacts(f'Metadata must be an object: {metadata_path}')
        if not str(metadata.get('variantName', '')).endswith('Release'):
            continue
        if metadata.get('artifactType', {}).get('type') != 'APK' or metadata.get('applicationId') != application_id:
            raise InvalidArtifacts(f'APK application/artifact metadata mismatch: {metadata_path}')
        elements = metadata.get('elements')
        if not isinstance(elements, list) or not elements:
            raise InvalidArtifacts(f'APK metadata contains no elements: {metadata_path}')
        for item in elements:
            if (not isinstance(item, dict) or item.get('versionName') != version
                    or type(item.get('versionCode')) is not int or item['versionCode'] < 1):
                raise InvalidArtifacts(f'APK version metadata mismatch: {metadata_path}')
            version_codes.add(item['versionCode'])
            filters = item.get('filters')
            if item.get('type') == 'UNIVERSAL' and filters == []:
                abi = 'universal'
            elif (item.get('type') == 'ONE_OF_MANY' and isinstance(filters, list) and len(filters) == 1
                  and isinstance(filters[0], dict) and filters[0].get('filterType') == 'ABI'
                  and filters[0].get('value') in required):
                abi = filters[0]['value']
            else:
                raise InvalidArtifacts(f'Unsupported or inconsistent APK ABI metadata: {metadata_path}')
            source = contained_file(outputs, metadata_path.parent, item.get('outputFile', ''))
            actual = native_abis(source)
            if (abi == 'universal' and not required.issubset(actual)) or (abi != 'universal' and set(actual) != {abi}):
                raise InvalidArtifacts(f'APK metadata/native ABI mismatch: {source}: expected {abi}, found {actual}')
            add(Artifact(source, f'CatstepMD_{version}_{abi}.apk', 'apk', actual))
            seen_apk_abis.add(abi)
    if seen_apk_abis != required | {'universal'} or len(version_codes) != 1:
        raise InvalidArtifacts('Missing release APK variants or inconsistent versionCode')

    bundles = [path.resolve() for path in (outputs / 'bundle').rglob('*.aab')
               if 'release' in path.name.lower() or any('release' in part.lower() for part in path.relative_to(outputs).parts[:-1])]
    if len(bundles) != 1 or not bundles[0].is_relative_to(outputs):
        raise InvalidArtifacts('Expected exactly one release AAB inside outputs directory')
    actual = native_abis(bundles[0], bundle=True)
    if not required.issubset(actual):
        raise InvalidArtifacts('Release AAB is missing required native ABIs')
    add(Artifact(bundles[0], f'CatstepMD_{version}_play.aab', 'aab', actual))
    return artifacts


def prepare_artifacts(outputs: Path, destination: Path, version: str,
                      application_id: str = 'app.catstepmd',
                      expected_abis: tuple[str, ...] = DEFAULT_ABIS) -> Path:
    # Validate the complete collection before creating a prepared output directory.
    artifacts = collect_artifacts(outputs, version, application_id, expected_abis)
    destination = destination.resolve()
    if destination.exists():
        raise InvalidArtifacts(f'Prepared directory already exists; refusing overwrite: {destination}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.android-release-', dir=destination.parent) as temporary:
        staging = Path(temporary) / 'prepared'
        staging.mkdir()
        records = []
        for artifact in artifacts:
            copied = staging / artifact.name
            shutil.copyfile(artifact.source, copied)
            records.append({'file': artifact.name, 'sha256': sha256(copied),
                            'size': copied.stat().st_size, 'kind': artifact.kind,
                            'abis': artifact.abis})
        manifest = {'version': version, 'applicationId': application_id, 'artifacts': records}
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        staging.rename(destination)
    return destination / 'manifest.json'


def verified_prepared_paths(manifest_path: Path) -> list[Path]:
    """Check the entire explicit manifest before the caller uploads its first file."""
    manifest_path = manifest_path.resolve()
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    records = data.get('artifacts')
    if not isinstance(records, list) or not records:
        raise InvalidArtifacts('Prepared manifest has no artifacts')
    paths = []
    names = set()
    for record in records:
        name = record['file']
        path = contained_file(manifest_path.parent, manifest_path.parent, name)
        if name.casefold() in names or path.stat().st_size != record['size'] or sha256(path) != record['sha256']:
            raise InvalidArtifacts(f'Duplicate or changed prepared artifact: {name}')
        names.add(name.casefold())
        paths.append(path)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--outputs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--application-id', default='app.catstepmd')
    parser.add_argument('--expected-abis', nargs='+', default=DEFAULT_ABIS)
    args = parser.parse_args()
    try:
        manifest = prepare_artifacts(args.outputs, args.output, args.version,
                                     args.application_id, tuple(args.expected_abis))
    except (InvalidArtifacts, OSError, ValueError) as error:
        parser.exit(1, f'Android release artifacts rejected: {error}\n')
    print(manifest)


if __name__ == '__main__':
    main()
