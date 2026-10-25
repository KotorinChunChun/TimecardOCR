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

一括・選択セルともPP-OCRv5を使用します。切出し、見出しの回転除外、本文の指定回転、外れ色を除いた輪郭色の余白、48px高のBGR正規化、CTC復号を共通化しています。一括は選んだ全セルを順番に処理し、選択セルの再OCRはそのセルだけを処理します。原色・青除去の比較ON時は各セルを2回認識します。

結合画像は行列・切出し範囲を確認するプレビューです。結合画像全体を別のOCRエンジンへ渡す機能は廃止しました。精度を個別OCRと揃えるため、従来のページOCRより処理時間が長くなる場合があります。
