# タイムカードOCR

画像の表指定、行列編集、OCR、結果修正、CSV・SQLite書出しをブラウザー内で行うツールです。一括・選択セルの再OCRとも、同じPP-OCRv5を使います。画像やOCR結果を外部サーバーへ送信しません。

## 開発環境で起動する

Python 3とNode.jsを用意し、リポジトリのルートで実行します。Pythonは開発用の静的ファイル取得・配信に使い、OCR自体はブラウザー内のWebAssemblyで実行します。

```powershell
python scripts/prepare-timecard-browser.py --download
python -m http.server 9097 --bind 127.0.0.1 --directory www
```

ブラウザーで http://127.0.0.1:9097/test/timecard-ocr/ を開きます。初回は「準備する」から認識データをブラウザーへ保存してください。既存データを保存済みなら準備欄は表示されません。コードの更新確認は `/test/timecard-ocr/update.html` から行えます。

モデル・実行ライブラリはGitに含めず、固定URLとSHA-256を記録した台帳から取得します。取得には通信が必要です。取得後の画像処理・認識は端末内で実行します。

## 操作

1. 画像を選ぶか、元画像欄へドロップします。
2. ①表の指定で四隅を合わせ、「補正を実行」で確定します。
3. ②行列の指定で行列・見出し・本文の回転を調整し、「調整完了」で③へ進みます。列見出しは回転しません。
4. ③OCRで一括実行、またはセルを選んで「選択セルを再OCR」を実行します。一括は100×100px以上の余白を含む原色の結合画像全体を1回でOCRし、文字の位置から各セルへ戻します。対応ブラウザーでは最大4スレッドで計算します。
5. 原画像と結果を照合し、必要な値を修正して保存・書出しします。

アマノタイムカードの列2はX1=9.4%、日付の列名は出勤日・退勤日です。

並列計算にはブラウザーの分離環境を使います。同梱のService Workerが次回の文書読込から必要なヘッダーを付加します。Apacheでは同梱の.htaccessも設定します。分離環境が利用できない場合は1スレッドで動作します。

表示した結合画像そのものをOCR入力へ渡します。画像全体の文字検出1回と、検出した全ての文字行の認識1回で構成するPP-OCRv5の全体パイプラインです。セル別のOCRや失敗時の小分け処理へは切り替えません。原色・青除去の比較ON時だけ画像全体を各1回、計2回処理します。端末のメモリ上限を超えた場合はエラーを表示します。

## テスト

依存ファイルを取得後、次を実行します。

```powershell
node --test scripts/test-timecard-browser.mjs scripts/test-timecard-points.mjs scripts/test-timecard-workflow.mjs scripts/test-timecard-ocr-prep.mjs scripts/test-timecard-engine.mjs scripts/test-timecard-drop.mjs scripts/test-timecard-page.mjs scripts/test-timecard-ui.mjs scripts/test-timecard-whole.mjs
```

自動テストと合成画像で検証しています。実カード・手書き・かすれの正確な認識は保証せず、必ず原画像と照合してください。

## データとライセンス

実タイムカード、OCR結果、画像由来の作業・校正JSON、CSV、DB、検証画像・動画はこのリポジトリへ含めません。作業保存JSONには画像が入るため、Gitへ追加しないでください。

依存の出典・ライセンスは [THIRD_PARTY.md](../www/test/timecard-ocr/THIRD_PARTY.md) と固定取得台帳に記録しています。このリポジトリは親サイト全体の履歴を含まない、ツール専用のソースです。
