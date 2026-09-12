import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSemver, pickBestAsset, type ReleaseAsset } from './check-update.ts';

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
});
