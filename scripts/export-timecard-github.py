"""タイムカードOCRの固定ソースだけを新規GitHubリポジトリ用に抽出する。"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
APP = 'www/test/timecard-ocr/'
APP_NAMES = (
    '.htaccess', 'THIRD_PARTY.md', 'index.html', 'style.css', 'sw.js',
    'bootstrap.mjs', 'update.html', 'update.mjs', 'edit-history.mjs', 'casting.mjs', 'ocr-options.mjs', 'focus-tools.mjs', 'core.mjs', 'imaging.mjs',
    'ocr-prep.mjs', 'ocr-progress.mjs', 'color-tools.mjs', 'card-fields.mjs',
    'card-geometry.mjs', 'card-detector.mjs', 'card-range-editor.mjs',
    'image-tools.mjs', 'whole-engine.mjs', 'whole-result.mjs', 'engine-client.mjs', 'image-drop.mjs', 'ui-tools.mjs',
    'point-tools.mjs', 'table-detector.mjs', 'workflow.mjs', 'grid-editor.mjs',
    'grid-autoplacement.mjs', 'review-tools.mjs',
    'page-layout.mjs', 'atlas.mjs', 'storage.mjs', 'ocr-worker.mjs', 'app.mjs',
    'assets.json', 'template-original.json', 'models/characters.json',
    'licenses/paddleocr.txt', 'licenses/opencv-js.txt', 'licenses/paddleocr-js-third-party.txt', 'licenses/rapidocr.txt', 'licenses/onnxruntime.txt',
    'licenses/onnxruntime-third-party.txt')
TESTS = ('browser', 'points', 'workflow', 'ocr-prep', 'engine', 'drop', 'page', 'ui', 'whole',
         'four-geometry', 'four-review', 'four-atlas', 'editor-refinement', 'casting', 'models')
FILES = tuple(APP + name for name in APP_NAMES) + tuple(
    'scripts/test-timecard-' + name + '.mjs' for name in TESTS) + (
    'scripts/prepare-timecard-browser.py', 'scripts/prepare-timecard-whole.py', 'scripts/export-timecard-github.py',
    'dev/history/v1.1.0/timecard-assets-lock.json',
    'tools/timecard-ocr/templates/sample_timecard.json',
    'docs/timecard-ocr-repository.md')
IGNORE = '''/www/test/timecard-ocr/vendor/
/www/test/timecard-ocr/models/*.onnx
/www/test/timecard-ocr/models/*.tar
/dev/history/*/logs/
/private/
__pycache__/
.venv/
*.png
*.jpg
*.jpeg
*.webp
*.bmp
*.csv
*.sqlite
*.db
timecard-work*.json
timecard-calibration*.json
'''


def check(condition, message):
    # assert は python -O で消えるため、検証には使わない。
    if not condition:
        raise SystemExit(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(target):
    manifest = json.loads((target / 'export-manifest.json').read_text(encoding='utf-8'))
    expected = set(FILES) | {'README.md', '.gitignore', '.gitattributes'}
    check(set(f['path'] for f in manifest['files']) == expected, '台帳のファイル一覧が固定リストと一致しません。')
    actual = {p.relative_to(target).as_posix() for p in target.rglob('*')
              if p.is_file() and '.git' not in p.relative_to(target).parts}
    check(actual == expected | {'export-manifest.json'}, '固定リスト外のファイルがあります。')
    for entry in manifest['files']:
        relative = entry['path']
        check(not any(part in {'private', 'logs', 'validation'} for part in Path(relative).parts), '非公開・ログ・検証用フォルダーは含めません: ' + relative)
        check(Path(relative).suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.csv', '.db', '.sqlite', '.onnx', '.tar'}, '画像・結果・モデルは含めません: ' + relative)
        path = target / relative
        check(path.is_file() and digest(path) == entry['sha256'], 'SHA-256不一致: ' + relative)
    print(f"固定ソース {len(expected)}件のSHA-256、実画像・結果・ログの除外: 合格")


def export(target):
    if target.exists():
        raise SystemExit('出力先が存在します。上書きせず、新しいフォルダーを指定してください。')
    target.mkdir(parents=True)
    for relative in FILES:
        dest = target / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, dest)
    readme = (ROOT / 'docs/timecard-ocr-repository.md').read_text(encoding='utf-8')
    (target / 'README.md').write_text(readme.replace('(../www/', '(www/'), encoding='utf-8')
    (target / '.gitignore').write_text(IGNORE, encoding='utf-8')
    (target / '.gitattributes').write_text('* -text\n', encoding='utf-8')
    revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    names = sorted(set(FILES) | {'README.md', '.gitignore', '.gitattributes'})
    manifest = {'sourceRevision': revision, 'files': [
        {'path': n, 'bytes': (target / n).stat().st_size, 'sha256': digest(target / n)} for n in names]}
    (target / 'export-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    verify(target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['export', 'verify'])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    (export if args.action == 'export' else verify)(args.output.resolve())
