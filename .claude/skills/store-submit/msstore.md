# Microsoft Partner Center

Product `9NXGHK2LL1Q4`, account `slushy@outlook.com`, unzoo profile
`Profile_msstore`. Store page: `apps.microsoft.com/detail/9nxghk2ll1q4`.

```bash
S=.claude/skills/store-submit
export UNZOO_TAB=$($S/unzoo.sh find-tab partner.microsoft.com)
```

## Packaging

`scripts/pack_msix.py` does the whole thing:

```bash
gh release download vX.Y.Z -p "SoloMD_X.Y.Z_x64_en-US.msi" -D /tmp/msix
python3 scripts/pack_msix.py --msi /tmp/msix/SoloMD_X.Y.Z_x64_en-US.msi \
        --version X.Y.Z --arch x64 --out /tmp/msix/SoloMD_X.Y.Z_x64.msix
```

**★ The package identity is not ours to choose, and it is readable without
logging in.** The Store assigns it, and a mismatch is rejected. Both values
come from the public catalogue:

```bash
curl -s "https://displaycatalog.mp.microsoft.com/v7.0/products/9NXGHK2LL1Q4?market=US&languages=en-us&fieldsTemplate=Details" \
  | python3 -c "import json,sys; p=json.load(sys.stdin)['Product']['Properties']; print(p['PackageIdentityName'], p['PublisherCertificateName'])"
# zhitong.SoloMD  CN=359F6F65-9E32-4216-A4A1-9AF570A7877A
```

`pack_msix.py` verifies the publisher string by recomputing the package family
name hash from it (UTF-16LE, SHA-256, first 8 bytes, Crockford base32 — no
i/l/o/u) and refusing to build unless it matches the published
`zhitong.SoloMD_3vmxy07xh2v3m`. **Case matters**: the lowercase GUID hashes to
something else entirely.

## How it works: no Windows machine required

Earlier notes claimed MSIX needs `makeappx` on Windows. It does not.

- `msiextract` (brew `msitools`) unpacks our MSI into five payload files:
  `SoloMD.exe`, `solomd-mcp.exe`, `file_icon.ico`, `en_US.aff`, `en_US.dic`.
- An MSIX is an OPC zip and **the Store re-signs it**, so no signtool and no
  certificate. Pure-Python `zipfile` with everything `ZIP_STORED`:
  `AppxManifest.xml` + `[Content_Types].xml` + `AppxBlockMap.xml`
  (base64 sha256 of each 64 KB block; STORED means no compressed size needed;
  `LfhSize = 30 + len(utf8 name)`).
- Zip order matters: payload → manifest → `[Content_Types]` → blockmap.
- Icons come from `app/src-tauri/icons/Square{44,71,150,310}Logo.png` and
  `StoreLogo.png`.

`pack_msix.py` went missing twice, both times because it lived in a temp
directory. It is now `scripts/pack_msix.py`, in the repository.

Manifest traps:

- `Version` must end in `.0` — `4.11.9.0` is accepted, `4.11.9.1` fails with
  "revision number other than zero".
- Listing `DefaultTile`/`Square310` with incomplete assets throws
  `APPX_E_INVALID_MANIFEST (0x80080204)`. Start with only `Square150` +
  `Square44`, validate, then add the `.md`/`.markdown`/`.txt`
  FileTypeAssociation extension.
- `BackgroundColor` `#121110` works; so does `transparent`.

Each release: bump the third segment of `Version`, keep the fourth at `0`.

## Submitting

1. Overview → **Start update**. The button is an `he-button` with a *closed*
   shadow root, so it cannot be clicked by selector — `shot`, read the
   coordinates, `click`. The URL will not change, but the submission has been
   created server-side: reload the overview and the draft plus its section
   links (`/submissions/<id>/packages`, `/options`, …) appear.
2. **Packages**: the input is `input.fileuploader`.
   `unzoo.sh upload 'input.fileuploader' SoloMD_X.Y.Z.msix`.

   **★ Do not judge the upload by reading the input back.** Angular takes the
   FileList and clears the input in the same tick, so a *successful* attach
   reads `files.length === 0`. Judging by that number and retrying uploads the
   file twice — which is a duplicate you then have to Delete. Confirm on the
   page: an upload row with a size and a progress bar.

   **★ "Analyzing package" can sit at 99% for well over ten minutes** and the
   page will tell you to refresh. Refresh: the server has usually finished, and
   the package appears in the list below with its version. The progress widget
   is the thing that is stuck, not the validation.

   Then poll for the version number or an `APPX_E` error.
   - Same-version conflict ("uniquely identified") → delete one.
   - The previous version shows "will be removed". **Leave it alone.** Do not
     press its "Don't remove this package" — Save then clears it correctly.
   - The **Save button is in a closed-shadow footer**: scroll to the bottom,
     locate it in a screenshot, click by coordinate.
3. **★ "Submission options" stuck on Incomplete** is almost never a
   runFullTrust justification — this product's options page has no
   restricted-capability textarea at all. It is the publishing-hold option
   never having been explicitly saved. Open the options page, press the
   bottom Save once (closed shadow, ≈366,406), and the badge flips to
   Unchanged immediately.
4. Certification notes go on a separate page,
   `/suppinfo/additionaltestinginfo`; its button is "Save description" and is
   reachable by DOM.
5. Save. The packages page redirects back to the submission overview, which
   should now show the new package **Validated** and the section badged
   **Updated**.

6. When every section reads Complete/Unchanged/Validated, overview →
   **Submit for certification**.

**★ Do not believe the page immediately after clicking Submit.** It renders
optimistically and it lies in both directions — on 2026-09-08 it showed
"Update in certification" seconds after the click, then a screenshot taken
right after showed "Update in draft", and a "Sign in required — your session
has expired" dialog was sitting in the DOM the whole time. **Navigate away and
back**, then read. The submitted state is: the status reads "In certification",
the Submit button is gone, a **Cancel certification** button has appeared, and
the page shows the Submission → Pre-processing → Certification → Publishing
pipeline.

**★ The Store listings section sits behind a separate AAD sign-in.** Its link
renders as `/aad?action=signin&returnPath=...` and navigating to the listing
URL directly bounces to the overview. Editing listing text therefore needs the
user; the package update does not.

## ★ Trust the validate API, not the section badges

The per-section badges in Partner Center are flaky and have shown Incomplete
for sections that were fine, and fine for sections that blocked submission.
During registration this cost the most time of anything; the real blockers were
the IARC terms checkbox and a missing zh-CN listing (one listing is required
per language the package declares).

## Timing

Certification runs from a few hours to three working days, and the submission
is set to publish automatically once it passes. Verify afterwards on
`apps.microsoft.com/detail/9nxghk2ll1q4` — the version number there is the
only confirmation that counts.
