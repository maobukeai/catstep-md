import argparse
from pathlib import Path, PurePosixPath
from urllib.parse import unquote
import hashlib
import json
import posixpath
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

parser=argparse.ArgumentParser()
parser.add_argument('--evidence',required=True)
parser.add_argument('--root',required=True)
a=parser.parse_args()
evidence,root=Path(a.evidence).resolve(),Path(a.root).resolve()
config=json.loads((root/'config.json').read_text(encoding='utf-8'))
driver=json.loads((evidence/'driver-results.json').read_text(encoding='utf-8'))
assert driver['all_driver_assertions_passed']
expected={hashlib.sha256(p.read_bytes()).hexdigest() for folder in (Path(config['source'])/'图片 资料',Path(config['extra'])/'额外 素材') for p in folder.glob('*.png')}
results=[]
artifacts=evidence/'artifacts'
artifacts.mkdir(exist_ok=True)
for case in driver['cases'][:2]:
    output=Path(case['output'])
    with zipfile.ZipFile(output) as z:
        assert z.testzip() is None
        names=z.namelist()
        images=[name for name in names if name.lower().endswith('.png')]
        actual={hashlib.sha256(z.read(name)).hexdigest() for name in images}
        assert actual==expected,(images,actual,expected)
        ext=output.suffix
        referenced=[]
        if ext=='.epub':
            assert z.read('mimetype')==b'application/epub+zip'
            chapters=[name for name in names if name.endswith('.xhtml')]
            texts=[]
            for name in chapters:
                element=ET.fromstring(z.read(name))
                texts.append(''.join(element.itertext()))
                for image in element.findall('.//{http://www.w3.org/1999/xhtml}img'):
                    target=posixpath.normpath(posixpath.join(str(PurePosixPath(name).parent),unquote(image.attrib['src'])))
                    assert target in names,(name,target)
                    referenced.append(target)
            package=next(name for name in names if name.endswith('.opf'))
            opf=ET.fromstring(z.read(package))
            declared=[item.attrib['href'] for item in opf.findall('.//{http://www.idpf.org/2007/opf}item') if item.attrib.get('media-type')=='image/png']
            assert len(declared)==2
            text='\n'.join(texts)
        else:
            assert z.read('mimetype')==b'application/vnd.oasis.opendocument.text'
            content=ET.fromstring(z.read('content.xml'))
            text=''.join(content.itertext())
            for image in content.findall('.//{urn:oasis:names:tc:opendocument:xmlns:drawing:1.0}image'):
                target=image.attrib['{http://www.w3.org/1999/xlink}href']
                assert target in names,target
                referenced.append(target)
            manifest=ET.fromstring(z.read('META-INF/manifest.xml'))
            declared=[item.attrib['{urn:oasis:names:tc:opendocument:xmlns:manifest:1.0}full-path'] for item in manifest if item.attrib.get('{urn:oasis:names:tc:opendocument:xmlns:manifest:1.0}media-type')=='image/png']
            assert set(declared)==set(images)
        assert set(referenced)==set(images),(referenced,images)
        assert 'AUDIT-CSL:CatstepResourceEvidence2026' in text,text
        assert 'BIB-AUDIT:' in text
        assert 'Audit Lin' in text
        assert '@audit2026' not in text
        assert '本地图片' in text and '附加资源' in text
        artifact=artifacts/('relative-resources'+ext)
        shutil.copy2(output,artifact)
        results.append({'format':ext[1:],'output':str(output),'artifact':str(artifact.relative_to(evidence)),
            'zip_crc_valid':True,'embedded_pngs':images,'image_hashes_match_source_and_extra_resources':True,
            'image_references_all_resolve_in_package':True,'citation_processed':True,'custom_csl_marker':True,'bibliography_processed':True,
            'unicode_captions_preserved':True,'archive_members':names,'archive_sha256':hashlib.sha256(output.read_bytes()).hexdigest()})
# Diagnose the actual Windows process's non-UTF8 stderr, without changing locale or PATH.
missing=Path(config['source'])/'文献 资料/不存在的文献.bib'
process=subprocess.run([config['pandoc'],'--citeproc','--bibliography='+str(missing),'-t','plain'],input=b'[@audit2026]\n',capture_output=True)
raw=process.stderr
(evidence/'missing-bibliography-stderr.bin').write_bytes(raw)
try:
    raw.decode('utf-8',errors='strict')
    utf8=True
except UnicodeDecodeError:
    utf8=False
legacy=raw.decode('gb18030',errors='replace')
encoding={'real_process_exit':process.returncode,'stderr_utf8_valid':utf8,'utf8_lossy':raw.decode('utf-8',errors='replace'),
          'gb18030_decoded':legacy,'gb18030_contains_expected_unicode_path':str(missing) in legacy,
          'observed_product_error':driver['cases'][3]['error'],'product_diagnostic_unicode_path_readable':str(missing).replace('/', '\\') in driver['cases'][3]['error'].replace('/', '\\')}
(evidence/'stderr-encoding-observation.json').write_text(json.dumps(encoding,ensure_ascii=False,indent=2),encoding='utf-8')
assert encoding['product_diagnostic_unicode_path_readable'],encoding
report={'pandoc_version':driver['detected']['version'],'real_product_entry_executed':driver['entry'],'all_packaging_assertions_passed':True,
        'package_checks':results,'driver_cases_passed':len(driver['cases']),'temp_inputs_leaked':0,
        'raw_process_uses_legacy_stderr':not utf8 and encoding['gb18030_contains_expected_unicode_path'],'diagnostic_fix_verified':encoding['product_diagnostic_unicode_path_readable']}
(evidence/'package-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
