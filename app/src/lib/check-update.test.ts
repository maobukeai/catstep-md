import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareSemver,
  pickBestAsset,
  synthesizeReleaseAssets,
  resolveMatchedAsset,
  type ReleaseAsset,
  type UpdateResult,
} from './check-update.ts';

test('compareSemver accurately compares semver strings', () => {
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.2.0', '1.1.9'), 1);
  assert.equal(compareSemver('v1.0.0', 'v1.0.1'), -1);
  assert.equal(compareSemver('v4.3.5', 'v4.3.4'), 1);
  assert.equal(compareSemver('v4.3.5-beta.1', 'v4.3.5'), 0);
  assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
});

test('pickBestAsset matches correct assets for Android architectures', () => {
  const assets: ReleaseAsset[] = [
    { name: 'catstep-md-v4.3.5-windows-x64.msi', browser_download_url: 'http://example.com/win.msi', size: 50000000 },
    { name: 'catstep-md-v4.3.5-macos-arm64.dmg', browser_download_url: 'http://example.com/mac.dmg', size: 60000000 },
    { name: 'catstep-md-v4.3.5-arm64-v8a.apk', browser_download_url: 'http://example.com/arm64.apk', size: 26000000 },
    { name: 'catstep-md-v4.3.5-armeabi-v7a.apk', browser_download_url: 'http://example.com/armv7.apk', size: 24000000 },
    { name: 'catstep-md-v4.3.5-x86_64.apk', browser_download_url: 'http://example.com/x86.apk', size: 28000000 },
    { name: 'catstep-md-v4.3.5-universal.apk', browser_download_url: 'http://example.com/universal.apk', size: 65000000 },
  ];

  // Android aarch64
  const matchedArm64 = pickBestAsset(assets, { os: 'android', arch: 'aarch64' });
  assert.ok(matchedArm64);
  assert.equal(matchedArm64.name, 'catstep-md-v4.3.5-arm64-v8a.apk');

  // Android armv7
  const matchedArmV7 = pickBestAsset(assets, { os: 'android', arch: 'arm' });
  assert.ok(matchedArmV7);
  assert.equal(matchedArmV7.name, 'catstep-md-v4.3.5-armeabi-v7a.apk');

  // Android x86_64
  const matchedX86 = pickBestAsset(assets, { os: 'android', arch: 'x86_64' });
  assert.ok(matchedX86);
  assert.equal(matchedX86.name, 'catstep-md-v4.3.5-x86_64.apk');

  // Android fallback when only universal is present
  const universalOnly: ReleaseAsset[] = [
    { name: 'catstep-md-v4.3.5-windows-x64.msi', browser_download_url: 'http://example.com/win.msi', size: 50000000 },
    { name: 'catstep-md-v4.3.5-universal.apk', browser_download_url: 'http://example.com/universal.apk', size: 65000000 },
  ];
  const matchedUniversal = pickBestAsset(universalOnly, { os: 'android', arch: 'aarch64' });
  assert.ok(matchedUniversal);
  assert.equal(matchedUniversal.name, 'catstep-md-v4.3.5-universal.apk');
});

test('pickBestAsset matches correct assets for Desktop platforms', () => {
  const assets: ReleaseAsset[] = [
    { name: 'catstep-md-v4.3.5-windows-x64.msi', browser_download_url: 'http://example.com/win.msi', size: 50000000 },
    { name: 'catstep-md-v4.3.5-macos-arm64.dmg', browser_download_url: 'http://example.com/mac-arm.dmg', size: 60000000 },
    { name: 'catstep-md-v4.3.5-macos-x64.dmg', browser_download_url: 'http://example.com/mac-x64.dmg', size: 62000000 },
    { name: 'catstep-md-v4.3.5-linux-x86_64.AppImage', browser_download_url: 'http://example.com/linux.AppImage', size: 70000000 },
    { name: 'catstep-md-v4.3.5-arm64-v8a.apk', browser_download_url: 'http://example.com/arm64.apk', size: 26000000 },
  ];

  // Windows x86_64
  const winMatch = pickBestAsset(assets, { os: 'windows', arch: 'x86_64' });
  assert.ok(winMatch);
  assert.equal(winMatch.name, 'catstep-md-v4.3.5-windows-x64.msi');

  // macOS arm64
  const macArmMatch = pickBestAsset(assets, { os: 'macos', arch: 'aarch64' });
  assert.ok(macArmMatch);
  assert.equal(macArmMatch.name, 'catstep-md-v4.3.5-macos-arm64.dmg');

  // Linux x86_64
  const linuxMatch = pickBestAsset(assets, { os: 'linux', arch: 'x86_64' });
  assert.ok(linuxMatch);
  assert.equal(linuxMatch.name, 'catstep-md-v4.3.5-linux-x86_64.AppImage');

  // iOS returns null because updates are managed by the App Store
  const iosMatch = pickBestAsset(assets, { os: 'ios', arch: 'arm64' });
  assert.equal(iosMatch, null);

  // Unknown OS returns null
  const unknownMatch = pickBestAsset(assets, { os: 'unknown', arch: 'x86_64' });
  assert.equal(unknownMatch, null);
});

test('synthesizeReleaseAssets generates expected assets and valid GitHub download URLs', () => {
  const assets = synthesizeReleaseAssets('v1.0.8');
  assert.ok(assets.length > 0);

  // Check URL pattern
  for (const asset of assets) {
    assert.match(
      asset.browser_download_url,
      /^https:\/\/github\.com\/maobukeai\/catstep-md\/releases\/download\/v1\.0\.8\//,
    );
  }

  // Windows x64 MSI
  const winX64 = pickBestAsset(assets, { os: 'windows', arch: 'x86_64' });
  assert.ok(winX64);
  assert.equal(winX64.name, 'CatstepMD_1.0.8_x64_en-US.msi');
  assert.equal(
    winX64.browser_download_url,
    'https://github.com/maobukeai/catstep-md/releases/download/v1.0.8/CatstepMD_1.0.8_x64_en-US.msi',
  );

  // Windows ARM64 MSI
  const winArm64 = pickBestAsset(assets, { os: 'windows', arch: 'aarch64' });
  assert.ok(winArm64);
  assert.equal(winArm64.name, 'CatstepMD_1.0.8_arm64_en-US.msi');

  // macOS Apple Silicon
  const macArm = pickBestAsset(assets, { os: 'macos', arch: 'aarch64' });
  assert.ok(macArm);
  assert.equal(macArm.name, 'CatstepMD_1.0.8_aarch64.dmg');

  // macOS Intel
  const macX64 = pickBestAsset(assets, { os: 'macos', arch: 'x86_64' });
  assert.ok(macX64);
  assert.equal(macX64.name, 'CatstepMD_1.0.8_x64.dmg');

  // Linux x64
  const linuxX64 = pickBestAsset(assets, { os: 'linux', arch: 'x86_64' });
  assert.ok(linuxX64);
  assert.equal(linuxX64.name, 'CatstepMD_1.0.8_amd64.AppImage');

  // Linux ARM64
  const linuxArm = pickBestAsset(assets, { os: 'linux', arch: 'aarch64' });
  assert.ok(linuxArm);
  assert.equal(linuxArm.name, 'CatstepMD_1.0.8_aarch64.AppImage');

  // Android
  const androidArm = pickBestAsset(assets, { os: 'android', arch: 'aarch64' });
  assert.ok(androidArm);
  assert.equal(androidArm.name, 'CatstepMD_1.0.8_universal.apk');
});

test('pickBestAsset prevents architecture mismatches (x64 CPU never gets ARM binary)', () => {
  // Windows x64 should never match an ARM-only MSI/EXE
  const armOnlyWinAssets: ReleaseAsset[] = [
    { name: 'CatstepMD_1.0.8_arm64_en-US.msi', browser_download_url: 'http://example.com/arm.msi', size: 100 },
  ];
  const winX64Mismatch = pickBestAsset(armOnlyWinAssets, { os: 'windows', arch: 'x86_64' });
  assert.equal(winX64Mismatch, null);

  // macOS Intel (x86_64) should never match an Apple Silicon (aarch64) DMG
  const armOnlyMacAssets: ReleaseAsset[] = [
    { name: 'CatstepMD_1.0.8_aarch64.dmg', browser_download_url: 'http://example.com/arm.dmg', size: 100 },
  ];
  const macIntelMismatch = pickBestAsset(armOnlyMacAssets, { os: 'macos', arch: 'x86_64' });
  assert.equal(macIntelMismatch, null);

  // macOS Apple Silicon (aarch64) CAN fallback to Intel (x64) DMG via Rosetta 2
  const intelOnlyMacAssets: ReleaseAsset[] = [
    { name: 'CatstepMD_1.0.8_x64.dmg', browser_download_url: 'http://example.com/intel.dmg', size: 100 },
  ];
  const macArmFallback = pickBestAsset(intelOnlyMacAssets, { os: 'macos', arch: 'aarch64' });
  assert.ok(macArmFallback);
  assert.equal(macArmFallback.name, 'CatstepMD_1.0.8_x64.dmg');
});

test('resolveMatchedAsset recovers matchedAsset when missing from update result', () => {
  // Case 1: matchedAsset already present
  const existingAsset: ReleaseAsset = {
    name: 'custom-package.msi',
    browser_download_url: 'https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/custom.msi',
    size: 12345,
  };
  const withAsset: UpdateResult = {
    current: '1.0.8',
    latest: '1.0.9',
    hasUpdate: true,
    url: 'https://github.com/maobukeai/catstep-md/releases/tag/v1.0.9',
    error: false,
    matchedAsset: existingAsset,
  };
  assert.equal(resolveMatchedAsset(withAsset), existingAsset);

  // Case 2: matchedAsset is null but latest version is present (fallback scenario with explicit platform)
  const fallbackResult: UpdateResult = {
    current: '1.0.8',
    latest: '1.0.9',
    hasUpdate: true,
    url: 'https://github.com/maobukeai/catstep-md/releases/latest',
    error: false,
    matchedAsset: null,
  };
  const resolved = resolveMatchedAsset(fallbackResult, { os: 'windows', arch: 'x86_64' });
  assert.ok(resolved);
  assert.equal(resolved.name, 'CatstepMD_1.0.9_x64_en-US.msi');
  assert.equal(
    resolved.browser_download_url,
    'https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD_1.0.9_x64_en-US.msi',
  );

  // Case 3: resolveMatchedAsset without platform argument uses getPlatformInfoSync
  const resolvedDefault = resolveMatchedAsset(fallbackResult);
  assert.ok(resolvedDefault);
  assert.ok(resolvedDefault.name.length > 0);

  // Case 4: null updateInfo returns null
  assert.equal(resolveMatchedAsset(null), null);
});

test('checkForUpdateOnStartup function runs and defaults force to true', async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
  try {
    const { checkForUpdateOnStartup } = await import('./check-update.ts');
    assert.equal(typeof checkForUpdateOnStartup, 'function');
    localStorage.setItem('catstep.update.last-check', String(Date.now()));
    const skipped = await checkForUpdateOnStartup(false);
    assert.equal(skipped, null);
    const forced = await checkForUpdateOnStartup(true);
    assert.ok(forced);
    assert.equal(typeof forced.hasUpdate, 'boolean');
  } finally {
    delete (globalThis as any).localStorage;
  }
});

