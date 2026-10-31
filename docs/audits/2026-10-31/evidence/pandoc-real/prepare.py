import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import zlib

parser = argparse.ArgumentParser()
parser.add_argument('--repo', required=True)
parser.add_argument('--root', required=True)
parser.add_argument('--pandoc', required=True)
parser.add_argument('--evidence', required=True)
a = parser.parse_args()
repo, root, pandoc, evidence = map(lambda s: Path(s).resolve(), (a.repo, a.root, a.pandoc, a.evidence))
for folder in (root, evidence): folder.mkdir(parents=True, exist_ok=True)
source = root / 'fixtures' / '源 目录 中文'
extra = root / 'fixtures' / '共享 资源 中文'
output = root / 'outputs'
for folder in (source / '图片 资料', source / '文献 资料', extra / '额外 素材', output / 'A 与源不同', output / 'B 空格 中文'):
    folder.mkdir(parents=True, exist_ok=True)

def png(rgb):
    def chunk(kind, data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    w,h=48,24
    raw=b''.join(b'\x00'+bytes(rgb)*w for _ in range(h))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
(source/'图片 资料/像素 示例.png').write_bytes(png((40,130,220)))
(extra/'额外 素材/extra.png').write_bytes(png((210,120,30)))
(source/'文献 资料/审计 参考.bib').write_text('@article{audit2026,\n  author = {Lin, Audit},\n  title = {CatstepResourceEvidence2026},\n  journal = {Fixture Journal},\n  year = {2026}\n}\n',encoding='utf-8')
(source/'文献 资料/审计 样式.csl').write_text('''<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text" default-locale="en-US">
 <info><title>Catstep audit style</title><id>http://example.invalid/styles/catstep-audit</id><updated>2026-10-31T00:00:00+00:00</updated></info>
 <citation><layout prefix="[" suffix="]"><text value="AUDIT-CSL:"/><text variable="title"/></layout></citation>
 <bibliography><layout><text value="BIB-AUDIT:"/><names variable="author"><name form="long"/></names><text variable="title" prefix=" — "/><date variable="issued" prefix=" (" suffix=")"><date-part name="year"/></date></layout></bibliography>
</style>
''',encoding='utf-8')
document='''---
title: "Catstep 真实导出 中文空间"
lang: en-US
---

# Relative resource audit

The citation must use the local style: [@audit2026].

![本地图片](<图片 资料/像素 示例.png>)

![附加资源](<额外 素材/extra.png>)

| 项目 | 预期 |
| --- | --- |
| relative image | embedded bytes |
| bibliography | local CSL marker |
'''
(source/'正文 样本.md').write_text(document,encoding='utf-8')
crate=root/'rust-driver'
(crate/'src').mkdir(parents=True,exist_ok=True)
(crate/'Cargo.toml').write_text('[package]\nname="catstep-pandoc-real-audit"\nversion="0.1.0"\nedition="2021"\n\n[dependencies]\nserde={version="1",features=["derive"]}\nserde_json="1"\n\n[target."cfg(windows)".dependencies]\nwindows-sys={version="0.61",features=["Win32_Globalization"]}\n',encoding='utf-8')
product=(repo/'app/src-tauri/src/pandoc.rs').read_text(encoding='utf-8')
# Only the Tauri IPC wrapper is excluded. All path resolution, PATH lookup,
# actual command building, process execution and RAII cleanup stay original.
start=product.index('#[tauri::command]\npub async fn pandoc_export')
end=product.index('pub fn pandoc_export_inner',start)
standalone=product[:start]+product[end:]
standalone=standalone.replace('#[tauri::command]\n','')
(crate/'src/product-pandoc.rs').write_text(standalone,encoding='utf-8')
(evidence/'product-extraction.json').write_text(json.dumps({'product':'app/src-tauri/src/pandoc.rs','product_sha256':hashlib.sha256((repo/'app/src-tauri/src/pandoc.rs').read_bytes()).hexdigest(),'source_sha256':hashlib.sha256((crate/'src/product-pandoc.rs').read_bytes()).hexdigest(),'removed':['#[tauri::command] attributes','async pandoc_export IPC authorization/spawn wrapper only'],'entry_executed':'pandoc_export_inner -> locate_pandoc -> run_export -> real pandoc 3.13','system_path_modified':False},ensure_ascii=False,indent=2),encoding='utf-8')
config={'root':str(root),'pandoc':str(pandoc),'source':str(source),'extra':str(extra),'output':str(output),'markdown':document}
(root/'config.json').write_text(json.dumps(config,ensure_ascii=False),encoding='utf-8')
(evidence/'fixture-manifest.json').write_text(json.dumps({'source_dir':str(source),'extra_resource_dir':str(extra),'output_dir':str(output),'files':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for folder in (source,extra) for p in folder.rglob('*') if p.is_file()]},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(config,ensure_ascii=False,indent=2))
