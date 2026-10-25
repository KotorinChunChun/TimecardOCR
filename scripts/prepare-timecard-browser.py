"""ブラウザーOCRの配信依存を固定ハッシュで検証する。--download時だけ公式配布物を取得する。"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
import runpy
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'www/test/timecard-ocr'
LOCK = ROOT / 'dev/history/v1.1.0/timecard-assets-lock.json'


def check(condition, message):
    # assert は python -O で消えるため、検証には使わない。
    if not condition:
        raise SystemExit(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify(download=False):
    whole = runpy.run_path(str(ROOT / 'scripts/prepare-timecard-whole.py'))
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    for group in lock['sources']:
        missing = any(not (APP / f['path']).is_file() for f in group['files'])
        if download and missing:
            with urlopen(group['url'], timeout=180) as response:
                data = response.read()
            check(sha(data) == group['sha256'], '取得元ハッシュ不一致')
            if group['format'] == 'tar':
                with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
                    for entry in group['files']:
                        target = APP / entry['path']
                        target.parent.mkdir(parents=True, exist_ok=True)
                        payload = archive.extractfile(entry['member']).read()
                        if entry.get('recipe') == 'paddleocr-worker-adapter-v3':
                            payload = whole['sdk_adapter'](payload)
                        target.write_bytes(payload)
            else:
                target = APP / group['files'][0]['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        for entry in group['files']:
            check(sha((APP / entry['path']).read_bytes()) == entry['sha256'], '依存ファイル不一致: ' + entry['path'])
    if download:
        whole['prepare']()
    for entry in lock.get('generated', []):
        check(sha((APP / entry['path']).read_bytes()) == entry['sha256'], '生成モデル不一致: ' + entry['path'])
    manifest = json.loads((APP / 'assets.json').read_text(encoding='utf-8'))
    for entry in manifest['files']:
        data = (APP / entry['path']).read_bytes()
        check(len(data) == entry['bytes'] and sha(data) == entry['sha256'], entry['path'])
    print(f'固定依存 {sum(len(g["files"]) for g in lock["sources"])}件と実行時台帳 {len(manifest["files"])}件のSHA-256一致')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--download', action='store_true')
    verify(parser.parse_args().download)
