import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile

from prepare_android_release import (DEFAULT_ABIS, ELF_ABIS, InvalidArtifacts,
                                     prepare_artifacts, verified_prepared_paths)


class AndroidReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / '中文 空格'
        self.outputs = self.root / 'outputs'
        # Matches actual Gradle layout: ABI is in filenames, all in universal/.
        self.apk_dir = self.outputs / 'apk/universal/release'
        self.apk_dir.mkdir(parents=True)
        self.destination = self.root / 'prepared'
        self.metadata_path = self.apk_dir / 'output-metadata.json'
        self.metadata = {'version': 3, 'artifactType': {'type': 'APK'},
                         'applicationId': 'app.catstepmd', 'variantName': 'universalRelease',
                         'elements': []}
        for abi in (*DEFAULT_ABIS, 'universal'):
            name = f'app-universal-{abi}-release.apk'
            self.write_zip(self.apk_dir / name, DEFAULT_ABIS if abi == 'universal' else (abi,))
            self.metadata['elements'].append({'type': 'UNIVERSAL' if abi == 'universal' else 'ONE_OF_MANY',
                'filters': [] if abi == 'universal' else [{'filterType': 'ABI', 'value': abi}],
                'versionCode': 1000012, 'versionName': '1.0.12', 'outputFile': name})
        self.write_metadata()
        self.bundle = self.outputs / 'bundle/universalRelease/app-universal-release.aab'
        self.write_zip(self.bundle, DEFAULT_ABIS, bundle=True)

    def write_zip(self, path, abis, *, bundle=False, wrong_elf=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('base/manifest/AndroidManifest.xml' if bundle else 'AndroidManifest.xml', b'fixture')
            for abi in abis:
                elf_class, machine = ELF_ABIS[wrong_elf or abi]
                header = bytearray(20)
                header[:4] = b'\x7fELF'
                header[4:7] = bytes((elf_class, 1, 1))
                struct.pack_into('<HH', header, 16, 3, machine)
                archive.writestr(('base/' if bundle else '') + f'lib/{abi}/libapp_lib.so', header)

    def write_metadata(self):
        self.metadata_path.write_text(json.dumps(self.metadata), encoding='utf-8')

    def prepare(self):
        return prepare_artifacts(self.outputs, self.destination, '1.0.12')

    def assert_rejected(self, reason=None):
        with self.assertRaisesRegex(InvalidArtifacts, reason or '.'):
            self.prepare()
        self.assertFalse(self.destination.exists(), 'No partial prepared directory should be exposed')

    def test_real_universal_directory_layout_prepares_five_unique_public_names(self):
        # The previous workflow's directory classifier calls every one universal.
        old = {'universal' if '/universal/' in str(self.apk_dir / item['outputFile']).replace('\\', '/') else 'unknown'
               for item in self.metadata['elements']}
        self.assertEqual(old, {'universal'})
        manifest = self.prepare()
        names = {path.name for path in verified_prepared_paths(manifest)}
        self.assertEqual(names, {f'CatstepMD_1.0.12_{abi}.apk' for abi in (*DEFAULT_ABIS, 'universal')}
                         | {'CatstepMD_1.0.12_play.aab'})

    def test_empty_native_split_is_rejected_before_copy(self):
        self.write_zip(self.apk_dir / self.metadata['elements'][0]['outputFile'], ())
        self.assert_rejected('No libapp_lib.so')

    def test_universal_must_contain_all_required_abis(self):
        self.write_zip(self.apk_dir / self.metadata['elements'][-1]['outputFile'], ('x86_64',))
        self.assert_rejected('metadata/native ABI mismatch')

    def test_elf_machine_must_match_zip_abi(self):
        self.write_zip(self.apk_dir / self.metadata['elements'][0]['outputFile'], ('arm64-v8a',), wrong_elf='x86_64')
        self.assert_rejected('ELF ABI mismatch')

    def test_native_abi_must_match_metadata_filter(self):
        self.write_zip(self.apk_dir / self.metadata['elements'][0]['outputFile'], ('x86_64',))
        self.assert_rejected('metadata/native ABI mismatch')

    def test_duplicate_public_target_is_rejected(self):
        duplicate = dict(self.metadata['elements'][0], outputFile='second-arm64.apk')
        self.write_zip(self.apk_dir / duplicate['outputFile'], ('arm64-v8a',))
        self.metadata['elements'].append(duplicate)
        self.write_metadata()
        self.assert_rejected('Duplicate')

    def test_duplicate_native_zip_entry_is_rejected(self):
        path = self.apk_dir / self.metadata['elements'][0]['outputFile']
        with zipfile.ZipFile(path) as archive:
            content = archive.read('lib/arm64-v8a/libapp_lib.so')
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(path, 'a') as archive:
                archive.writestr('lib/arm64-v8a/libapp_lib.so', content)
        self.assert_rejected('Duplicate')

    def test_package_or_version_metadata_mismatch(self):
        for field, value in (('applicationId', 'app.other'), ('versionName', '9.9.9'), ('versionCode', 4)):
            with self.subTest(field=field):
                original = json.loads(self.metadata_path.read_text())
                if field == 'applicationId':
                    self.metadata[field] = value
                else:
                    self.metadata['elements'][0][field] = value
                self.write_metadata()
                self.assert_rejected()
                self.metadata = original
                self.write_metadata()

    def test_metadata_path_traversal_and_absolute_paths_are_rejected(self):
        for name in ('../outside.apk', '/outside.apk', r'C:\outside.apk', r'..\outside.apk'):
            with self.subTest(name=name):
                self.metadata['elements'][0]['outputFile'] = name
                self.write_metadata()
                self.assert_rejected('Unsafe outputFile')

    def test_multiple_aab_outputs_cannot_clobber_public_name(self):
        self.write_zip(self.bundle.parent / 'second-release.aab', DEFAULT_ABIS, bundle=True)
        self.assert_rejected('exactly one release AAB')

    def test_aab_missing_native_architecture_is_rejected(self):
        self.write_zip(self.bundle, ('x86_64',), bundle=True)
        self.assert_rejected('AAB is missing')

    def test_missing_aab_is_rejected_before_copy(self):
        self.bundle.unlink()
        self.assert_rejected('exactly one release AAB')

    def test_symlink_output_cannot_escape_outputs_directory(self):
        original = self.apk_dir / self.metadata['elements'][0]['outputFile']
        outside = self.root / 'outside.apk'
        original.replace(outside)
        try:
            original.symlink_to(outside)
        except OSError as error:
            self.skipTest(f'Symlinks unavailable: {error}')
        self.assert_rejected('escapes outputs directory')

    def test_malformed_metadata_is_rejected_before_copy(self):
        for field, value in (('filters', [None]), ('outputFile', 1), ('versionCode', True)):
            with self.subTest(field=field):
                original = json.loads(self.metadata_path.read_text())
                self.metadata['elements'][0][field] = value
                self.write_metadata()
                self.assert_rejected()
                self.metadata = original
                self.write_metadata()

    def test_missing_aab_or_apk_variant_is_rejected(self):
        self.metadata['elements'].pop(0)
        self.write_metadata()
        self.assert_rejected('Missing release APK')

    def test_debug_metadata_is_not_published(self):
        self.metadata['variantName'] = 'universalDebug'
        self.write_metadata()
        self.assert_rejected('Missing release APK')

    def test_manifest_verifies_all_files_before_returning_upload_list(self):
        manifest = self.prepare()
        data = json.loads(manifest.read_text())
        (self.destination / data['artifacts'][-1]['file']).write_bytes(b'tampered')
        with self.assertRaisesRegex(InvalidArtifacts, 'changed prepared artifact'):
            verified_prepared_paths(manifest)

    def test_existing_prepared_directory_is_preserved(self):
        self.destination.mkdir()
        sentinel = self.destination / 'do-not-overwrite'
        sentinel.write_text('keep')
        with self.assertRaisesRegex(InvalidArtifacts, 'refusing overwrite'):
            self.prepare()
        self.assertEqual(sentinel.read_text(), 'keep')

    def test_offline_cli_supports_unicode_space_paths_and_explicit_manifest(self):
        process = subprocess.run([sys.executable, str(Path(__file__).with_name('prepare_android_release.py')),
            '--outputs', str(self.outputs), '--output', str(self.destination), '--version', '1.0.12'],
            capture_output=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(len(verified_prepared_paths(self.destination / 'manifest.json')), 5)


if __name__ == '__main__':
    unittest.main()
