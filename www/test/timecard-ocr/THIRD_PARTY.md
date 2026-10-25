# タイムカードOCR ブラウザー版 v1.1.0

画像の読み込み・位置合わせ・セルの認識・結果修正・書き出しは利用者のブラウザー内で実行します。初回の静的プログラム・モデル取得以外に外部OCR APIは使いません。画像・認識結果をサーバーへ送信する機能はありません。

## 同梱するモデルとライブラリ

- **PP-OCRv5 server recognizer**: PaddlePaddle/Baidu、RapidAI配布のONNX変換モデル。Apache License 2.0。提供版Pythonと同じ重み。サイズ84,577,022 bytes、SHA-256 `e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a`。モデル内の18,383文字の辞書にCTC空白とASCII空白を加えた18,385クラスを使用します。
- モデル配布元: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_server.onnx
- 原モデル: https://huggingface.co/PaddlePaddle/PP-OCRv5_server_rec
- **ONNX Runtime Web 1.24.3**: Microsoft、MIT License。WebAssembly CPU推論。https://github.com/microsoft/onnxruntime
- **sql.js 1.13.0**: sql.js contributors、MIT License。ブラウザー内のSQLite書き出し。https://github.com/sql-js/sql.js
- 認識前処理・CTC復号はRapidOCRを参照してJavaScriptへ移植。CanvasのRGBからBGRのCHW形式へ変換、48px高・最小320px幅、[-1,1]正規化、CTC重複・空白除去を行います。https://github.com/RapidAI/RapidOCR

## ライセンス本文

- [PaddleOCR Apache-2.0](licenses/paddleocr.txt)
- [RapidOCR Apache-2.0](licenses/rapidocr.txt)
- [ONNX Runtime MIT](licenses/onnxruntime.txt)
- [ONNX Runtime 第三者通知](licenses/onnxruntime-third-party.txt)
- [sql.js MIT](vendor/sqljs/LICENSE)

モデルの字形・文字列認識は正確性を保証しません。手書き・かすれ・空欄は必ず原画像と照合してください。年月日、労働時間、給与の推定・確定は行いません。

## 一括・個別OCR

一括・選択セルともPP-OCRv5 server文字認識モデルの同じ重みを使います。一括は原色の結合画像全体を公式PaddleOCR.js 0.4.2のパイプラインへ1回渡します。PP-OCRv5 server検出を全体へ1回、検出した文字行すべてをserver認識へ1バッチで渡します。セル別再認識・失敗時の分割は行いません。原色・青除去の比較ON時だけ各画像を1回ずつ処理します。個別再OCRは選択セルを同じserver文字認識モデルへ渡します。

切出しの原色、見出しの回転除外、本文の指定回転、外れ色を除いた輪郭色の100×100px以上の余白と、近傍の最多輪郭色による結合背景を維持します。内部の文字検出用リサイズ・正規化と文字認識用のBGR正規化は公式SDKの標準処理です。表示画像を白黒画像へ差し替えません。

追加依存:

- PaddleOCR.js 0.4.2（Apache-2.0）: https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js
- PP-OCRv5 server検出の公式ONNX配布: https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_server_det_onnx_infer.tar
- OpenCV.js（Apache-2.0）: [本文](licenses/opencv-js.txt)
- js-yaml（MIT）、Clipper（Boost-1.0）、JSBN（Tom Wuのライセンス）: [本文・著作者](licenses/paddleocr-js-third-party.txt)

SDK配布のワーカーにアプリ用exportを追加し、自動メッセージハンドラーを除去、ORT読込を同じ固定版のWASM専用モジュールへ変更しています。OpenCVの4つの動的関数生成を同等のクロージャへ置換し、既存のCSPでunsafe-evalを許可せず動作させます。検出・認識アルゴリズムは変更していません。検出用の内部リサイズ上限は1536pxで、文字認識は原色の結合画像から元の解像度で切り出した文字行を使います。認識tarは既存のONNX重みと既存辞書を決定的に再梱包したもので、重みは変更していません。準備スクリプト・固定台帳に元配布と変換後のSHA-256を記録しています。
