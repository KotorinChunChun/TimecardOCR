// アプリ本体の読み込みに失敗した場合も、次の修正版を取得できるよう独立して登録する。
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(error=>console.error('更新の確認に失敗しました。',error));
